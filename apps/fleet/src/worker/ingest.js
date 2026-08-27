// รับปิง GPS 1 จุด → ตัดสินใจว่าเขียน gps_track ไหม + UPSERT gps_live เสมอ
// ทั้งไฟล์เป็น pure logic: ไม่แตะ Date.now()/new Date() — เวลาทุกอย่างมากับ ping.ts / opts
// (ชั้นนอกอย่าง worker/demo-server เป็นคนส่งเวลาจริงเข้ามา)

import { haversineM } from './haversine.js';
import { dayOfTs } from '../db/repo.js';

// เพดานเขียนของ D1 free = 100,000 แถว/วัน (mitigation ข้อ 3)
export const WRITE_WARN = 90000;   // แตะ 90,000 = เตือน
export const WRITE_OVER = 100000;  // แตะ 100,000 = เต็มเพดาน หยุดเขียน track

// คืนระดับงบเขียนวันนี้: ok / warn / over
export function checkWriteBudget(count) {
  const n = Number(count) || 0;
  if (n >= WRITE_OVER) return { level: 'over', used: n, limit: WRITE_OVER };
  if (n >= WRITE_WARN) return { level: 'warn', used: n, limit: WRITE_OVER };
  return { level: 'ok', used: n, limit: WRITE_OVER };
}

// mitigation ข้อ 1: เขียน track เฉพาะตอนรถขยับ
// prev = จุดล่าสุดที่รู้ (จาก gps_live) หรือ null ถ้าไม่เคยเห็นคันนี้
export function shouldWriteTrack(prev, ping, thresholdM) {
  if (!prev) return { write: true, reason: 'first-point' };            // จุดแรกของคัน = เขียนไว้ก่อน
  if ((ping.speed_kmh || 0) > 0) return { write: true, reason: 'speed' }; // มีความเร็ว = ขยับแน่
  const distM = haversineM(prev.lat, prev.lng, ping.lat, ping.lng);
  if (distM > thresholdM) return { write: true, reason: 'moved', distM };
  return { write: false, reason: 'parked', distM };                    // รถจอด — ไม่บันทึกซ้ำ
}

// ประมวลปิง 1 จุด — คืน { wroteTrack, budget, reason }
// opts: { thresholdM: เมตร (default 20 · มาจาก env MOVE_THRESHOLD_M), day: 'YYYY-MM-DD' (default = วันของ ping.ts) }
export async function processPing(repo, prev, ping, opts = {}) {
  const thresholdM = Number.isFinite(Number(opts.thresholdM)) && opts.thresholdM !== undefined
    ? Number(opts.thresholdM)
    : 20;
  const day = opts.day || dayOfTs(ping.ts);

  const writesToday = await repo.countTrackWritesOn(day);
  let budget = checkWriteBudget(writesToday);

  const decision = shouldWriteTrack(prev, ping, thresholdM);
  let wroteTrack = false;
  // งบเต็ม (over) = หยุดเขียน track กันชนเพดาน D1 — แต่ live ยังอัปเดตต่อ (ไม่งอกแถว)
  if (decision.write && budget.level !== 'over') {
    await repo.insertTrack({ vehicle_id: ping.vehicle_id, lat: ping.lat, lng: ping.lng, ts: ping.ts });
    wroteTrack = true;
    budget = checkWriteBudget(writesToday + 1);
  }

  // mitigation ข้อ 2: gps_live เป็น UPSERT เสมอ — 1 แถว/คัน
  await repo.upsertLive({
    vehicle_id: ping.vehicle_id,
    lat: ping.lat,
    lng: ping.lng,
    speed_kmh: ping.speed_kmh ?? 0,
    heading: ping.heading ?? 0,
    updated_at: ping.ts,
  });

  return { wroteTrack, budget, reason: decision.reason };
}
