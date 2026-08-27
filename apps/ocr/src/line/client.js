// LINE Messaging API client
// หมายเหตุบริบทโปรเจกต์แม่: V63.8 เลิกใช้ LINE "แจ้งเตือน" ไปแล้ว (กติกาข้อ 6 ห้ามต่อกลับ)
// แต่ตัวนี้คือ "บอทรับรูปจากคนขับ" — คนละหน้าที่กับการแจ้งเตือน จึงไม่ขัดกติกานั้น

// 🎭 client ปลอมสำหรับเทส/dev — บันทึกทุก call ลง array ให้เทสตรวจได้
export function createMockLineClient(opts = {}) {
  const calls = [];
  return {
    mock: true,
    calls,
    async replyMessage(replyToken, messages) {
      calls.push({ fn: 'replyMessage', replyToken, messages });
      return { ok: true, mock: true };
    },
    async pushMessage(to, messages) {
      calls.push({ fn: 'pushMessage', to, messages });
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
