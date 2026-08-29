// Qwen-VL (Alibaba) — stub ซื่อสัตย์ ยังไม่ implement
// endpoint ที่จะใช้: https://dashscope-intl.aliyuncs.com/api/v1 (model qwen-vl-plus/qwen-vl-max)
//   หรือผ่าน OpenRouter: https://openrouter.ai/api/v1/chat/completions
// จุดแข็ง: โมเดล vision อ่านตัวอักษร/ตัวเลขบนวัตถุจริงเก่งมาก ราคาถูก สั่ง prompt ให้ตอบเฉพาะเบอร์ตู้ได้
// จุดอ่อน: ต้องคุม prompt ดีๆ กัน hallucinate (แต่งเลขเอง) — ต้องพึ่งเช็คดิจิตกรองอีกชั้นเสมอ
// ต้นทุนประมาณ ~7-40 บาท/1,000 รูป — ⚠️ เป็นค่าประมาณ ต้องเช็คราคาปัจจุบันก่อนเคาะ
export async function readImage(_bytes) {
  return { ok: false, reason: 'not-implemented', todo: 'ต่อ DashScope/OpenRouter API + ใส่ OCR_API_KEY เป็น secret' };
}
