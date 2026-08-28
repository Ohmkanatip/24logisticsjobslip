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
