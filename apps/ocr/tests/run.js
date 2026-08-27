// ชุดทดสอบ — plain Node ไม่มี dependency · รัน: node tests/run.js · ผ่าน = exit 0
import { normalize, isValidFormat, computeCheckDigit, validate } from '../src/iso6346/check.js';
import { suggestRepairs } from '../src/iso6346/repair.js';
import { extractCandidates } from '../src/ocr/extract.js';
import { chooseEngine } from '../src/ocr/engine.js';
import { createMockEngine } from '../src/ocr/engines/mock.js';
import * as qwen from '../src/ocr/engines/qwen.js';
import * as vision from '../src/ocr/engines/vision.js';
import * as typhoon from '../src/ocr/engines/typhoon.js';
import { verifySignature, hmacBase64 } from '../src/line/signature.js';
import { createMockLineClient, createLineClient } from '../src/line/client.js';
import { handleEvent } from '../src/line/webhook.js';
import { createMockWriteback } from '../src/writeback/index.js';
import worker from '../src/worker/index.js';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
}

async function main() {

  console.log('\n== ISO 6346: เช็คดิจิต ==');
  // เวกเตอร์ทดสอบบังคับ
  const v1 = validate('CSQU3054383');
  ok(v1.ok === true && v1.expected === 3 && v1.got === 3, 'CSQU3054383 ผ่าน (เช็คดิจิต 3)', v1);
  ok(computeCheckDigit('CSQU305438') === 3, 'computeCheckDigit("CSQU305438") = 3');

  // round-trip: generate เช็คดิจิตเองจาก 5 prefix ต่างกัน แล้ว validate ต้องผ่าน
  const bodies = ['MSKU123456', 'TCLU765432', 'HLXU000001', 'APZU987654', 'TRIU304592'];
  for (const b of bodies) {
    const cd = computeCheckDigit(b);
    const full = b + String(cd);
    const v = validate(full);
    ok(v.ok === true && v.got === cd, 'round-trip ' + full + ' ผ่าน', v);
  }

  // เลขผิด 1 หลัก = ไม่ผ่าน
  const bad1 = validate('CSQU3054384');
  ok(bad1.ok === false && bad1.expected === 3 && bad1.got === 4, 'เช็คดิจิตผิด (CSQU3054384) ไม่ผ่าน', bad1);
  const bad2 = validate('CSQU3064383'); // แก้เลขกลาง 5→6
  ok(bad2.ok === false, 'เลขตัวกลางผิด 1 หลัก ไม่ผ่าน', bad2);

  console.log('\n== ISO 6346: format ==');
  ok(validate('CSU3054383').ok === false && validate('CSU3054383').reason === 'bad-format', 'ตัวอักษร 3 ตัว = reject');
  ok(validate('CSQU30543831').ok === false, 'เลข 8 หลัก (ยาวเกิน) = reject');
  ok(validate('CSQU305438').ok === false, 'สั้นไป (ไม่มีเช็คดิจิต) = reject');
  ok(validate('CSQU30ก4383').ok === false, 'มีตัวอักษรไทย = reject');
  ok(validate('CSQ13054383').ok === false, 'ตัวเลขโผล่ในโซนตัวอักษร = reject');
  ok(validate('').ok === false, 'สตริงว่าง = reject');
  ok(validate(null).ok === false, 'null = reject (ไม่ throw)');

  console.log('\n== ISO 6346: normalize + warning ==');
  ok(normalize('csqu 305438-3') === 'CSQU3054383', 'normalize "csqu 305438-3" → CSQU3054383');
  ok(validate('csqu 305438-3').ok === true, 'validate หลัง normalize ผ่าน');
  // ตัวที่ 4 ไม่ใช่ U/J/Z → ผ่านแบบมี warning (สร้างเช็คดิจิตให้ถูกก่อน)
  const cdA = computeCheckDigit('CSQA305438');
  const vA = validate('CSQA305438' + cdA);
  ok(vA.ok === true && vA.warnings.length === 1, 'ตัวที่ 4 = A → ผ่านพร้อม warning', vA);
  ok(v1.warnings.length === 0, 'ตัวที่ 4 = U → ไม่มี warning');
  const fmtJ = isValidFormat('CSQJ3054380');
  ok(fmtJ.ok === true && fmtJ.warnings.length === 0, 'ตัวที่ 4 = J → format ผ่าน ไม่มี warning');

  console.log('\n== repair: ข้อเสนอซ่อม ==');
  // เบอร์ถูก โดนแกล้งสลับ O→0 หนึ่งตำแหน่ง (ตำแหน่งเลข 0 ตัวที่ 5 กลายเป็น O)
  const r1 = suggestRepairs('CSQU3O54383');
  ok(r1.includes('CSQU3054383'), 'สลับ 0→O ในโซนเลข: หาต้นฉบับเจอ', r1);
  // สลับ S→5 ในโซนตัวอักษร
  const r2 = suggestRepairs('C5QU3054383');
  ok(r2.includes('CSQU3054383'), 'สลับ S→5 ในโซนอักษร: หาต้นฉบับเจอ', r2);
  // เบอร์มั่ว = ไม่มีข้อเสนอ
  ok(suggestRepairs('XXXX9999999').length === 0, 'เบอร์มั่ว → []');
  ok(suggestRepairs('ABC').length === 0, 'สั้นเกิน → []');
  // ทุกข้อเสนอต้อง validate ผ่านจริง
  ok(r1.every((x) => validate(x).ok), 'ข้อเสนอซ่อมทุกตัว validate ผ่านจริง');

  console.log('\n== extract: หาเบอร์จากข้อความ OCR ==');
  const e1 = extractCandidates('ตู้หมายเลข CSQU3054383 มาถึงลานแล้ว');
  ok(e1.length === 1 && e1[0] === 'CSQU3054383', 'เจอในข้อความยาว', e1);
  const e2 = extractCandidates('MSKU 123456 5');
  ok(e2.length === 1 && e2[0] === 'MSKU1234565', 'เจอแบบมีช่องว่างคั่น', e2);
  const e3 = extractCandidates('CSQU3054383 และซ้ำ CSQU 305438-3');
  ok(e3.length === 1, 'ตัวซ้ำถูกยุบเหลือตัวเดียว', e3);
  ok(extractCandidates('ไม่มีเบอร์ตู้ในนี้เลย 12345').length === 0, 'ไม่มีเบอร์ → []');
  ok(extractCandidates(null).length === 0, 'input ไม่ใช่สตริง → []');
  const e4 = extractCandidates('msku 123456 5 ตัวพิมพ์เล็ก');
  ok(e4.length === 1 && e4[0] === 'MSKU1234565', 'ตัวพิมพ์เล็กก็เจอ (uppercase ให้)', e4);

  console.log('\n== LINE signature (HMAC-SHA256 ของจริง) ==');
  const secret = 'test-channel-secret';
  const body = JSON.stringify({ events: [{ type: 'message' }] });
  const goodSig = await hmacBase64(secret, body); // สร้างลายเซ็นถูกด้วย crypto.subtle เอง
  ok(await verifySignature(secret, body, goodSig) === true, 'ลายเซ็นถูก → ผ่าน');
  ok(await verifySignature(secret, body, 'ZmFrZXNpZ25hdHVyZQ==') === false, 'ลายเซ็นปลอม → ไม่ผ่าน');
  ok(await verifySignature(secret, body + 'x', goodSig) === false, 'body ถูกแก้ → ไม่ผ่าน');
  ok(await verifySignature('wrong-secret', body, goodSig) === false, 'secret คนละตัว → ไม่ผ่าน');
  ok(await verifySignature(secret, body, '') === false, 'ลายเซ็นว่าง → ไม่ผ่าน');

  console.log('\n== webhook flow ==');
  function makeDeps(mockText) {
    const engine = createMockEngine({ rawText: mockText });
    const lineClient = createMockLineClient();
    const writeback = createMockWriteback();
    return { engine, lineClient, writeback };
  }
  const imgEvent = { type: 'message', replyToken: 'rt1', message: { type: 'image', id: 'm1' }, source: { userId: 'U-driver1' } };

  // รูป → เบอร์เช็คดิจิตถูก (MSKU1234565) → reply มีเลข + ✅ + quick reply
  {
    const d = makeDeps('เบอร์ตู้ MSKU 123456 5 ขนาด 40HQ');
    const res = await handleEvent(imgEvent, d);
    const reply = d.lineClient.calls.find((c) => c.fn === 'replyMessage');
    const msg = reply && reply.messages[0];
    ok(res.ok === true && res.candidates.length === 1 && res.candidates[0].ok, 'อ่านรูป → เจอเบอร์ที่เช็คดิจิตผ่าน', res);
    ok(msg && msg.text.includes('MSKU1234565') && msg.text.includes('✅'), 'reply มีเลข + ✅', msg && msg.text);
    ok(msg && msg.quickReply && msg.quickReply.items.some((i) => i.action.data.includes('action=confirm&container=MSKU1234565')), 'quick reply มีปุ่ม ✓ ยืนยัน');
    ok(msg && msg.quickReply.items.some((i) => i.action.data === 'action=retake'), 'quick reply มีปุ่ม ↻ ถ่ายใหม่');
    ok(d.writeback.records.length === 0, 'แค่ส่งรูป ยังไม่เขียนใบงาน (ต้องรอกดยืนยัน)');
  }

  // รูป → เช็คดิจิตผิด → reply มี ⚠️ + ข้อเสนอซ่อม + ไม่เรียก writeback
  {
    const d = makeDeps('CSQU 3O5438 3'); // 0 ถูกอ่านเป็น O — format ยังผ่านไหม? ไม่ผ่าน → ใช้เลขผิดแทน
    d.engine.setMockText('CSQU3054384'); // เช็คดิจิตผิด (ถูกคือ 3)
    const res = await handleEvent(imgEvent, d);
    const reply = d.lineClient.calls.find((c) => c.fn === 'replyMessage');
    const msg = reply && reply.messages[0];
    ok(res.ok === true && res.candidates[0].ok === false, 'เช็คดิจิตผิด → ธง ok:false', res.candidates);
    ok(msg && msg.text.includes('⚠️') && msg.text.includes('ไม่ผ่าน'), 'reply มี ⚠️ ไม่ผ่าน', msg && msg.text);
    ok(d.writeback.records.length === 0, 'เช็คดิจิตผิด → ไม่เรียก writeback เด็ดขาด');
  }

  // รูป → เบอร์ที่ซ่อมได้ (O ปนในโซนเลข) → reply เสนอเบอร์ซ่อมให้กดเลือก
  {
    const d = makeDeps('พ่นข้าง CSQU3O54383 เลอะๆ');
    const res = await handleEvent(imgEvent, d);
    const reply = d.lineClient.calls.find((c) => c.fn === 'replyMessage');
    const msg = reply && reply.messages[0];
    // "CSQU3O54383" format ไม่ผ่าน (มี O ในโซนเลข) → extract ไม่จับ → ไม่มี candidate
    ok(res.candidates.length === 0 && msg && msg.text.includes('ไม่เจอ'), 'ตัวอักษรปนโซนเลข → extract ไม่จับ บอกให้ถ่ายใหม่', res);
  }

  // รูป → ไม่มีเบอร์เลย → reply บอกถ่ายใหม่
  {
    const d = makeDeps('ท้องฟ้า ต้นไม้ ไม่มีตู้');
    const res = await handleEvent(imgEvent, d);
    const reply = d.lineClient.calls.find((c) => c.fn === 'replyMessage');
    ok(res.ok === true && res.candidates.length === 0, 'ไม่มีเบอร์ → candidates ว่าง');
    ok(reply && reply.messages[0].text.includes('ถ่ายใหม่'), 'reply แนะให้ถ่ายใหม่');
  }

  // postback ยืนยันเบอร์ถูก → mockWriteback ถูกเรียกด้วย jobUid + เบอร์ + คนยืนยัน
  {
    const d = makeDeps('');
    const pbEvent = {
      type: 'postback', replyToken: 'rt2',
      postback: { data: 'action=confirm&container=MSKU1234565&jobUid=JOB-001' },
      source: { userId: 'U-driver1' }
    };
    const res = await handleEvent(pbEvent, d);
    ok(res.ok === true && res.written === true, 'ยืนยัน → เขียนสำเร็จ', res);
    ok(d.writeback.records.length === 1
      && d.writeback.records[0].containerNo === 'MSKU1234565'
      && d.writeback.records[0].jobUid === 'JOB-001'
      && d.writeback.records[0].confirmedBy === 'U-driver1',
      'writeback ได้ jobUid + เบอร์ + คนยืนยัน ครบถูก', d.writeback.records);
    const reply = d.lineClient.calls.find((c) => c.fn === 'replyMessage');
    ok(reply && reply.messages[0].text.includes('MSKU1234565'), 'reply ยืนยันมีเลขที่บันทึก');
  }

  // postback ยืนยันเบอร์ที่เช็คดิจิตผิด (เช่น payload ถูกดัดแปลง) → ห้ามเขียน
  {
    const d = makeDeps('');
    const pbEvent = {
      type: 'postback', replyToken: 'rt3',
      postback: { data: 'action=confirm&container=MSKU1234560&jobUid=JOB-002' },
      source: { userId: 'U-driver1' }
    };
    const res = await handleEvent(pbEvent, d);
    ok(res.ok === false && res.reason === 'check-digit-failed', 'ยืนยันเบอร์ผิด → ปฏิเสธ', res);
    ok(d.writeback.records.length === 0, 'เบอร์ผิด → writeback ไม่ถูกเรียก');
  }

  // postback ถ่ายใหม่
  {
    const d = makeDeps('');
    const res = await handleEvent({ type: 'postback', replyToken: 'rt4', postback: { data: 'action=retake' } }, d);
    ok(res.ok === true && res.action === 'retake' && d.writeback.records.length === 0, 'ถ่ายใหม่ → ตอบรับ ไม่เขียนอะไร');
  }

  // event ชนิดอื่นไม่พัง
  {
    const d = makeDeps('');
    const res = await handleEvent({ type: 'message', replyToken: 'rt5', message: { type: 'text', text: 'สวัสดี' } }, d);
    ok(res.ok === false && res.reason === 'unsupported-event', 'event ข้อความธรรมดา → unsupported ไม่ throw');
  }

  console.log('\n== engine: chooseEngine + stub ซื่อสัตย์ ==');
  ok(chooseEngine({}).provider === 'mock', 'ไม่ตั้ง OCR_PROVIDER → default mock');
  ok(chooseEngine(undefined).provider === 'mock', 'env undefined → default mock');
  ok(chooseEngine({ OCR_PROVIDER: 'ไม่รู้จัก' }).provider === 'mock', 'provider แปลก → ถอยมา mock');
  const qr = await qwen.readImage(new Uint8Array());
  ok(qr.ok === false && qr.reason === 'not-implemented', 'qwen stub ตอบ not-implemented (ไม่โกหก)', qr);
  const vr = await vision.readImage(new Uint8Array());
  ok(vr.ok === false && vr.reason === 'not-implemented', 'vision stub ตอบ not-implemented', vr);
  const tr = await typhoon.readImage(new Uint8Array());
  ok(tr.ok === false && tr.reason === 'not-implemented', 'typhoon stub ตอบ not-implemented', tr);
  const qe = chooseEngine({ OCR_PROVIDER: 'qwen' });
  const qe1 = await qe.readImage(new Uint8Array());
  ok(qe.provider === 'qwen' && qe1.ok === false, 'chooseEngine("qwen") ได้ stub จริง ไม่ใช่ mock');
  const lc = createLineClient({});
  const lcr = await lc.replyMessage('x', []);
  ok(lcr.ok === false && lcr.reason === 'not-implemented', 'LINE client จริงยังไม่ implement → ตอบตรงๆ');

  console.log('\n== worker (fetch handler) ==');
  // /health โหมด mock
  {
    const res = await worker.fetch(new Request('http://localhost/health'), { OCR_PROVIDER: 'mock' }, {});
    const j = await res.json();
    ok(res.status === 200 && j.ok === true && j.provider === 'mock' && j.mock === true, 'GET /health → ok + provider + mock:true', j);
  }
  // POST webhook ไม่มี secret = โหมด mock ตอบ 200 พร้อมธง
  {
    const wbody = JSON.stringify({ events: [] });
    const res = await worker.fetch(new Request('http://localhost/webhook/line', { method: 'POST', body: wbody }), {}, {});
    const j = await res.json();
    ok(res.status === 200 && j.mock === true, 'POST ไม่มี secret → 200 + mock:true', j);
  }
  // POST มี secret + ลายเซ็นผิด → 401
  {
    const env = { LINE_CHANNEL_SECRET: secret };
    const wbody = JSON.stringify({ events: [] });
    const res = await worker.fetch(new Request('http://localhost/webhook/line', {
      method: 'POST', body: wbody, headers: { 'x-line-signature': 'ZmFrZQ==' }
    }), env, {});
    ok(res.status === 401, 'ลายเซ็นผิด → 401');
  }
  // POST มี secret + ลายเซ็นถูก → 200 และ event ถูกจัดการ
  {
    const env = { LINE_CHANNEL_SECRET: secret, OCR_PROVIDER: 'mock' };
    const wbody = JSON.stringify({ events: [imgEvent] });
    const sig = await hmacBase64(secret, wbody);
    const res = await worker.fetch(new Request('http://localhost/webhook/line', {
      method: 'POST', body: wbody, headers: { 'x-line-signature': sig }
    }), env, {});
    const j = await res.json();
    ok(res.status === 200 && j.handled === 1 && j.mock === false, 'ลายเซ็นถูก → 200 + จัดการ 1 event', j);
  }
  // body ไม่ใช่ JSON → 400
  {
    const res = await worker.fetch(new Request('http://localhost/webhook/line', { method: 'POST', body: 'ไม่ใช่ json' }), {}, {});
    ok(res.status === 400, 'body เพี้ยน → 400');
  }
  // เส้นทางไม่รู้จัก → 404
  {
    const res = await worker.fetch(new Request('http://localhost/อื่นๆ'), {}, {});
    ok(res.status === 404, 'path แปลก → 404');
  }


  // ========== ด่านฆ่า mutation (ตัวตรวจอิสระพิสูจน์ 28 ส.ค. 2569 ว่าเทสเดิมเจาะได้ 2 ทาง) ==========
  console.log('\n== ด่านฆ่า mutation: ตาราง ISO 6346 เทียบ implementation อิสระ ==');
  {
    // implementation ที่ 2 — สร้างตารางด้วยวิธี "ไล่ค่า ข้ามพหุคูณ 11" (check.js ใช้ตารางเขียนตรง ถ้าใครแก้ค่าตัวเดียว ด่านนี้จับได้)
    const LV = {};
    let v = 10;
    for (let i = 0; i < 26; i++) {
      while (v % 11 === 0) v++;
      LV[String.fromCharCode(65 + i)] = v;
      v++;
    }
    const cd2 = (first10) => {
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        const c = first10[i];
        sum += (c >= '0' && c <= '9' ? Number(c) : LV[c]) * Math.pow(2, i);
      }
      const m = sum % 11;
      return m === 10 ? 0 : m;
    };
    // ครอบตัวอักษรครบทั้ง 26 ตัว — แก้ค่าตัวไหนในตารางของ check.js ก็ต้องมีเคสตก
    let allMatch = true, firstDiff = '';
    for (let i = 0; i < 26; i++) {
      const L = String.fromCharCode(65 + i);
      const first10 = L + L + L + 'U' + '123456';
      const expect = cd2(first10);
      const got = computeCheckDigit(first10);
      if (got !== expect) { allMatch = false; firstDiff = first10 + ' อิสระ=' + expect + ' โค้ด=' + got; break; }
    }
    ok(allMatch, 'เช็คดิจิตตรงกับ implementation อิสระครบทั้ง 26 ตัวอักษร', firstDiff);

    // กฎ mod 11 ได้ 10 → ใช้ 0 — หา first10 ที่ sum%11 = 10 จริงๆ มาทดสอบตรงๆ
    let found = null;
    for (let n = 0; n < 100000 && !found; n++) {
      const serial = String(n).padStart(6, '0');
      const first10 = 'MSKU' + serial;
      let sum = 0;
      for (let i = 0; i < 10; i++) { const c = first10[i]; sum += (c >= '0' && c <= '9' ? Number(c) : LV[c]) * Math.pow(2, i); }
      if (sum % 11 === 10) found = first10;
    }
    ok(found !== null, 'หา first10 ที่ sum%11 = 10 เจอ (ใช้ทดสอบกฎ 10→0)', found || 'ไม่เจอ');
    ok(computeCheckDigit(found) === 0, '⭐ กฎ mod11=10 → เช็คดิจิตต้องเป็น 0 (mutation ถอด m===10?0:m ต้องตกด่านนี้)',
      found + ' → ' + computeCheckDigit(found));
    ok(validate(found + '0').ok === true, 'เบอร์เต็มที่ลงท้าย 0 จากกฎนี้ validate ผ่าน');

    // ขอบหลังของ extract ต้องเข้มเท่าขอบหน้า (ตัวอักษรต่อท้ายก็ห้ามจับ)
    ok(extractCandidates('CSQU3054383A').length === 0, 'เลขที่มีตัวอักษรต่อท้าย (CSQU3054383A) ต้องไม่ถูก extract');
    ok(extractCandidates('เบอร์ตู้ CSQU3054383 ครับ').length === 1, 'ขอบเป็นช่องว่าง/ตัวไทยยังจับได้ปกติ');
  }

  console.log('\n== ดึงรูปไม่สำเร็จ — คนขับต้องได้รับคำตอบ ไม่ใช่ความเงียบ ==');
  {
    const lineClient = createMockLineClient();
    lineClient.getMessageContent = async () => ({ ok: false, reason: 'download-failed' });
    const engine = createMockEngine('ไม่ควรถูกเรียก');
    const writeback = { calls: [], async fillContainer(x) { this.calls.push(x); return { ok: true }; } };
    const r = await handleEvent(
      { type: 'message', replyToken: 'rt1', message: { type: 'image', id: 'img1' }, source: { userId: 'U1' } },
      { lineClient, engine, writeback }
    );
    ok(r && r.replied === true, 'path ดึงรูปพัง มี reply กลับ (ธง replied)');
    const replies = lineClient.calls.filter((c) => c.fn === 'replyMessage');
    ok(replies.length === 1 && /ส่งรูปใหม่/.test(JSON.stringify(replies[0])),
      'ข้อความบอกคนขับให้ส่งรูปใหม่', JSON.stringify(replies[0] || {}).slice(0, 120));
    ok(writeback.calls.length === 0, 'ไม่มีการเรียก writeback ใน path นี้');
  }


  // ========== ทาง ③ d1 staging (เจ้าของเคาะ 28 ส.ค. 2569) — วงจรเต็ม: ยืนยัน → พัก → เว็บดึง → ติดธง ==========
  console.log('\n== d1 staging: บอทไม่แตะชีท เว็บดึงเอง ==');
  {
    const { makeMemoryStagingRepo, makeD1StagingRepo } = await import('../src/db/staging.js');
    const { chooseWriteback } = await import('../src/writeback/index.js');
    const { readFile } = await import('node:fs/promises');

    // interface memory ต้องเท่า D1 เป๊ะ (ด่านกัน stub หลวม — บทเรียนโปรเจกต์แม่)
    const mem = makeMemoryStagingRepo();
    const d1 = makeD1StagingRepo({ prepare() { return { bind() { return this; }, run() {}, first() {}, all() {} }; } });
    ok(JSON.stringify(Object.keys(mem).sort()) === JSON.stringify(Object.keys(d1).sort()),
      'interface memory staging = D1 staging เป๊ะ', Object.keys(mem));

    // วงจรเต็มผ่าน webhook จริง
    const repo = makeMemoryStagingRepo();
    const lineClient = createMockLineClient();
    const writeback = chooseWriteback({ WRITEBACK_PROVIDER: 'd1' }, repo);
    ok(writeback.provider === 'd1', 'chooseWriteback(d1) ได้ adapter ตัวจริง ไม่ใช่ stub');
    const r = await handleEvent(
      { type: 'postback', replyToken: 'rt9', timestamp: 1756350000000,
        postback: { data: 'action=confirm&container=CSQU3054383&jobUid=J-001' },
        source: { userId: 'U-driver-1' } },
      { lineClient, engine: createMockEngine(''), writeback }
    );
    ok(r && r.ok === true, 'คนขับกดยืนยัน → สำเร็จ');
    const staged = await repo.listResults();
    ok(staged.length === 1 && staged[0].container_no === 'CSQU3054383' && staged[0].job_uid === 'J-001'
      && staged[0].confirmed_by === 'U-driver-1' && staged[0].ts === 1756350000000,
      'ผลไปพักใน staging ครบทุกช่อง (เบอร์/งาน/คนยืนยัน/เวลา)', staged[0]);

    // เช็คดิจิตผิด → ห้ามมีอะไรลง staging
    await handleEvent(
      { type: 'postback', replyToken: 'rt10', timestamp: 1756350001000,
        postback: { data: 'action=confirm&container=CSQU3054384' }, source: { userId: 'U-driver-1' } },
      { lineClient, engine: createMockEngine(''), writeback }
    );
    ok((await repo.listResults()).length === 1, '⭐ เช็คดิจิตผิดตอน postback → staging ไม่โต (payload ดัดแปลงเข้าไม่ได้)');

    // เว็บดึง → ติดธง pulled → หายจากคิว default แต่แถวไม่ถูกลบ
    const p1 = await repo.markPulled(staged[0].id, 'ธุรการ-A', 1756350100000);
    ok(p1.ok === true, 'เว็บติดธง pulled สำเร็จ');
    ok((await repo.listResults()).length === 0, 'ดึงแล้วหายจากคิว confirmed (ไม่โผล่ซ้ำ)');
    const all = await repo.listResults({ status: 'all' });
    ok(all.length === 1 && all[0].status === 'pulled' && all[0].pulled_by === 'ธุรการ-A',
      'แถวไม่ถูกลบ — ติดธงไว้สาวย้อนได้ว่าใครดึงเมื่อไหร่');
    const p2 = await repo.markPulled(staged[0].id, 'ธุรการ-B', 1756350200000);
    ok(p2.ok === false && p2.reason === 'already-pulled', 'ดึงซ้ำ = ปฏิเสธพร้อมบอกว่าใครดึงไปแล้ว (กันใช้เบอร์ซ้ำ 2 ใบ)');

    // กรองตาม driverId / jobUid
    await repo.insertResult({ containerNo: 'MSKU9070323', confirmedBy: 'U2', driverId: 'D002', ts: 1 });
    await repo.insertResult({ containerNo: 'TCLU1234568', confirmedBy: 'U3', driverId: 'D003', jobUid: 'J-777', ts: 2 });
    ok((await repo.listResults({ driverId: 'D002' })).length === 1, 'กรองตาม driverId ได้');
    ok((await repo.listResults({ jobUid: 'J-777' }))[0].container_no === 'TCLU1234568', 'กรองตาม jobUid ได้');

    // worker มี endpoint ให้เว็บดึง + ด่าน PULL_TOKEN + schema ตรงชื่อตาราง
    const wsrc = await readFile(new URL('../src/worker/index.js', import.meta.url), 'utf8');
    ok(wsrc.includes("'/api/ocr/results'") && wsrc.includes("'/api/ocr/pulled'"), 'worker มี endpoint ดึงผล + ติดธง');
    ok(wsrc.includes('PULL_TOKEN') && wsrc.includes('pullAuthorized'), 'endpoint ดึงผลมีด่าน PULL_TOKEN');
    const schema = await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
    ok(/CREATE TABLE IF NOT EXISTS ocr_results/.test(schema) && /status/.test(schema) && /pulled_by/.test(schema),
      'schema.sql มีตาราง ocr_results ครบช่อง status/pulled_by');
  }

  console.log('\nผ่าน ' + pass + ' · ตก ' + fail);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('เทสพังกลางทาง:', e);
  console.log('\nผ่าน ' + pass + ' · ตก ' + (fail + 1));
  process.exit(1);
});
