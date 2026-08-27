// 🧪 mock GPS feed (ติดป้าย mock ชัดเจน — ไม่ใช่ข้อมูลจริง ชื่อคนขับ/ลูกค้า/เบอร์ตู้สมมติล้วน)
// deterministic 100%: makeInitialState() + tick(state, dtSec) เป็น pure function
// ไม่แตะเวลาเครื่อง ไม่มี random — input เดิมได้ผลเดิมเสมอ (เทสได้ตรงๆ)

import { haversineM } from '../worker/haversine.js';

// เส้นทางจริงคร่าวๆ: แหลมฉบัง → บางนา → ลาดกระบัง ICD (polyline 3 จุด)
export const ROUTE = [
  { name: 'แหลมฉบัง', lat: 13.0827, lng: 100.8918 },
  { name: 'บางนา', lat: 13.668, lng: 100.604 },
  { name: 'ลาดกระบัง ICD', lat: 13.736, lng: 100.744 },
];

// ระยะสะสมของแต่ละช่วง (คำนวณครั้งเดียวตอนโหลดโมดูล)
const SEGS = (() => {
  const segs = [];
  let acc = 0;
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const lenM = haversineM(ROUTE[i].lat, ROUTE[i].lng, ROUTE[i + 1].lat, ROUTE[i + 1].lng);
    segs.push({ from: ROUTE[i], to: ROUTE[i + 1], startM: acc, lenM });
    acc += lenM;
  }
  return segs;
})();
export const ROUTE_TOTAL_M = SEGS.reduce((s, x) => s + x.lenM, 0);

// ทิศหัวรถ (องศา 0-360) จากจุด a ไป b
function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ตำแหน่งบน polyline ที่ระยะสะสม distM (เมตร) — interpolate เชิงเส้นในช่วง
export function positionAt(distM) {
  const d = Math.max(0, Math.min(distM, ROUTE_TOTAL_M));
  let seg = SEGS[SEGS.length - 1];
  for (const s of SEGS) {
    if (d <= s.startM + s.lenM) { seg = s; break; }
  }
  const f = seg.lenM > 0 ? (d - seg.startM) / seg.lenM : 0;
  return {
    lat: seg.from.lat + (seg.to.lat - seg.from.lat) * f,
    lng: seg.from.lng + (seg.to.lng - seg.from.lng) * f,
    heading: bearingDeg(seg.from, seg.to),
  };
}

// สถานะตั้งต้น: รถ 4 คัน (ทะเบียนสไตล์ไทย · ชื่อทุกอย่างสมมติ "ทดสอบ-")
export function makeInitialState() {
  return {
    mock: true, // ⭐ ป้ายบอกทุกชั้นว่านี่คือข้อมูล mock
    tSec: 0,
    vehicles: [
      {
        id: '71-3760', driver_name: 'ทดสอบ-สมชาย', status: 'กำลังวิ่ง', speed_kmh: 60, dist_m: 0,
        job: { job_id: 'MOCK-001', customer: 'ทดสอบ-A', container_no: 'MOCKU1234560', origin: 'แหลมฉบัง', destination: 'ลาดกระบัง ICD' },
      },
      {
        id: '82-1234', driver_name: 'ทดสอบ-วิรัตน์', status: 'กำลังวิ่ง', speed_kmh: 62, dist_m: 25000,
        job: { job_id: 'MOCK-002', customer: 'ทดสอบ-B', container_no: 'MOCKU1234571', origin: 'แหลมฉบัง', destination: 'ลาดกระบัง ICD' },
      },
      {
        id: '70-5566', driver_name: 'ทดสอบ-ประยูร', status: 'กำลังวิ่ง', speed_kmh: 58, dist_m: 55000,
        job: { job_id: 'MOCK-003', customer: 'ทดสอบ-C', container_no: 'MOCKU1234582', origin: 'แหลมฉบัง', destination: 'ลาดกระบัง ICD' },
      },
      {
        // คันนี้จอดว่างที่แหลมฉบัง — ไว้พิสูจน์ว่า movement filter ไม่เขียน track ให้รถจอด
        id: '83-9012', driver_name: 'ทดสอบ-อนันต์', status: 'ว่าง', speed_kmh: 0, dist_m: 0,
        job: null,
      },
    ],
  };
}

// เดินเวลาไป dtSec วินาที — pure function: ไม่แก้ state เดิม คืน state ใหม่
// เวลาที่ผ่านไปต้องใช้ได้เสมอ — ค่าเพี้ยนแม้ครั้งเดียวทำให้ระยะทางกลายเป็น NaN
// แล้ว NaN ติดอยู่ใน state ตลอดกาล (พิกัดรถทุกคันพังถาวรจนกว่าจะรีสตาร์ท) — พิสูจน์แล้ว 28 ส.ค. 2569
// ติดลบ = ถอยหลัง (ไม่มีในโลกจริง) · เกิน 1 ชม. = กระโดดไกลเกินจริง (เช่นเครื่อง sleep แล้วตื่น)
export function safeDt(dtSec, maxSec = 3600) {
  const n = Number(dtSec);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > maxSec ? maxSec : n;
}

export function tick(state, dtSec) {
  const dt = safeDt(dtSec);
  const vehicles = state.vehicles.map((v) => {
    const copy = { ...v, job: v.job ? { ...v.job } : null };
    if (copy.status !== 'กำลังวิ่ง') return copy; // ว่าง/ถึงแล้ว = อยู่กับที่
    let dist = copy.dist_m + (copy.speed_kmh / 3.6) * dt;
    if (dist >= ROUTE_TOTAL_M) {
      dist = ROUTE_TOTAL_M;
      copy.status = 'ถึงแล้ว';
      copy.speed_kmh = 0;
    }
    copy.dist_m = dist;
    return copy;
  });
  return { ...state, tSec: state.tSec + dtSec, vehicles };
}

// แปลง state → ปิง GPS รายคัน (tsMs = เวลาที่ชั้นนอกส่งเข้ามา — ไม่ใช้เวลาเครื่องในนี้)
export function toPings(state, tsMs) {
  return state.vehicles.map((v) => {
    const p = positionAt(v.dist_m);
    return {
      vehicle_id: v.id,
      lat: p.lat,
      lng: p.lng,
      speed_kmh: v.speed_kmh,
      heading: v.status === 'กำลังวิ่ง' ? p.heading : 0,
      ts: tsMs,
    };
  });
}
