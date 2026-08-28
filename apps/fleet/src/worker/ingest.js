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

// ตรวจปิงก่อนใช้ — ปิงที่ใช้ไม่ได้ต้องถูกปฏิเสธ ไม่ใช่เขียนค่าเสียลงฐาน
// ⚠️ ของจริงที่เจอ (28 ส.ค. 2569): lat/lng เป็น NaN ทำให้ shouldWriteTrack ตอบ "parked" (ไม่เขียน track)
//    แต่ upsertLive ยังเขียน NaN ลง gps_live → หมุดเพี้ยนบนแผนที่แบบเงียบๆ ไม่มีใครรู้
export function validatePing(ping) {
  if (!ping || typeof ping !== 'object') return { ok: false, reason: 'bad-ping' };
  const id = ping.vehicle_id;
  if (typeof id !== 'string' || !id.trim()) return { ok: false, reason: 'bad-vehicle-id' };
  const lat = Number(ping.lat), lng = Number(ping.lng), ts = Number(ping.ts);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, reason: 'bad-lat' };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, reason: 'bad-lng' };
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'bad-ts' };
  return { ok: true };
}

// ปรับ threshold ให้ปลอดภัยเสมอ
// ⚠️ ของจริงที่เจอ: ค่าติดลบทำให้ระยะทางมากกว่า threshold เสมอ → เขียน track ทุกปิง
//    = ทะลุเพดาน D1 100,000 แถว/วัน ทั้งที่ mitigation ทั้ง 3 ข้อมีไว้กันเรื่องนี้โดยตรง
//    ค่าที่ใช้ไม่ได้ (NaN/สตริง/undefined) → ใช้ค่าเริ่มต้น 20 เมตร · ติดลบ → 0
export function safeThreshold(v, fallback = 20) {
  // สตริงว่าง/ช่องว่างล้วน = "ไม่ได้ตั้งค่า" → ค่าเริ่มต้น (Number('') ให้ 0 ซึ่งแปลว่า "เขียนทุกครั้งที่ขยับแม้ 1 ซม.")
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string' && v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < 0 ? 0 : n;
}

// mitigation ข้อ 1: เขียน track เฉพาะตอนรถขยับ
// prev = จุดล่าสุดที่รู้ (จาก gps_live) หรือ null ถ้าไม่เคยเห็นคันนี้
export function shouldWriteTrack(prev, ping, thresholdM) {
  const th = safeThreshold(thresholdM);                                // กันค่าเพี้ยนแม้ถูกเรียกตรงๆ
  if (!prev) return { write: true, reason: 'first-point' };            // จุดแรกของคัน = เขียนไว้ก่อน
  if (Number(ping.speed_kmh) > 0) return { write: true, reason: 'speed' }; // มีความเร็ว = ขยับแน่ (สตริงเพี้ยน = ไม่นับ)
  // ⚠️ วัดจาก "จุด track ล่าสุดที่ถูกเขียนจริง" ไม่ใช่ปิงล่าสุด (บั๊กที่จดค้างไว้ — แก้ 28 ส.ค. 2569)
  //    เดิม: รถคืบครั้งละ 15 ม. ที่ speed=0 → ทุกปิงห่างจากปิงก่อน < 20 ม. = ไม่เขียนสักครั้ง
  //    ทั้งที่ขยับสะสมไปหลายร้อยเมตรแล้ว — เส้นทางหายทั้งช่วงแบบเงียบๆ
  const baseLat = Number.isFinite(prev.last_track_lat) ? prev.last_track_lat : prev.lat;
  const baseLng = Number.isFinite(prev.last_track_lng) ? prev.last_track_lng : prev.lng;
  const distM = haversineM(baseLat, baseLng, ping.lat, ping.lng);
  if (!Number.isFinite(distM)) return { write: false, reason: 'bad-distance', distM: null }; // พิกัดใช้ไม่ได้
  if (distM > th) return { write: true, reason: 'moved', distM };
  return { write: false, reason: 'parked', distM };                    // รถจอด — ไม่บันทึกซ้ำ
}

// ประมวลปิง 1 จุด — คืน { wroteTrack, budget, reason }
// opts: { thresholdM: เมตร (default 20 · มาจาก env MOVE_THRESHOLD_M), day: 'YYYY-MM-DD' (default = วันของ ping.ts) }
export async function processPing(repo, prev, ping, opts = {}) {
  // ปิงเสียต้องไม่ถูกเขียนลงฐานเลยสักที่ (ทั้ง track และ live) — คืนเหตุผลให้คนเรียกรายงานต่อ
  const v = validatePing(ping);
  if (!v.ok) return { ok: false, wroteTrack: false, reason: v.reason };

  const thresholdM = safeThreshold(opts.thresholdM);
  const day = opts.day || dayOfTs(ping.ts);
  if (!day) return { ok: false, wroteTrack: false, reason: 'bad-ts' };   // dayOfTs คืน null เมื่อ ts ใช้ไม่ได้

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
  // เขียน track รอบนี้ = จำจุดนี้เป็น "จุด track ล่าสุด" · ไม่เขียน = ส่ง null (COALESCE คงค่าเดิมไว้)
  await repo.upsertLive({
    vehicle_id: ping.vehicle_id,
    lat: ping.lat,
    lng: ping.lng,
    speed_kmh: ping.speed_kmh ?? 0,
    heading: ping.heading ?? 0,
    updated_at: ping.ts,
    last_track_lat: wroteTrack ? ping.lat : null,
    last_track_lng: wroteTrack ? ping.lng : null,
  });

  return { ok: true, wroteTrack, budget, reason: decision.reason };
}
