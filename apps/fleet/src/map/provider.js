// เลือก map provider ตาม env.MAP_PROVIDER
//
// interface ของ adapter ทุกตัว (ต้องมีครบ):
//   name          — ชื่อ provider
//   needsKey      — ต้องมี key ไหม
//   clientConfig(env) — config ที่ปลอดภัยส่งให้ client (❌ ห้ามมี MAP_SERVER_KEY เด็ดขาด)
//   renderMap(env)    — วิธีวาดแผนที่ฝั่ง client
//   addMarker(...)    — เพิ่มหมุด
//   drawRoute(...)    — วาดเส้นทาง
//   geocode(env, q)          — ที่อยู่ → พิกัด (ฝั่ง server ใช้ MAP_SERVER_KEY)
//   distanceMatrix(env, ...) — ระยะทาง/เวลาเดินทาง (ฝั่ง server ใช้ MAP_SERVER_KEY)
//
// กติกา: ไม่มี key / MAP_PROVIDER ไม่รู้จัก → fallback เป็น leaflet (OSM ฟรี ไม่ต้องมี key)

import leaflet from './adapters/leaflet.js';
import longdo from './adapters/longdo.js';
import google from './adapters/google.js';
import mapbox from './adapters/mapbox.js';

const ADAPTERS = { leaflet, longdo, google, mapbox };

export function chooseProvider(env = {}) {
  const name = String(env.MAP_PROVIDER || '').toLowerCase().trim();
  const adapter = ADAPTERS[name];
  if (!adapter) return leaflet;                    // ไม่รู้จัก/ไม่ตั้งค่า = leaflet
  if (adapter.needsKey && !env.MAP_API_KEY) return leaflet; // provider ต้องมี key แต่ไม่มี = leaflet
  return adapter;
}
