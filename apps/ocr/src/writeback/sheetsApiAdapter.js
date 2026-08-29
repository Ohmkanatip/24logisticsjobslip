// ทางเลือกสถาปัตยกรรม รอเจ้าของเคาะ — ดู ARCHITECTURE-OPTIONS.md
// ทางเลือก ②: เขียนตรงเข้า Google Sheets API ด้วย service account
// ข้อดี: เร็ว ไม่ผ่าน Apps Script · ข้อเสีย: ข้ามระบบประวัติ/กันซ้ำของหลังบ้านเดิม — อันตรายถ้าไม่ระวัง
// stub ซื่อสัตย์ — ยังไม่ implement ห้ามแกล้งตอบสำเร็จ
export async function fillContainer(_args) {
  return { ok: false, reason: 'not-implemented', todo: 'รอเคาะ: service account + sheets.googleapis.com (ต้องคิดเรื่องประวัติแก้ไขด้วย)' };
}
