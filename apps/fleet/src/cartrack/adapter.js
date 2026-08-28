// ตัวดึงตำแหน่งรถจาก Cartrack — โครงพร้อมเสียบ key (28 ส.ค. 2569)
//
// ⚠️ สถานะ: รอเจ้าของโทร Cartrack ขอ ① API credentials (Basic Auth) ② list device↔ทะเบียน
//    ③ ถามว่ากี่คันอ่านเซนเซอร์น้ำมันได้ — endpoint/รูป payload จริงต่างตามสัญญา/รีเจียน
//    จึงแยกเป็น 2 ชั้น: fetch (stub ซื่อสัตย์ รอ key) + normalize (pure function เทสได้เลย)
//
// เอกสารที่รู้ตอนนี้ (จาก ROADMAP 23 ส.ค.): Cartrack มี "Mileage and Odometer Services"
// คืนระยะทางรวมต่อคันตามช่วงเวลา + ระยะทางต่อทริป · Fleet API ใช้ Basic Auth (user/password)

// แปลง payload จาก Cartrack ให้เป็นรูป ping กลางของระบบเรา — pure function มีเทสจริง
// รองรับหลายรูปแบบ field ที่ Cartrack ใช้ (latitude/lat · longitude/lon/lng · speed/speed_kmh)
// แถวที่แปลงไม่ได้ = ข้ามพร้อมนับไว้ ไม่พาทั้งชุดล้ม (ปิงเสีย 1 จุดต้องไม่ทำให้ 59 คันที่เหลือหาย)
export function normalizeCartrackPayload(payload, deviceMap = {}) {
  const rows = Array.isArray(payload) ? payload
    : payload && Array.isArray(payload.data) ? payload.data
    : payload && Array.isArray(payload.positions) ? payload.positions
    : [];
  const pings = [];
  let skipped = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') { skipped++; continue; }
    const device = r.device_id ?? r.deviceId ?? r.unit_id ?? r.registration ?? r.plate;
    const vehicle = deviceMap[device] || (typeof device === 'string' ? device : null);
    const lat = Number(r.latitude ?? r.lat);
    const lng = Number(r.longitude ?? r.lon ?? r.lng);
    const ts = Number(r.timestamp ?? r.ts ?? (r.event_ts ? Date.parse(r.event_ts) : NaN));
    const speed = Number(r.speed_kmh ?? r.speed ?? 0);
    if (!vehicle || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(ts) || ts <= 0) { skipped++; continue; }
    pings.push({ vehicle_id: String(vehicle), lat, lng, ts, speed_kmh: Number.isFinite(speed) ? speed : 0, heading: Number(r.heading ?? r.bearing ?? 0) || 0 });
  }
  return { pings, skipped };
}

// ดึงตำแหน่งล่าสุดจาก Cartrack — ยังเป็น stub ซื่อสัตย์ รอ credentials จริง
// ตอนได้ key: เติม endpoint จริงจากเอกสารที่ Cartrack ให้มาพร้อมสัญญา แล้วลบ stub นี้
export async function fetchLatestPings(env) {
  if (!env || !env.CARTRACK_API_KEY || !env.CARTRACK_API_URL) {
    return { ok: false, reason: 'no-credentials', hint: 'ตั้ง CARTRACK_API_URL + CARTRACK_API_KEY ก่อน (โทรขอจาก Cartrack)' };
  }
  return {
    ok: false, reason: 'not-implemented',
    todo: 'GET <CARTRACK_API_URL>/positions ด้วย Basic Auth → normalizeCartrackPayload() → processPing ทีละจุด'
      + ' · ยืนยัน endpoint จริงจากเอกสารที่ได้พร้อม credentials ก่อน (ต่างตามสัญญา/รีเจียน ห้ามเดา)'
  };
}
