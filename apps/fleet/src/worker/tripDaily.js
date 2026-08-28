// สรุประยะทางรายวันต่อคันจากแถว gps_track — เก็บถาวรใน trip_daily (แถวเล็ก ไม่ลบ)
// pure function ทั้งไฟล์: รับข้อมูลเข้า คืนผลลัพธ์ ไม่แตะฐาน/เวลาเอง (เทสตรงได้)
import { haversineM } from './haversine.js';

// trackRows (คันเดียว เรียงตามเวลา) → ระยะทางรวมเป็นกิโลเมตร
// ข้ามช่วงที่พิกัดเสีย · ช่วงที่กระโดดไกลผิดปกติ (> maxJumpKm) ไม่นับ — กันสัญญาณเพี้ยนลากระยะทางพุ่ง
export function distanceKmOf(trackRows, maxJumpKm = 30) {
  let km = 0;
  for (let i = 1; i < trackRows.length; i++) {
    const a = trackRows[i - 1], b = trackRows[i];
    if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) continue;
    const d = haversineM(a.lat, a.lng, b.lat, b.lng) / 1000;
    if (!Number.isFinite(d) || d > maxJumpKm) continue;   // ปิงห่างกัน 1 นาที วิ่งเกิน 30 กม. = สัญญาณเพี้ยน ไม่นับ
    km += d;
  }
  return Math.round(km * 10) / 10;
}

// แถว track ของ "วันเดียว" (หลายคันปนกัน) → [{vehicle_id, day, distance_km, trips}]
// trips นับจากช่วงที่ขาดหาย > gapMin นาที (จอดนาน = จบทริป) — ตัวเลขหยาบไว้ดูภาพรวม
export function computeTripDaily(trackRows, day, gapMin = 45) {
  const byV = new Map();
  for (const r of trackRows) {
    if (!r || !r.vehicle_id || !Number.isFinite(r.ts)) continue;
    if (!byV.has(r.vehicle_id)) byV.set(r.vehicle_id, []);
    byV.get(r.vehicle_id).push(r);
  }
  const out = [];
  for (const [v, rows] of byV) {
    rows.sort((a, b) => a.ts - b.ts);
    let trips = rows.length ? 1 : 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].ts - rows[i - 1].ts > gapMin * 60 * 1000) trips++;
    }
    out.push({ vehicle_id: v, day, distance_km: distanceKmOf(rows), trips });
  }
  return out.sort((a, b) => a.vehicle_id < b.vehicle_id ? -1 : 1);
}
