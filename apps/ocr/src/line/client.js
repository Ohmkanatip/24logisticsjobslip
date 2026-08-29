// LINE Messaging API client
// หมายเหตุบริบทโปรเจกต์แม่: V63.8 เลิกใช้ LINE "แจ้งเตือน" ไปแล้ว (กติกาข้อ 6 ห้ามต่อกลับ)
// แต่ตัวนี้คือ "บอทรับรูปจากคนขับ" — คนละหน้าที่กับการแจ้งเตือน จึงไม่ขัดกติกานั้น

// ── เพดานของ LINE Messaging API (ถ้าเกิน LINE ปฏิเสธทั้งข้อความ = คนขับไม่ได้รับอะไรเลย) ──
// ⚠️ ของจริงที่พิสูจน์แล้ว 28 ส.ค. 2569: เบอร์ตู้ยาวผิดปกติจาก postback ที่ถูกดัดแปลง
//    ทำให้ข้อความตอบยาว 5,063 ตัวอักษร → เกิน 5,000 → LINE ไม่ส่ง → คนขับเงียบสนิท ไม่รู้ว่าเกิดอะไร
//    ตัดที่ต้นทางตรงนี้จุดเดียว ครอบทุก call site (ไม่ต้องไล่แก้ทีละที่ = ไม่มีวันลืม)
export const LINE_TEXT_MAX = 5000;
export const LINE_QUICKREPLY_MAX = 13;

export function capMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!m || typeof m !== 'object') return m;
    const out = { ...m };
    if (typeof out.text === 'string' && out.text.length > LINE_TEXT_MAX) {
      out.text = out.text.slice(0, LINE_TEXT_MAX - 1) + '…';   // ตัดแล้วติด … ให้รู้ว่าถูกตัด
    }
    if (out.quickReply && Array.isArray(out.quickReply.items) && out.quickReply.items.length > LINE_QUICKREPLY_MAX) {
      out.quickReply = { ...out.quickReply, items: out.quickReply.items.slice(0, LINE_QUICKREPLY_MAX) };
    }
    return out;
  });
}

// 🎭 client ปลอมสำหรับเทส/dev — บันทึกทุก call ลง array ให้เทสตรวจได้
export function createMockLineClient(opts = {}) {
  const calls = [];
  return {
    mock: true,
    calls,
    async replyMessage(replyToken, messages) {
      calls.push({ fn: 'replyMessage', replyToken, messages: capMessages(messages) });
      return { ok: true, mock: true };
    },
    async pushMessage(to, messages) {
      calls.push({ fn: 'pushMessage', to, messages: capMessages(messages) });
      return { ok: true, mock: true };
    },
    async getMessageContent(messageId) {
      calls.push({ fn: 'getMessageContent', messageId });
      // คืน bytes ปลอม (mock engine ไม่สนใจเนื้อรูปอยู่แล้ว)
      return opts.messageContent || new Uint8Array([0xff, 0xd8, 0xff]);
    }
  };
}

// client จริง — stub ซื่อสัตย์: ยังไม่ implement ห้ามแกล้งตอบสำเร็จ
// TODO endpoint จริง (ใช้ LINE_CHANNEL_ACCESS_TOKEN เป็น Bearer):
//   reply : POST https://api.line.me/v2/bot/message/reply
//   push  : POST https://api.line.me/v2/bot/message/push
//   รูป   : GET  https://api-data.line.me/v2/bot/message/{messageId}/content
export function createLineClient(_env) {
  const notImpl = (todo) => ({ ok: false, reason: 'not-implemented', todo });
  return {
    mock: false,
    async replyMessage() { return notImpl('POST https://api.line.me/v2/bot/message/reply'); },
    async pushMessage() { return notImpl('POST https://api.line.me/v2/bot/message/push'); },
    async getMessageContent() { return notImpl('GET https://api-data.line.me/v2/bot/message/{id}/content'); }
  };
}
