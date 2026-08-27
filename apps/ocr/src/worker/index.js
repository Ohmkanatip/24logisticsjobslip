// Cloudflare Worker — ทางเข้า webhook ของบอท LINE อ่านเบอร์ตู้
// ⚠️ เฟสนี้เป็นโครงรอ ห้าม deploy — รันได้ในโหมด mock เท่านั้น
import { verifySignature } from '../line/signature.js';
import { createMockLineClient, createLineClient } from '../line/client.js';
import { chooseEngine } from '../ocr/engine.js';
import { chooseWriteback } from '../writeback/index.js';
import { handleEvent } from '../line/webhook.js';

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
        writeback: chooseWriteback(env)
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

    return json({ ok: false, reason: 'not-found' }, 404);
  }
};
