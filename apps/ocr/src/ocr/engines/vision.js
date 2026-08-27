// Google Cloud Vision OCR — stub ซื่อสัตย์ ยังไม่ implement
// endpoint ที่จะใช้: https://vision.googleapis.com/v1/images:annotate (feature: TEXT_DETECTION)
// จุดแข็ง: OCR ตัวหนังสือบนภาพจริงเสถียรมาก เอกสาร/ตัวพ่นสีบนตู้อ่านได้ดี บริการนิ่ง SLA ชัด
// จุดอ่อน: คืนข้อความทั้งภาพ (ต้อง extract เบอร์ตู้เอง) · ตั้ง billing account ยุ่งกว่าเจ้าอื่น
// ต้นทุนประมาณ ~55 บาท/1,000 รูป (1,000 แรก/เดือนฟรี) — ⚠️ เป็นค่าประมาณ ต้องเช็คราคาปัจจุบันก่อนเคาะ
export async function readImage(_bytes) {
  return { ok: false, reason: 'not-implemented', todo: 'ต่อ Cloud Vision API + ใส่ OCR_API_KEY เป็น secret' };
}
