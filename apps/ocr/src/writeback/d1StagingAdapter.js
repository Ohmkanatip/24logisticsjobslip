// ✅ ทางเลือก ③ — เจ้าของเคาะแล้ว (28 ส.ค. 2569): "ไม่อยากให้ base มาเกี่ยว แค่เชื่อมเอาข้อมูลมาต่อเฉยๆ"
// บอทเขียนผลยืนยันลงตารางพัก (ocr_results) เท่านั้น — ไม่แตะชีท ไม่เรียก Apps Script
// เว็บ jobslip เป็นฝ่ายดึงผ่าน GET /api/ocr/results แล้วข้อมูลเข้าชีทตามเส้นทางบันทึกเดิมของเว็บ
// → ระบบหลักยังเป็นเจ้าของข้อมูล 100% · บอทพังก็ไม่กระทบชีทแม้แต่แถวเดียว
import { makeMemoryStagingRepo } from '../db/staging.js';

// สร้าง writeback ที่ผูกกับ staging repo (memory ตอน mock/เทส · D1 ตอนจริง)
export function createStagingWriteback(repo) {
  return {
    provider: 'd1',
    repo,   // เปิดให้ worker ใช้ตัวเดียวกันตอบ GET /api/ocr/results
    async fillContainer({ jobUid, containerNo, confirmedBy, driverId, ts }) {
      if (!containerNo) return { ok: false, reason: 'no-container' };
      const r = await repo.insertResult({ containerNo, confirmedBy, jobUid, driverId, ts });
      // ตอบ staged:true ให้ชั้นบนรู้ว่า "พักไว้แล้ว รอเว็บดึง" — ไม่ใช่ "เข้าใบงานแล้ว" (ห้ามหลอก)
      return { ok: true, staged: true, id: r.id };
    },
  };
}

// ของเดิมที่ประกาศเป็น stub — คงชื่อไว้กันโค้ดเก่าพัง แต่ชี้ให้ไปใช้ตัวจริง
export async function fillContainer(_args) {
  return { ok: false, reason: 'use-createStagingWriteback', todo: 'เรียกผ่าน chooseWriteback(env) — ต้องมี repo ผูกเสมอ' };
}
