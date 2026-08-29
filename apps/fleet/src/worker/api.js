// ฟังก์ชัน API ที่แยกจาก worker/index.js เพื่อให้เทสด้วย Node ตรงๆ ได้
// (index.js import map.html เป็น text module — Node import ไม่ได้ เทสเลยเข้าไม่ถึงของที่อยู่ในนั้น)

import { chooseProvider } from '../map/provider.js';

// ตรวจสิทธิ์ POST /api/fleet/ingest — ด่านกันคนนอกยิงปิงปลอม (ตัวตรวจอิสระเจอ 28 ส.ค. 2569)
// ตั้ง INGEST_TOKEN เมื่อไหร่ = ทุก request ต้องแนบ Authorization: Bearer <token> ให้ตรง
// ไม่ตั้ง (โหมดทดลองในเครื่อง) = ผ่าน — แต่ก่อนใช้จริงต้องตั้งเสมอ
export function ingestAuthorized(request, env) {
  if (!env.INGEST_TOKEN) return true;
  const h = (request && request.headers && request.headers.get('authorization')) || '';
  return h === 'Bearer ' + env.INGEST_TOKEN;
}

// V73: ด่านของ POST /api/fleet/assign — คนยิงคือ Apps Script (fleetPush_) ไม่ใช่ Cartrack
// แยก token คนละตัวกับ INGEST_TOKEN: หลุดตัวหนึ่งไม่พาอีกตัวหลุดตาม
export function assignAuthorized(request, env) {
  if (!env.ASSIGN_TOKEN) return true;   // โหมดทดลองในเครื่อง — ก่อนใช้จริงต้องตั้งเสมอ (แพทเทิร์นเดียวกับ INGEST_TOKEN)
  const h = (request && request.headers && request.headers.get('authorization')) || '';
  return h === 'Bearer ' + env.ASSIGN_TOKEN;
}

// V73: รับงานจากระบบจ่ายงาน (jobslip) → upsert รถ + บันทึกงานลง job_assignment
// แยกจาก worker/index.js เพื่อเทสด้วย Node ตรงๆ ได้ (ฉีด repo เอง) — body ที่ .gs fleetPush_ ส่งมา:
//   { jobId, plate, driverName?, containerNo?, origin?, destination?, status?, assignedAt? }
export async function handleAssign(request, env, repo) {
  if (!assignAuthorized(request, env)) return { status: 401, body: { ok: false, reason: 'unauthorized' } };
  let b = null;
  try { b = await request.json(); } catch (_e) { b = null; }
  if (!b || !b.jobId || !b.plate) {
    return { status: 400, body: { ok: false, reason: 'bad-body', hint: 'ต้องมี {jobId, plate}' } };
  }
  const plate = String(b.plate).trim();
  await repo.upsertVehicle({ id: plate, driver_name: b.driverName ? String(b.driverName) : null });
  const r = await repo.assignJob({
    job_id: String(b.jobId), vehicle_id: plate,
    container_no: b.containerNo ? String(b.containerNo) : null,
    origin: b.origin ? String(b.origin) : null,
    destination: b.destination ? String(b.destination) : null,
    status: b.status ? String(b.status) : 'assigned',
    assigned_at: Number(b.assignedAt) || null,
  });
  if (!r.ok) return { status: 400, body: r };
  return { status: 200, body: { ok: true, updated: !!r.updated } };
}

// GET /api/fleet/mapconfig — บอกหน้าเว็บว่า env เลือก provider อะไร
// แก้ MAP_PROVIDER ตัวเดียว หน้าแผนที่รู้ทันที (เกณฑ์ "สลับ provider ด้วย env ตัวเดียว" ของสเปก)
// ส่งเฉพาะของที่ปลอดภัยฝั่ง client — MAP_SERVER_KEY ไม่มีทางออกไปทางนี้
export function mapConfigOf(env = {}) {
  const p = chooseProvider(env);
  const wanted = String(env.MAP_PROVIDER || 'leaflet').toLowerCase().trim();
  return {
    provider: p.name,
    wanted,                        // ที่ตั้งไว้ใน env (อาจไม่เท่า provider ถ้าโดน fallback)
    fallback: p.name !== wanted,   // true = ตัวที่ขอยังใช้ไม่ได้ (ไม่มี key/ยังไม่ implement) เลยถอยมา leaflet
    client: p.clientConfig ? p.clientConfig(env) : null,
  };
}
