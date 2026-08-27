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

// ด่านกันคนนอกอ่าน/แก้ผล OCR — ตั้ง PULL_TOKEN แล้วต้องแนบ Bearer ให้ตรง (แพทเทิร์นเดียวกับ INGEST_TOKEN ของ fleet)
function pullAuthorized(request, env) {
  if (!env || !env.PULL_TOKEN) return true;   // โหมดทดลองในเครื่อง — ก่อนใช้จริงต้องตั้งเสมอ
  return (request.headers.get('authorization') || '') === 'Bearer ' + env.PULL_TOKEN;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const isMock = !(env && env.LINE_CHANNEL_SECRET); // ไม่มี secret = โหมด mock (dev/เทส)

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
      const deps = {
        lineClient: (env && env.LINE_CHANNEL_ACCESS_TOKEN) ? createLineClient(env) : createMockLineClient(),
        engine: chooseEngine(env),
        writeback: chooseWriteback(env, ((env && env.WRITEBACK_PROVIDER) || '').toLowerCase() === 'd1' ? stagingRepoOf(env) : undefined)
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
      if (!pullAuthorized(request, env)) return json({ ok: false, reason: 'unauthorized' }, 401);
      const repo = stagingRepoOf(env);
      const rows = await repo.listResults({
        status: url.searchParams.get('status') || 'confirmed',
        driverId: url.searchParams.get('driverId') || undefined,
        jobUid: url.searchParams.get('jobUid') || undefined,
      });
      return json({ ok: true, mock: isMock, results: rows });
    }
    // POST /api/ocr/pulled {id, by} → เว็บบอกว่าเอาไปใช้แล้ว (ติดธง ไม่ลบแถว — ไว้สาวย้อน)
    if (request.method === 'POST' && url.pathname === '/api/ocr/pulled') {
      if (!pullAuthorized(request, env)) return json({ ok: false, reason: 'unauthorized' }, 401);
      const body = await request.json().catch(() => null);
      if (!body || !body.id) return json({ ok: false, reason: 'bad-body', hint: 'ต้องมี {id, by}' }, 400);
      const repo = stagingRepoOf(env);
      const r = await repo.markPulled(body.id, body.by || null, body.ts || Date.now());
      return json(r, r.ok ? 200 : 409);
    }

    return json({ ok: false, reason: 'not-found' }, 404);
  }
};
