// ทางเลือกสถาปัตยกรรม รอเจ้าของเคาะ — ดู ARCHITECTURE-OPTIONS.md
// ทางเลือก ③: พักผลยืนยันไว้ใน Cloudflare D1 ก่อน แล้วให้ระบบเดิมมาดึงไปเติมใบงานเอง
// ข้อดี: ฝั่งบอทไม่แตะชีทเลย ปลอดภัยสุด · ข้อเสีย: มีขั้นตอนกลาง ข้อมูลไม่เข้าใบงานทันที
// stub ซื่อสัตย์ — ยังไม่ implement ห้ามแกล้งตอบสำเร็จ
export async function fillContainer(_args) {
  return { ok: false, reason: 'not-implemented', todo: 'รอเคาะ: สร้างตาราง D1 + endpoint ให้ระบบเดิม poll' };
}
