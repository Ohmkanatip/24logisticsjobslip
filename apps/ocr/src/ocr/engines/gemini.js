// Gemini (Google AI Studio) — stub ซื่อสัตย์ ยังไม่ implement
//
// ⭐ ตัวเลือกที่ "ฟรีจริง" ที่สุดสำหรับปริมาณของเรา (ตรวจราคา 28 ส.ค. 2569)
//   - Gemini 2.5 Flash-Lite ชั้นฟรี: 1,000 คำขอ/วัน · 15 คำขอ/นาที · ไม่ต้องใส่บัตรเครดิต · ไม่มีวันหมดอายุ
//   - ปริมาณจริงของเรา ~60-100 ตู้/วัน → ใช้ไม่ถึง 10% ของโควตาฟรี
//   - อ่านรูปได้ในตัว (multimodal) สั่ง prompt ให้ตอบเฉพาะเบอร์ตู้ได้
//
// ⚠️ ข้อควรรู้ก่อนเคาะ (เรื่องนี้ต้องให้เจ้าของตัดสินใจ ไม่ใช่เรา):
//   ชั้นฟรีของ Google AI Studio — Google อาจเอา input/output ไปปรับปรุงโมเดล
//   รูปตู้คอนเทนเนอร์ไม่มีข้อมูลส่วนบุคคล/ความลับธุรกิจ ความเสี่ยงจึงต่ำ
//   แต่ถ้าไม่สบายใจ: ใช้ Vertex AI (เสียเงิน ไม่เอาข้อมูลไปเทรน) หรือ Google Cloud Vision แทน
//
// endpoint ที่จะใช้:
//   POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent
//   body: { contents:[{ parts:[ {text: prompt}, {inline_data:{mime_type:'image/jpeg', data: base64}} ]}] }
//   key: ส่งเป็น header x-goog-api-key (เก็บใน OCR_API_KEY เป็น secret ห้ามอยู่ในไฟล์)
//
// prompt ที่ควรใช้ (กัน hallucinate):
//   "อ่านเฉพาะหมายเลขตู้คอนเทนเนอร์ (ISO 6346: ตัวอักษร 4 ตัว + เลข 7 หลัก) ที่เห็นในรูป
//    ตอบเฉพาะหมายเลข ไม่ต้องอธิบาย ถ้าอ่านไม่ออกให้ตอบว่า UNREADABLE"
//   → แล้วส่งผลผ่าน extractCandidates + validate (เช็คดิจิต) เหมือน engine อื่นทุกตัว
//   เช็คดิจิตคือตาข่ายกัน hallucinate: โมเดลแต่งเลขเอง โอกาสที่เช็คดิจิตจะบังเอิญถูกมีแค่ ~1 ใน 11
export async function readImage(_bytes) {
  return {
    ok: false,
    reason: 'not-implemented',
    todo: 'ต่อ generativelanguage API + ใส่ OCR_API_KEY เป็น secret (wrangler secret put OCR_API_KEY)'
  };
}
