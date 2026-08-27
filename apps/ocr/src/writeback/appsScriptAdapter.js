// ทางเลือกสถาปัตยกรรม รอเจ้าของเคาะ — ดู ARCHITECTURE-OPTIONS.md
// ทางเลือก ①: ยิงเข้า Apps Script Web App เดิม (เพิ่ม act ใหม่ เช่น act=fillcontainer)
// ข้อดี: ใช้ระบบสิทธิ์/ประวัติแก้ไข/กันซ้ำ ที่มีอยู่แล้วในหลังบ้านเดิม · ข้อเสีย: ช้า 1-3 วิ ต่อ call
// stub ซื่อสัตย์ — ยังไม่ implement ห้ามแกล้งตอบสำเร็จ
export async function fillContainer(_args) {
  return { ok: false, reason: 'not-implemented', todo: 'รอเคาะ: เพิ่ม act ใหม่ใน .gs แล้วยิง POST เข้า endpoint เดิม' };
}
