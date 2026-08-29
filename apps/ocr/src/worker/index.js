// Cloudflare Worker — ทางเข้า webhook ของบอท LINE อ่านเบอร์ตู้
// ⚠️ เฟสนี้เป็นโครงรอ ห้าม deploy — รันได้ในโหมด mock เท่านั้น
import { verifySignature } from '../line/signature.js';
import { createMockLineClient, createLineClient } from '../line/client.js';
import { chooseEngine } from '../ocr/engine.js';
import { chooseWriteback } from '../writeback/index.js';
import { makeMemoryStagingRepo, makeD1StagingRepo } from '../db/staging.js';
import { handleEvent } from '../line/webhook.js';

// staging repo กลาง (ทาง ③ ที่เจ้าของเคาะ): มี env.DB = D1 จริง · ไม่มี = memory ก้อนเดียวทั้ง isolate
// (memory หายเมื่อ isolate รีเซ็ต — พอสำหรับ dev · ของจริงต้องผูก D1 ใน wrangler.jsonc)
let memStaging = null;
function stagingRepoOf(env) {
  if (env && env.DB) return makeD1StagingRepo(env.DB);
  if (!memStaging) memStaging = makeMemoryStagingRepo();
  return memStaging;
}

// ทางเขียนกลับที่ใช้จริง — ค่าเริ่มต้น 'd1' (ทางที่เจ้าของเคาะ 28 ส.ค. 2569)
function writebackProviderOf(env) {
  return ((env && env.WRITEBACK_PROVIDER) || 'd1').toLowerCase();
}

// โหมดของ worker: ไม่มี LINE_CHANNEL_SECRET = โหมดทดลองในเครื่อง (dev/เทส)
// ⚠️ ใช้เป็นเงื่อนไขเดียวของ "ปลอดภัยไหม" ไม่ได้ — ดู pullAuthorized
function isMockMode(env) {
  return !(env && env.LINE_CHANNEL_SECRET);
}

// ด่านกันคนนอกอ่าน/แก้ผล OCR — ตั้ง PULL_TOKEN แล้วต้องแนบ Bearer ให้ตรง (แพทเทิร์นเดียวกับ INGEST_TOKEN ของ fleet)
// ⚠️ เดิม: ไม่ตั้ง PULL_TOKEN = ใครก็ยิงอ่าน/ติดธงผลได้ · ตัวตรวจอิสระจับได้ว่า "ลืมตั้ง = ประตูเปิดโล่ง"
//    ตอนนี้: ผ่อนผันเฉพาะโหมดทดลอง (ไม่มี LINE_CHANNEL_SECRET) เท่านั้น
//    ขึ้นของจริงแล้วลืมตั้ง = ปฏิเสธทุก request พร้อมบอกสาเหตุ ดีกว่าเปิดโล่งเงียบๆ
function pullAuthorized(request, env) {
  const token = env && env.PULL_TOKEN;
  if (!token) return isMockMode(env) ? true : 'missing-pull-token';
  return (request.headers.get('authorization') || '') === 'Bearer ' + token;
}

// เว็บ jobslip อยู่คนละโดเมน (ohmkanatip.github.io) — ไม่มี CORS = เบราว์เซอร์บล็อก ดึงผลไม่ได้เลย
// ALLOW_ORIGIN ไม่ตั้ง = ไม่ปล่อย CORS (ปลอดภัยไว้ก่อน · ตั้งตอน setup จริงเป็นโดเมนเว็บ)
function corsHeaders(env) {
  const origin = (env && env.ALLOW_ORIGIN) || '';
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function json(obj, status = 200, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, corsHeaders(env))
  });
}

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const isMock = isMockMode(env); // ไม่มี secret = โหมดทดลอง (dev/เทส)

    // preflight ของเบราว์เซอร์ — ต้องตอบก่อน ไม่งั้นเว็บ jobslip ยิง GET ที่มี Authorization ไม่ได้เลย
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // สุขภาพระบบ — ไว้เช็คว่า worker ตื่นอยู่และใช้ engine ตัวไหน
    if (request.method === 'GET' && url.pathname === '/health') {
      const engine = chooseEngine(env);
      return json({ ok: true, provider: engine.provider, mock: isMock });
    }

    // ทางเข้า webhook จาก LINE
    if (request.method === 'POST' && url.pathname === '/webhook/line') {
      const bodyText = await request.text();

      // ตรวจลายเซ็นก่อนเสมอเมื่อมี secret — ไม่ผ่าน = 401 จบเลย
      if (!isMock) {
        const sig = request.headers.get('x-line-signature') || '';
        const pass = await verifySignature(env.LINE_CHANNEL_SECRET, bodyText, sig);
        if (!pass) return json({ ok: false, reason: 'bad-signature' }, 401);
      }

      let payload;
      try {
        payload = JSON.parse(bodyText);
      } catch (_e) {
        return json({ ok: false, reason: 'bad-json' }, 400);
      }

      // ประกอบ dependencies: มี access token จริงถึงใช้ client จริง (ซึ่งยังเป็น stub ซื่อสัตย์)
      const repoForBind = stagingRepoOf(env);
      const deps = {
        lineClient: (env && env.LINE_CHANNEL_ACCESS_TOKEN) ? createLineClient(env) : createMockLineClient(),
        engine: chooseEngine(env),
        // ⚠️ ค่าเริ่มต้นเป็น 'd1' (ทางที่เจ้าของเคาะ) ไม่ใช่ 'mock'
        //    เดิม: ลืมตั้ง WRITEBACK_PROVIDER = การยืนยันของคนขับหล่นลง mock ที่ไม่มีใครอ่าน แล้วหายเงียบ
        //    ตอนนี้: ต้องตั้ง 'mock' เองอย่างจงใจเท่านั้นถึงจะเข้าโหมดทิ้ง
        writeback: chooseWriteback(env, writebackProviderOf(env) === 'd1' ? repoForBind : undefined),
        // V73: แปลง LINE userId → driverId จากตารางผูก — พังก็คืน null (การยืนยันต้องไม่ล้มเพราะหา id ไม่ได้)
        resolveDriver: async (userId) => {
          try { const b = await repoForBind.getBinding(userId); return b ? b.driver_id : null; }
          catch (_e) { return null; }
        }
      };

      const events = Array.isArray(payload.events) ? payload.events : [];
      const results = [];
      for (const ev of events) {
        try {
          results.push(await handleEvent(ev, deps));
        } catch (e) {
          // event เดียวพังต้องไม่ทำให้ทั้ง batch ล้ม (LINE จะยิงซ้ำทั้งก้อน)
          results.push({ ok: false, reason: 'handler-error', detail: String((e && e.message) || e) });
        }
      }
      return json({ ok: true, mock: isMock, handled: results.length, results });
    }

    // ══ ทาง ③: จุดให้เว็บ jobslip "ดึงมาต่อ" — บอทไม่แตะชีท เว็บเป็นฝ่ายมาเอา ══
    // GET /api/ocr/results?status=confirmed&driverId=D001&jobUid=…  → รายการเบอร์ตู้ที่คนขับยืนยันแล้ว
    if (request.method === 'GET' && url.pathname === '/api/ocr/results') {
      const auth = pullAuthorized(request, env);
      if (auth !== true) return json({ ok: false, reason: auth === 'missing-pull-token' ? 'server-misconfigured' : 'unauthorized',
        hint: auth === 'missing-pull-token' ? 'ยังไม่ได้ตั้ง PULL_TOKEN บนเซิร์ฟเวอร์ — ตั้งก่อนใช้จริง' : undefined }, auth === 'missing-pull-token' ? 503 : 401, env);
      const repo = stagingRepoOf(env);
      const rows = await repo.listResults({
        status: url.searchParams.get('status') || 'confirmed',
        driverId: url.searchParams.get('driverId') || undefined,
        jobUid: url.searchParams.get('jobUid') || undefined,
      });
      return json({ ok: true, mock: isMock, results: rows }, 200, env);
    }
    // V73: POST /api/ocr/bind {lineUserId, driverId, name} → ผูก LINE↔คนขับ (.gs ยิงมา sync จากแท็บ "คนขับ")
    if (request.method === 'POST' && url.pathname === '/api/ocr/bind') {
      const authB = pullAuthorized(request, env);
      if (authB !== true) return json({ ok: false, reason: authB === 'missing-pull-token' ? 'server-misconfigured' : 'unauthorized' },
        authB === 'missing-pull-token' ? 503 : 401, env);
      const bodyB = await request.json().catch(() => null);
      if (!bodyB || !bodyB.lineUserId || !bodyB.driverId) return json({ ok: false, reason: 'bad-body', hint: 'ต้องมี {lineUserId, driverId}' }, 400, env);
      const rB = await stagingRepoOf(env).upsertBinding({
        lineUserId: String(bodyB.lineUserId), driverId: String(bodyB.driverId),
        name: bodyB.name ? String(bodyB.name) : null, ts: bodyB.ts || Date.now(),
      });
      return json(rB, rB.ok ? 200 : 400, env);
    }
    // POST /api/ocr/pulled {id, by} → เว็บบอกว่าเอาไปใช้แล้ว (ติดธง ไม่ลบแถว — ไว้สาวย้อน)
    if (request.method === 'POST' && url.pathname === '/api/ocr/pulled') {
      const auth2 = pullAuthorized(request, env);
      if (auth2 !== true) return json({ ok: false, reason: auth2 === 'missing-pull-token' ? 'server-misconfigured' : 'unauthorized' },
        auth2 === 'missing-pull-token' ? 503 : 401, env);
      const body = await request.json().catch(() => null);
      if (!body || !body.id) return json({ ok: false, reason: 'bad-body', hint: 'ต้องมี {id, by}' }, 400, env);
      const repo = stagingRepoOf(env);
      const r = await repo.markPulled(body.id, body.by || null, body.ts || Date.now());
      // แยกรหัสให้ฝั่งเว็บรู้ว่าเจออะไร: ไม่มีแถวนี้ = 404 · มีคนดึงไปแล้ว = 409 (เดิมเหมารวม 409 หมด)
      const code = r.ok ? 200 : (r.reason === 'not-found' ? 404 : 409);
      return json(r, code, env);
    }

    return json({ ok: false, reason: 'not-found' }, 404, env);
  }
};
