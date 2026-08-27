// Typhoon OCR (SCB 10X — โมเดลไทย) — stub ซื่อสัตย์ ยังไม่ implement
// endpoint ที่จะใช้: https://api.opentyphoon.ai/v1 (typhoon-ocr) หรือโหลด open weights มา self-host
// จุดแข็ง: ทีมไทย เอกสาร/ซัพพอร์ตภาษาไทย · open weights = self-host ได้ ไม่ผูกกับ vendor
// จุดอ่อน: เกิดมาเพื่อเอกสารเป็นหลัก — ต้องลองกับรูปตู้จริงก่อนว่าอ่านตัวพ่นสี/ตัวนูนได้ดีแค่ไหน
// ต้นทุนประมาณ: API หลักสิบ-ร้อยบาท/1,000 รูป · self-host = ค่าเครื่อง GPU รายเดือนแทน
//   — ⚠️ เป็นค่าประมาณ ต้องเช็คราคาปัจจุบันก่อนเคาะ
export async function readImage(_bytes) {
  return { ok: false, reason: 'not-implemented', todo: 'ต่อ Typhoon API หรือเคาะเรื่อง self-host ก่อน' };
}
