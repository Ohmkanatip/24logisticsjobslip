// 🎭 MOCK ENGINE — ของปลอมสำหรับเทส/dev เท่านั้น ไม่ได้อ่านรูปจริง
// ตั้งข้อความที่จะให้ "อ่านได้" ล่วงหน้าผ่าน setMockText หรือส่งตอนสร้าง
export function createMockEngine(opts = {}) {
  // ค่าเริ่มต้นมีเบอร์ตู้ที่เช็คดิจิตถูก (CSQU3054383 — เวกเตอร์ทดสอบมาตรฐาน)
  let text = typeof opts.rawText === 'string' ? opts.rawText : 'CONTAINER CSQU 305438 3';
  return {
    mock: true, // 🎭 ป้ายบอกชัดว่าเป็น mock
    setMockText(t) { text = t; },
    async readImage(_bytes) {
      return { ok: true, rawText: text, mock: true };
    }
  };
}
