// หัวใจของบอท: รับ event จาก LINE → อ่านรูป → ตรวจเช็คดิจิต → ให้คนขับกดยืนยัน → ค่อยเขียนกลับ
// ⚠️ กติกาเหล็ก 2 ข้อ (ห้ามฝ่าฝืน):
//   1) เช็คดิจิตไม่ผ่าน = flag ให้ถ่ายใหม่/เลือกข้อเสนอซ่อม — ห้ามส่งเข้า writeback ตรงๆ
//   2) คนขับต้องกดยืนยันเสมอ — ระบบไม่เขียนทับใบงานเงียบๆ
// ทุก dependency ฉีดผ่าน deps = { lineClient, engine, writeback } เพื่อให้เทสง่าย
import { validate } from '../iso6346/check.js';
import { suggestRepairs } from '../iso6346/repair.js';
import { extractCandidates } from '../ocr/extract.js';

// สร้าง quick reply ของ LINE: ปุ่มยืนยันต่อเบอร์ + ปุ่มถ่ายใหม่
function buildQuickReply(confirmables, jobUid) {
  const items = confirmables.slice(0, 10).map((no) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: ('✓ ' + no).slice(0, 20), // LINE จำกัด label 20 ตัวอักษร
      data: 'action=confirm&container=' + no + (jobUid ? '&jobUid=' + jobUid : '')
    }
  }));
  items.push({
    type: 'action',
    action: { type: 'postback', label: '↻ ถ่ายใหม่', data: 'action=retake' }
  });
  return { items };
}

// จัดการ event เดี่ยวจาก LINE webhook — คืน object ผลลัพธ์ให้เทส/worker ตรวจได้
export async function handleEvent(event, deps) {
  const { lineClient, engine, writeback } = deps;

  // ── กรณีคนขับส่งรูปตู้มา ──────────────────────────────────────────────
  if (event && event.type === 'message' && event.message && event.message.type === 'image') {
    const content = await lineClient.getMessageContent(event.message.id);
    if (content && content.ok === false) {
      // ดึงรูปไม่ได้ — ต้องตอบคนขับเสมอ ห้ามเงียบ (ตัวตรวจอิสระเจอ: ทุก path อื่นมี reply แต่ path นี้เงียบสนิท)
      await lineClient.replyMessage(event.replyToken, [{
        type: 'text',
        text: '⚠️ ดึงรูปไม่สำเร็จ (สัญญาณอาจอ่อน) — รบกวนส่งรูปใหม่อีกครั้งครับ',
      }]);
      return { ok: false, reason: content.reason || 'get-content-failed', replied: true };
    }
    const ocr = await engine.readImage(content);
    if (!ocr || !ocr.ok) {
      await lineClient.replyMessage(event.replyToken, [{
        type: 'text',
        text: '⚠️ อ่านรูปไม่ได้ (' + ((ocr && ocr.reason) || 'ocr-failed') + ') ลองถ่ายใหม่อีกครั้ง'
      }]);
      return { ok: false, reason: (ocr && ocr.reason) || 'ocr-failed' };
    }

    const candidates = extractCandidates(ocr.rawText);
    if (candidates.length === 0) {
      await lineClient.replyMessage(event.replyToken, [{
        type: 'text',
        text: '🔍 หาเบอร์ตู้ในรูปไม่เจอ — ถ่ายใหม่ให้เห็นเบอร์ตู้ชัดๆ ตรงๆ อีกครั้ง',
        quickReply: buildQuickReply([], null)
      }]);
      return { ok: true, candidates: [] };
    }

    // ตรวจเช็คดิจิตทีละตัว + หาข้อเสนอซ่อมให้ตัวที่ไม่ผ่าน
    const results = candidates.map((no) => {
      const v = validate(no);
      const repairs = v.ok ? [] : suggestRepairs(no);
      return { input: no, ...v, repairs };
    });

    const lines = [];
    const confirmables = [];
    for (const r of results) {
      if (r.ok) {
        lines.push('✅ ' + r.normalized + ' — เช็คดิจิตผ่าน');
        if (r.warnings.length) lines.push('   ⚠️ ' + r.warnings.join(' · '));
        confirmables.push(r.normalized);
      } else {
        lines.push('⚠️ ' + r.normalized + ' — เช็คดิจิตไม่ผ่าน');
        if (r.repairs.length) {
          lines.push('   อาจเป็น: ' + r.repairs.join(' / ') + ' (กดปุ่มเลือกได้)');
          for (const fix of r.repairs) confirmables.push(fix); // ให้คนขับกดเลือกเอง — ไม่ auto-ใช้
        } else {
          lines.push('   ไม่มีข้อเสนอซ่อม — ถ่ายใหม่อีกครั้ง');
        }
      }
    }
    lines.push('');
    lines.push(confirmables.length
      ? 'กด ✓ ยืนยันเบอร์ที่ถูกต้อง หรือ ↻ ถ่ายใหม่'
      : 'ถ่ายใหม่ให้ชัดขึ้นอีกครั้ง');

    await lineClient.replyMessage(event.replyToken, [{
      type: 'text',
      text: lines.join('\n'),
      quickReply: buildQuickReply(confirmables, null)
    }]);
    return { ok: true, candidates: results };
  }

  // ── กรณีคนขับกดปุ่ม (postback) ────────────────────────────────────────
  if (event && event.type === 'postback' && event.postback) {
    const data = new URLSearchParams(event.postback.data || '');
    const action = data.get('action');

    if (action === 'retake') {
      await lineClient.replyMessage(event.replyToken, [{
        type: 'text', text: '📷 ได้เลย — ถ่ายรูปเบอร์ตู้ส่งมาใหม่อีกครั้ง'
      }]);
      return { ok: true, action: 'retake' };
    }

    if (action === 'confirm') {
      const containerNo = data.get('container') || '';
      const jobUid = data.get('jobUid') || null;
      // ตรวจซ้ำก่อนเขียนเสมอ — ห้ามเชื่อค่าที่ติดมากับปุ่ม (กติกาเหล็กข้อ 1)
      const v = validate(containerNo);
      if (!v.ok) {
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: '⛔ เบอร์ ' + v.normalized + ' เช็คดิจิตไม่ผ่าน — ไม่บันทึกเข้าใบงาน ถ่ายใหม่อีกครั้ง'
        }]);
        return { ok: false, reason: 'check-digit-failed', written: false };
      }
      const w = await writeback.fillContainer({
        jobUid,
        containerNo: v.normalized,
        confirmedBy: (event.source && event.source.userId) || null,
        ts: event.timestamp || null   // เวลาจาก LINE event — ชั้นนี้ไม่แตะ Date.now (กติกาบ้าน)
      });
      if (!w || !w.ok) {
        await lineClient.replyMessage(event.replyToken, [{
          type: 'text',
          text: '⚠️ ยืนยันแล้วแต่บันทึกเข้าใบงานยังไม่ได้ (' + ((w && w.reason) || 'writeback-failed') + ') — แจ้งออฟฟิศ'
        }]);
        return { ok: false, reason: (w && w.reason) || 'writeback-failed', written: false };
      }
      await lineClient.replyMessage(event.replyToken, [{
        type: 'text',
        text: '✅ บันทึกเบอร์ ' + v.normalized + ' เข้าใบงานเรียบร้อย ขอบคุณครับ'
      }]);
      return { ok: true, written: true, containerNo: v.normalized, jobUid };
    }

    return { ok: false, reason: 'unknown-postback-action' };
  }

  // event ชนิดอื่น (ข้อความตัวหนังสือ ฯลฯ) — ยังไม่รองรับในเฟสนี้
  return { ok: false, reason: 'unsupported-event' };
}
