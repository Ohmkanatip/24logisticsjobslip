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
    // ⚠️ เดิมล็อกไว้ว่า "ตัวอักษรปนโซนเลข = ยอมแพ้ บอกถ่ายใหม่" — ตอนนี้กู้ได้แล้ว (เจ้าของชี้หลักตำแหน่ง ISO 28 ส.ค.)
    ok(res.ok === true && Array.isArray(res.nearFixes) && res.nearFixes.indexOf('CSQU3054383') >= 0,
      '⭐ ตัวอักษรปนโซนเลข (CSQU3O54383) → กู้ด้วยตำแหน่ง+เช็คดิจิต เสนอ CSQU3054383', res);
    ok(msg && /น่าจะเป็นเบอร์นี้/.test(msg.text), 'บอกคนขับว่าเป็นการเดา ให้กดยืนยันเอง');
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
  {
    // ⚠️ เดิมเทสนี้ล็อกพฤติกรรมอันตรายไว้: "provider แปลก → ถอยมา mock"
    //    ของจริงคือ พิมพ์ชื่อ engine ผิดตัวเดียว = คนขับได้เบอร์ตู้ปลอมทุกรูป (เช็คดิจิตผ่านด้วย)
    //    กติกาใหม่: ตั้งค่ามาแต่ไม่รู้จัก = ล้มดังๆ · ไม่ได้ตั้งเลย = mock ได้ (โหมด dev)
    const unknown = chooseEngine({ OCR_PROVIDER: 'qwen-vl' });
    ok(unknown.unknown === true && unknown.provider === 'qwen-vl',
      '⭐ ตั้ง OCR_PROVIDER ผิด → ไม่ถอยมา mock (ติดธง unknown)', unknown.provider);
    ok((await unknown.readImage(new Uint8Array())).reason === 'unknown-ocr-provider',
      '⭐ engine ที่ไม่รู้จักต้องตอบว่าอ่านไม่ได้ ไม่ใช่คืนเบอร์ปลอม');
    ok(chooseEngine({}).provider === 'mock', 'ไม่ได้ตั้งค่าเลย = mock (โหมด dev ตามเอกสาร)');
    ok(chooseEngine({ OCR_PROVIDER: 'mock' }).provider === 'mock', "ตั้ง 'mock' เองอย่างจงใจ = mock");
  }
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


  // ══ ล็อกบั๊กที่ตัวตรวจอิสระเจอ 28 ส.ค. 2569 (พิสูจน์แล้วทุกข้อก่อนแก้) ══
  console.log('\n== ล็อกบั๊กจากรีวิว adversarial ==');
  {
    const { makeMemoryStagingRepo } = await import('../src/db/staging.js');
    const { chooseWriteback } = await import('../src/writeback/index.js');
    const worker2 = (await import('../src/worker/index.js')).default;

    // ① ข้อความถึงคนขับต้องไม่หลอกว่า "เข้าใบงานแล้ว" ทั้งที่แค่พักรอเว็บดึง
    {
      const repo = makeMemoryStagingRepo();
      const lc = createMockLineClient();
      await handleEvent(
        { type: 'postback', replyToken: 'rtA', timestamp: 1756000000000,
          postback: { data: 'action=confirm&container=CSQU3054383' }, source: { userId: 'U1' } },
        { lineClient: lc, engine: createMockEngine(''), writeback: chooseWriteback({ WRITEBACK_PROVIDER: 'd1' }, repo) }
      );
      const txt = JSON.stringify(lc.calls.filter((c) => c.fn === 'replyMessage').pop());
      ok(!/เข้าใบงาน/.test(txt), '⭐ ทาง staging: ห้ามบอกคนขับว่า "เข้าใบงานเรียบร้อย" (ยังไม่เข้า)', txt.slice(0, 120));
      ok(/ส่งให้ออฟฟิศ/.test(txt), 'บอกตามจริงว่าส่งให้ออฟฟิศแล้ว');
    }

    // ② ลืมตั้ง WRITEBACK_PROVIDER ต้องไม่หล่นลง mock (ข้อมูลหายเงียบ)
    {
      const repo = makeMemoryStagingRepo();
      const w = chooseWriteback({}, repo);
      ok(w.provider === 'mock', 'chooseWriteback({}) ยังเป็น mock ตามสัญญาเดิมของฟังก์ชัน');
      const src = await (await import('node:fs/promises')).readFile(new URL('../src/worker/index.js', import.meta.url), 'utf8');
      ok(/WRITEBACK_PROVIDER\)\s*\|\|\s*'d1'/.test(src),
        '⭐ worker ใช้ค่าเริ่มต้น d1 (ลืมตั้ง env = ยังเข้า staging ไม่ใช่หายลง mock)');
    }

    // ③ memory กับ D1 ต้องเรียงเหมือนกัน (ทั้งคู่ id มาก→น้อย)
    {
      const repo = makeMemoryStagingRepo();
      await repo.insertResult({ containerNo: 'AAAU0000001', ts: 1 });
      await repo.insertResult({ containerNo: 'BBBU0000002', ts: 2 });
      const ids = (await repo.listResults()).map((r) => r.id);
      ok(ids[0] === 2 && ids[1] === 1, '⭐ memory เรียง id มาก→น้อย ตรงกับ D1 (ORDER BY id DESC)', ids);
    }

    // ④ insertResult ของ D1 ต้องตรวจผลจริง ไม่ใช่ ok:true เสมอ
    {
      const { makeD1StagingRepo } = await import('../src/db/staging.js');
      const failDb = { prepare: () => ({ bind() { return this; }, async run() { return { success: false }; } }) };
      const r = await makeD1StagingRepo(failDb).insertResult({ containerNo: 'CSQU3054383' });
      ok(r.ok === false, '⭐ D1 เขียนไม่สำเร็จ → insertResult ต้องคืน ok:false (เดิมคืน true เสมอ)', r);
      const noIdDb = { prepare: () => ({ bind() { return this; }, async run() { return { success: true, meta: {} }; } }) };
      ok((await makeD1StagingRepo(noIdDb).insertResult({ containerNo: 'CSQU3054383' })).ok === false,
        'ไม่ได้ row id กลับมา = ถือว่าไม่สำเร็จ');
    }

    // ⑤ markPulled ของ D1 ต้องเป็น UPDATE คำสั่งเดียว (กัน race ดึงเบอร์เดียวไป 2 ใบ)
    {
      const { makeD1StagingRepo } = await import('../src/db/staging.js');
      const sqls = [];
      const db = { prepare(sql) { sqls.push(sql); return { bind() { return this; },
        async run() { return { meta: { changes: 1 } }; }, async first() { return null; } }; } };
      const r = await makeD1StagingRepo(db).markPulled(5, 'ธุรการ', 1);
      ok(r.ok === true, 'markPulled สำเร็จเมื่อ UPDATE โดนแถว');
      ok(sqls.length === 1 && /UPDATE/.test(sqls[0]) && /status\s*=\s*'confirmed'/.test(sqls[0]),
        "⭐ ใช้ UPDATE ... WHERE status='confirmed' คำสั่งเดียว (เดิม SELECT แล้ว UPDATE = มี race)", sqls);
      const db2 = { prepare(sql) { return { bind() { return this; },
        async run() { return { meta: { changes: 0 } }; },
        async first() { return { status: 'pulled', pulled_by: 'คนแรก' }; } }; } };
      const r2 = await makeD1StagingRepo(db2).markPulled(5, 'คนที่สอง', 1);
      ok(r2.ok === false && r2.reason === 'already-pulled' && r2.pulledBy === 'คนแรก',
        'คนที่ 2 ถูกปฏิเสธพร้อมบอกว่าใครดึงไปแล้ว', r2);
    }

    // ⑥ ขึ้นของจริงแล้วลืมตั้ง PULL_TOKEN = ปฏิเสธ ไม่ใช่เปิดโล่ง
    {
      const prodEnv = { LINE_CHANNEL_SECRET: 'x' };   // มี secret = ไม่ใช่โหมดทดลอง
      const res = await worker2.fetch(new Request('http://x/api/ocr/results'), prodEnv, {});
      const body = await res.json();
      ok(res.status === 503 && body.reason === 'server-misconfigured',
        '⭐ โหมดจริงไม่มี PULL_TOKEN → ปฏิเสธ 503 (เดิมเปิดโล่งให้ใครก็อ่านได้)', { status: res.status, body });
      const devRes = await worker2.fetch(new Request('http://x/api/ocr/results'), {}, {});
      ok(devRes.status === 200, 'โหมดทดลองในเครื่องยังใช้ได้สะดวกเหมือนเดิม');
      const okRes = await worker2.fetch(new Request('http://x/api/ocr/results', { headers: { authorization: 'Bearer t' } }),
        { LINE_CHANNEL_SECRET: 'x', PULL_TOKEN: 't' }, {});
      ok(okRes.status === 200, 'ตั้ง token แล้วแนบถูก = ผ่าน');
      const badRes = await worker2.fetch(new Request('http://x/api/ocr/results', { headers: { authorization: 'Bearer wrong-token' } }),
        { LINE_CHANNEL_SECRET: 'x', PULL_TOKEN: 't' }, {});
      ok(badRes.status === 401, 'token ผิด = 401');
    }

    // ⑦ CORS — เว็บ jobslip อยู่คนละโดเมน ไม่มี header นี้ = ดึงผลไม่ได้เลย
    {
      const env = { ALLOW_ORIGIN: 'https://ohmkanatip.github.io' };
      const pre = await worker2.fetch(new Request('http://x/api/ocr/results', { method: 'OPTIONS' }), env, {});
      ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === env.ALLOW_ORIGIN,
        '⭐ ตอบ preflight (OPTIONS) พร้อม allow-origin', pre.status);
      ok(/authorization/i.test(pre.headers.get('access-control-allow-headers') || ''),
        'อนุญาต header authorization (เว็บต้องแนบ token)');
      const got = await worker2.fetch(new Request('http://x/api/ocr/results'), env, {});
      ok(got.headers.get('access-control-allow-origin') === env.ALLOW_ORIGIN, 'GET จริงก็มี allow-origin');
      const noCors = await worker2.fetch(new Request('http://x/api/ocr/results'), {}, {});
      ok(!noCors.headers.get('access-control-allow-origin'), 'ไม่ตั้ง ALLOW_ORIGIN = ไม่ปล่อย CORS (ปลอดภัยไว้ก่อน)');
    }

    // ⑧ /api/ocr/pulled แยกรหัสสถานะให้ฝั่งเว็บอ่านออก
    {
      const env = {};
      const r1 = await worker2.fetch(new Request('http://x/api/ocr/pulled', { method: 'POST',
        body: JSON.stringify({ id: 999999, by: 'ธุรการ' }) }), env, {});
      ok(r1.status === 404, '⭐ ไม่มีแถวนี้ = 404 (เดิมเหมารวม 409 ทุกกรณี)', r1.status);
    }
  }


  // ══ อุดรูที่ mutation test เจอ (28 ส.ค. 2569) ══
  console.log('\n== อุดรูจาก mutation test ==');
  {
    const { verifySignature, hmacBase64 } = await import('../src/line/signature.js');
    const { makeD1StagingRepo } = await import('../src/db/staging.js');

    // ① ขอบหน้าของ regex — เบอร์ที่ติดอยู่ท้ายคำอื่นต้องไม่ถูกจับ
    ok(extractCandidates('XCSQU3054383').length === 0, '⭐ มีตัวอักษรนำหน้าติดกัน (XCSQU…) ต้องไม่ถูกจับ');
    ok(extractCandidates('9CSQU3054383').length === 0, 'มีตัวเลขนำหน้าติดกัน ต้องไม่ถูกจับ');
    ok(extractCandidates('ตู้:CSQU3054383').length === 1, 'มีตัวไทย/เครื่องหมายคั่น ยังจับได้ปกติ');

    // ② ด่านต้นทางของ verifySignature — ค่าที่ใช้ไม่ได้ต้องคืน false ไม่ใช่ throw
    const body = '{"events":[]}';
    const goodSig = await hmacBase64('secret', body);
    ok((await verifySignature('secret', body, goodSig)) === true, 'ลายเซ็นถูกผ่าน');
    for (const [sec, bd, sig, name] of [
      ['secret', body, '', 'ลายเซ็นว่าง'],
      ['', body, goodSig, 'secret ว่าง'],
      ['secret', null, goodSig, 'body เป็น null'],
      ['secret', { a: 1 }, goodSig, 'body เป็น object'],
      ['secret', body, null, 'ลายเซ็นเป็น null'],
      ['secret', body, 12345, 'ลายเซ็นเป็นตัวเลข'],
    ]) {
      let threw = false, r = null;
      try { r = await verifySignature(sec, bd, sig); } catch (e) { threw = true; }
      ok(!threw && r === false, '⭐ ' + name + ' → คืน false ไม่ throw', { threw, r });
    }

    // ③ insertResult ต้องดูธง success ไม่ใช่แค่ row id
    {
      // D1 บอกว่าไม่สำเร็จ แต่ยังส่ง row id มาด้วย — ต้องเชื่อธง success
      const db = { prepare: () => ({ bind() { return this; }, async run() { return { success: false, meta: { last_row_id: 7 } }; } }) };
      const r = await makeD1StagingRepo(db).insertResult({ containerNo: 'CSQU3054383' });
      ok(r.ok === false && r.reason === 'd1-insert-failed',
        '⭐ D1 ตอบ success:false ต้องถือว่าไม่สำเร็จ แม้จะมี row id มาด้วย', r);
    }
  }


  // ══ สลับ OCR engine ได้ด้วยค่า env ตัวเดียว (คำถามเจ้าของ 28 ส.ค.: "เปลี่ยนได้เรื่อยๆ ไหม") ══
  console.log('\n== สลับ engine ด้วย env ตัวเดียว ==');
  {
    const names = ['mock', 'gemini', 'qwen', 'vision', 'typhoon'];
    for (const n of names) {
      const e = chooseEngine({ OCR_PROVIDER: n });
      ok(e.provider === n, 'ตั้ง OCR_PROVIDER=' + n + ' → ได้ engine ' + n);
      ok(typeof e.readImage === 'function', n + ' มี readImage ครบตาม interface');
    }
    // engine จริงทุกตัวต้องเป็น stub ซื่อสัตย์ (ยังไม่ได้ต่อ API) — ห้ามแกล้งตอบสำเร็จ
    for (const n of ['gemini', 'qwen', 'vision', 'typhoon']) {
      const r = await chooseEngine({ OCR_PROVIDER: n }).readImage(new Uint8Array([1, 2, 3]));
      ok(r.ok === false && r.reason === 'not-implemented', '⭐ ' + n + ' ยังไม่ได้ต่อ API → ตอบ not-implemented ตรงๆ', r.reason);
      ok(typeof r.todo === 'string' && r.todo.length > 10, n + ' บอกด้วยว่าต้องทำอะไรถึงจะใช้ได้');
    }
    // เปลี่ยน engine ไม่กระทบส่วนอื่นเลย — เช็คดิจิต/extract/staging ใช้ตัวเดิมทั้งหมด
    ok(validate('CSQU3054383').ok === true, 'เช็คดิจิตทำงานเหมือนเดิมไม่ว่าใช้ engine ไหน');
  }


  // ══ เพดานของ LINE — เกินแล้วข้อความไม่ถูกส่ง คนขับเงียบสนิท (พิสูจน์แล้ว 28 ส.ค. 2569) ══
  console.log('\n== เพดานข้อความ LINE ==');
  {
    const { capMessages, LINE_TEXT_MAX, LINE_QUICKREPLY_MAX, createMockLineClient: mkc } = await import('../src/line/client.js');

    const long = capMessages([{ type: 'text', text: 'ก'.repeat(9000) }]);
    ok(long[0].text.length === LINE_TEXT_MAX, '⭐ ข้อความยาวเกินถูกตัดพอดีเพดาน (' + LINE_TEXT_MAX + ')', long[0].text.length);
    ok(long[0].text.endsWith('…'), 'ตัดแล้วติด … ให้รู้ว่าโดนตัด');
    const shortMsg = capMessages([{ type: 'text', text: 'สั้น' }]);
    ok(shortMsg[0].text === 'สั้น', 'ข้อความปกติไม่ถูกแตะ');

    const manyBtn = capMessages([{ type: 'text', text: 'x',
      quickReply: { items: Array.from({ length: 30 }, (_, i) => ({ type: 'action', i })) } }]);
    ok(manyBtn[0].quickReply.items.length === LINE_QUICKREPLY_MAX,
      '⭐ ปุ่มเกินถูกตัดเหลือ ' + LINE_QUICKREPLY_MAX + ' (LINE ปฏิเสธถ้าเกิน)', manyBtn[0].quickReply.items.length);

    ok(capMessages(null) === null && capMessages('x') === 'x', 'input แปลกๆ ไม่ทำให้พัง');
    ok(capMessages([null, 'ข้อความ', { type: 'text' }]).length === 3, 'สมาชิกที่ไม่ใช่ object ผ่านไปได้ไม่ throw');

    // ⭐ เคสจริง: postback ถูกดัดแปลงให้เบอร์ยาว 5,000 ตัว → ข้อความตอบต้องยังส่งออกได้
    const lc = mkc();
    await handleEvent(
      { type: 'postback', replyToken: 'rt', timestamp: 1,
        postback: { data: 'action=confirm&container=' + 'A'.repeat(5000) }, source: { userId: 'U' } },
      { lineClient: lc, engine: createMockEngine(''), writeback: { async fillContainer() { return { ok: true }; } } }
    );
    const txt = lc.calls.filter((c) => c.fn === 'replyMessage').pop().messages[0].text;
    ok(txt.length <= LINE_TEXT_MAX, '⭐ เบอร์ยาวผิดปกติ → ข้อความตอบยังอยู่ในเพดาน ส่งถึงคนขับได้', txt.length);
  }


  // ══ ด่านกันเอกสารเพี้ยน — ตัวแปรใหม่ที่โค้ดอ่าน ต้องถูกจดไว้ ไม่งั้นตอน deploy จะลืมตั้ง ══
  console.log('\n== เอกสารต้องตรงกับโค้ด ==');
  {
    const { readFile, readdir } = await import('node:fs/promises');
    const base = new URL('../', import.meta.url);
    async function walk(dir) {
      const out = [];
      for (const e of await readdir(new URL(dir, base), { withFileTypes: true })) {
        if (e.isDirectory()) out.push(...await walk(dir + e.name + '/'));
        else if (e.name.endsWith('.js')) out.push(dir + e.name);
      }
      return out;
    }
    const files = await walk('src/');
    const used = new Set();
    for (const f of files) {
      const t = await readFile(new URL(f, base), 'utf8');
      for (const m of t.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
    }
    ok(used.size > 0, 'สแกนเจอตัวแปร env ที่โค้ดใช้', [...used].join(' '));

    const example = await readFile(new URL('.dev.vars.example', base), 'utf8');
    const wrangler = await readFile(new URL('wrangler.jsonc', base), 'utf8');
    const missing = [...used].filter((v) => !example.includes(v) && !wrangler.includes(v));
    ok(missing.length === 0,
      '⭐ ทุกตัวแปรที่โค้ดอ่าน ต้องถูกจดใน .dev.vars.example หรือ wrangler.jsonc', missing);

    const documented = [...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
    for (const v of documented.filter((x) => !used.has(x))) {
      const lines = example.split('\n');
      const i = lines.findIndex((l) => l.startsWith(v + '='));
      const above = lines.slice(Math.max(0, i - 3), i).join(' ');
      ok(/ยังไม่ได้ใช้/.test(above), 'ตัวแปร ' + v + ' ที่โค้ดยังไม่อ่าน ต้องติดป้าย [ยังไม่ได้ใช้]', above.slice(0, 80));
    }
    // เอกสารต้องบอกด้วยว่า DB เป็น binding ไม่ใช่ตัวแปรลับ (ไม่งั้นคนตั้งใน .dev.vars แล้วงง)
    ok(/binding/i.test(example), 'อธิบายไว้ว่า D1 เป็น binding ใน wrangler ไม่ใช่ค่าใน .dev.vars');
  }


  // ══ กู้เคส "AI อ่านตัวอักษรเป็นตัวเลข" — เคสที่ผิดบ่อยที่สุดในโลกจริง (28 ส.ค. 2569) ══
  //   เดิม: extract รับเฉพาะ [A-Z]{4} → C5QU… หาไม่เจอ → บอทตอบ "ไม่เจอ" → suggestRepairs ไม่เคยถูกเรียก
  //   = ฟีเจอร์เสนอตัวซ่อมตายสนิทในเส้นทางจริง (ผู้ตรวจอิสระทักไว้ถูก — ยืนยันด้วยหน้าลองเล่น)
  console.log('\n== กู้เคสตัวอักษรถูกอ่านเป็นเลข ==');
  {
    const { extractNearMisses } = await import('../src/ocr/extract.js');

    ok(extractNearMisses('C5QU3054383')[0] === 'C5QU3054383', 'จับ near-miss ได้ (S ถูกอ่านเป็น 5)');
    ok(extractNearMisses('0OLU5500990')[0] === '0OLU5500990', 'จับ near-miss ได้ (O ถูกอ่านเป็น 0)');
    ok(extractNearMisses('CSQU3054383').length === 0, '⭐ เบอร์ที่รูปแบบถูกอยู่แล้ว ไม่นับเป็น near-miss (ไปทางปกติ)');
    ok(extractNearMisses('ตู้สกปรกอ่านไม่ออก').length === 0, 'ข้อความที่ไม่มีเบอร์เลย = ไม่มี near-miss');
    ok(extractNearMisses('12345678901').length === 0, 'เลขล้วน 11 หลัก ไม่ใช่ near-miss (ไม่มีตัวอักษรเลย)');
    ok(extractNearMisses(null).length === 0 && extractNearMisses(123).length === 0, 'input แปลกไม่ throw');

    // วงจรเต็มผ่าน webhook จริง: อ่านผิด → บอทเสนอตัวที่ถูก → คนขับกดยืนยัน → เข้า staging
    const { makeMemoryStagingRepo } = await import('../src/db/staging.js');
    const { chooseWriteback } = await import('../src/writeback/index.js');
    const repo = makeMemoryStagingRepo();
    const wb = chooseWriteback({ WRITEBACK_PROVIDER: 'd1' }, repo);
    const lc = createMockLineClient();
    const r = await handleEvent(
      { type: 'message', replyToken: 'rt', timestamp: 1, message: { type: 'image', id: 'i' }, source: { userId: 'U1' } },
      { lineClient: lc, engine: createMockEngine({ rawText: 'C5QU3054383' }), writeback: wb }
    );
    ok(r.ok === true && r.nearFixes && r.nearFixes[0] === 'CSQU3054383',
      '⭐⭐ AI อ่าน C5QU… → บอทเสนอ CSQU3054383 (เดิมตอบ "หาไม่เจอ" แล้วจบ)', r.nearFixes);
    const msg = lc.calls.filter((c) => c.fn === 'replyMessage').pop().messages[0];
    ok(/ตัวอักษรอาจถูกอ่านเป็นตัวเลข/.test(msg.text), 'บอกคนขับตรงๆ ว่าทำไมถึงเสนอตัวนี้');
    const btns = (msg.quickReply.items || []).map((i) => i.action.data).join(' ');
    ok(/container=CSQU3054383/.test(btns), 'มีปุ่มให้กดยืนยันเบอร์ที่ซ่อมได้');
    ok((await repo.listResults()).length === 0, '⭐ ยังไม่เขียนอะไรลงฐาน — ต้องรอคนขับกดยืนยันก่อนเสมอ');

    // กดยืนยัน → เข้า staging (ตรวจเช็คดิจิตซ้ำอีกชั้นตอน postback)
    await handleEvent(
      { type: 'postback', replyToken: 'rt2', timestamp: 2,
        postback: { data: 'action=confirm&container=CSQU3054383' }, source: { userId: 'U1' } },
      { lineClient: lc, engine: createMockEngine({ rawText: '' }), writeback: wb }
    );
    const staged = await repo.listResults();
    ok(staged.length === 1 && staged[0].container_no === 'CSQU3054383', 'กดยืนยันแล้วเข้าตารางพักผลถูกต้อง');

    // ⚠️ ห้ามเสนอมั่ว: near-miss ที่ซ่อมยังไงก็ไม่ผ่านเช็คดิจิต ต้องตอบ "ไม่เจอ" ตามปกติ
    const lc2 = createMockLineClient();
    const r2 = await handleEvent(
      { type: 'message', replyToken: 'rt3', timestamp: 3, message: { type: 'image', id: 'i' }, source: { userId: 'U1' } },
      { lineClient: lc2, engine: createMockEngine({ rawText: '1111111111 1' }), writeback: wb }
    );
    ok(!r2.nearFixes || !r2.nearFixes.length, '⭐ ซ่อมไม่ได้ = ไม่เสนอมั่ว (ตอบไม่เจอตามปกติ)');
  }


  // ══ แก้ตามตำแหน่ง ISO (เจ้าของชี้หลัก 28 ส.ค. 2569): อักษร 4 + เลข 7 → ตำแหน่งบอกชนิด · เช็คดิจิตชี้ขาด ══
  console.log('\n== positionCandidates: ตำแหน่งบอกชนิด + เช็คดิจิตเป็นกรรมการ ==');
  {
    const { positionCandidates, normalizeByPosition } = await import('../src/iso6346/check.js');

    // เคสที่คุยกับเจ้าของ: S ในโซนเลข เป็นได้ทั้ง 5 และ 8 — เช็คดิจิตต้องชี้ขาดได้
    const amb = positionCandidates('CSQU30543S3');
    ok(amb.ok && amb.candidates.length === 2, 'S ในโซนเลข → ลอง 2 ทาง (5 และ 8)', amb.candidates);
    const good = amb.candidates.filter((c) => validate(c).ok);
    ok(good.length === 1 && good[0] === 'CSQU3054383',
      '⭐ เช็คดิจิต (สูตรยกกำลัง ISO) ชี้ขาดเหลือตัวเดียว: 8 ถูก · 5 ผิด', good);

    // แก้หลายตำแหน่งพร้อมกัน (เดิมทำไม่ได้)
    const multi = positionCandidates('C5QU3O54383');
    ok(multi.ok && multi.candidates.some((c) => c === 'CSQU3054383'), '⭐ ผิด 2 ตัว (S→5 + 0→O) แก้ได้ทีเดียว');
    ok(multi.fixed.length === 2, 'รายงานว่าแก้ตำแหน่งไหนบ้าง', multi.fixed);

    // ตัวที่ไม่มีคู่หน้าตาคล้าย = บอกตรงๆ ว่าแก้ไม่ได้ ไม่เดามั่ว
    const bad = positionCandidates('C3QU3054383');
    ok(bad.ok === false && bad.reason === 'unfixable-char', '⭐ เลข 3 ในโซนอักษร ไม่มีตัวไหนหน้าตาเหมือน = ไม่เดา', bad.reason);

    // เบอร์ที่ถูกอยู่แล้ว = ผ่านตรงๆ ไม่แตะ
    const okAlready = positionCandidates('CSQU3054383');
    ok(okAlready.ok && okAlready.candidates.length === 1 && okAlready.fixed.length === 0, 'เบอร์ถูกอยู่แล้วไม่ถูกแตะ');

    // เพดานจำนวนทางเลือก — กันระเบิดเมื่อเพี้ยนหลายตัวที่กำกวมพร้อมกัน
    const many = positionCandidates('0O10SSGGBB0'.slice(0,4) + 'SSGGBB0'.replace(/./g, 'S'));
    ok(!many.ok || many.candidates.length <= 12, 'จำกัดทางเลือกไม่เกิน 12 (เสนอเยอะ = คนขับสับสน)');
    ok(normalizeByPosition('C5QU3054383').value === 'CSQU3054383', 'normalizeByPosition คืนตัวเลือกแรก (compat เดิม)');

    // วงจรเต็ม: เคส S ในโซนเลข ผ่าน webhook จริง → เสนอเบอร์ที่เช็คดิจิตยืนยันแล้ว
    const { makeMemoryStagingRepo } = await import('../src/db/staging.js');
    const { chooseWriteback } = await import('../src/writeback/index.js');
    const repo = makeMemoryStagingRepo();
    const lc = createMockLineClient();
    const r = await handleEvent(
      { type: 'message', replyToken: 'rt', timestamp: 1, message: { type: 'image', id: 'i' }, source: { userId: 'U1' } },
      { lineClient: lc, engine: createMockEngine({ rawText: 'CSQU30543S3' }), writeback: chooseWriteback({ WRITEBACK_PROVIDER: 'd1' }, repo) }
    );
    ok(r.nearFixes && r.nearFixes.length === 1 && r.nearFixes[0] === 'CSQU3054383',
      '⭐⭐ webhook เสนอเฉพาะตัวที่เช็คดิจิตยืนยัน (ไม่โยน 2 ทางให้คนขับงง)', r.nearFixes);
    ok((await repo.listResults()).length === 0, 'ยังไม่เขียนฐานจนกว่าคนขับกดยืนยัน (กติกาเหล็กเดิม)');
  }

  // ═══ V73: ผูก LINE userId ↔ driverId — driver_id ใน staging เลิกเป็น NULL ═══
  console.log('\n== V73: line_bindings — LINE↔driverId ==');
  const { makeMemoryStagingRepo } = await import('../src/db/staging.js');
  const { chooseWriteback } = await import('../src/writeback/index.js');
  {
    const repo = makeMemoryStagingRepo();
    ok((await repo.upsertBinding({ lineUserId: 'U1', driverId: 'D003', name: 'สมชาย', ts: 1000 })).ok, 'upsertBinding เพิ่มได้');
    const b1 = await repo.getBinding('U1');
    ok(b1 && b1.driver_id === 'D003' && b1.name === 'สมชาย', 'getBinding คืนถูก', b1);
    await repo.upsertBinding({ lineUserId: 'U1', driverId: 'D007', name: 'สมชาย (ย้ายรหัส)', ts: 2000 });
    const b2 = await repo.getBinding('U1');
    ok(b2 && b2.driver_id === 'D007', 'upsert ซ้ำ = ทับของเดิม (sync ล่าสุดชนะ)', b2 && b2.driver_id);
    ok((await repo.getBinding('Uxx')) === null, 'ไม่เคยผูก = null');
    ok(!(await repo.upsertBinding({ lineUserId: '', driverId: 'D1' })).ok, 'ข้อมูลไม่ครบ = ปฏิเสธ');
  }
  {
    // ยืนยันเบอร์ → driver_id ต้องติดไปกับแถว staging (เดิม NULL ตลอด — ตัวกรอง ?driverId ใช้ไม่ได้จริง)
    const repo = makeMemoryStagingRepo();
    await repo.upsertBinding({ lineUserId: 'U9', driverId: 'D010', name: 'สมหมาย', ts: 1 });
    const deps = {
      lineClient: createMockLineClient(), engine: createMockEngine({ rawText: 'x' }),
      writeback: chooseWriteback({ WRITEBACK_PROVIDER: 'd1' }, repo),
      resolveDriver: async (uid) => { const b = await repo.getBinding(uid); return b ? b.driver_id : null; },
    };
    const r = await handleEvent({ type: 'postback', replyToken: 'rt', timestamp: 5,
      postback: { data: 'action=confirm&container=CSQU3054383' }, source: { userId: 'U9' } }, deps);
    ok(r.ok && r.written, 'ยืนยันผ่าน');
    const rows = await repo.listResults({ driverId: 'D010' });
    ok(rows.length === 1 && rows[0].container_no === 'CSQU3054383' && rows[0].driver_id === 'D010',
      '⭐ แถว staging มี driver_id จริง — เว็บกรองตามคนขับได้แล้ว', rows[0]);
    // คนขับที่ยังไม่ถูกผูก / resolveDriver พัง → การยืนยันต้องไม่ล้ม (driver_id = null เฉยๆ)
    const r2 = await handleEvent({ type: 'postback', replyToken: 'rt', timestamp: 6,
      postback: { data: 'action=confirm&container=TRLU4965122' }, source: { userId: 'Uใหม่' } },
      { ...deps, resolveDriver: async () => { throw new Error('db-down'); } });
    ok(r2.ok && r2.written, '⭐ resolveDriver พัง = ยืนยันยังผ่าน (ห้ามล้มเพราะหา id ไม่ได้)');
    const all = await repo.listResults({});
    ok(all.some((x) => x.container_no === 'TRLU4965122' && x.driver_id === null), 'แถวนั้น driver_id = null ไม่ใช่หาย');
  }
  {
    // endpoint POST /api/ocr/bind — ด่าน token + ตรวจ body
    console.log('\n== V73: POST /api/ocr/bind ==');
    const envReal = { LINE_CHANNEL_SECRET: 's', PULL_TOKEN: 'tok' };
    const mk = (body, auth) => new Request('http://localhost/api/ocr/bind', {
      method: 'POST', body: JSON.stringify(body || {}),
      headers: auth ? { authorization: auth } : {},
    });
    ok((await worker.fetch(mk({ lineUserId: 'U1', driverId: 'D1' }, 'Bearer wrong-token'), envReal, {})).status === 401, 'token ผิด = 401');
    ok((await worker.fetch(mk({ lineUserId: 'U1' }, 'Bearer tok'), envReal, {})).status === 400, 'body ไม่ครบ = 400');
    const okRes = await worker.fetch(mk({ lineUserId: 'U1', driverId: 'D001', name: 'สมชาย' }, 'Bearer tok'), envReal, {});
    ok(okRes.status === 200 && (await okRes.json()).ok, 'ผูกสำเร็จ = 200');
    const envNoTok = { LINE_CHANNEL_SECRET: 's' };   // ของจริงแต่ลืมตั้ง PULL_TOKEN
    ok((await worker.fetch(mk({ lineUserId: 'U1', driverId: 'D1' }), envNoTok, {})).status === 503, 'ของจริงลืมตั้ง token = 503 ไม่เปิดโล่ง');
  }

  console.log('\nผ่าน ' + pass + ' · ตก ' + fail);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('เทสพังกลางทาง:', e);
  console.log('\nผ่าน ' + pass + ' · ตก ' + (fail + 1));
  process.exit(1);
});
