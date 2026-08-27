// adapter: Leaflet + OpenStreetMap — ตัวเดียวที่ใช้งานได้จริงตอนนี้ (ฟรี ไม่ต้องมี key)
// ฝั่ง client โหลด Leaflet จาก CDN (unpkg) แล้วใช้ tile ของ OSM — ดู src/public/map.html
// ข้อจำกัด: OSM ไม่มี geocode/distance ให้ใช้ตรงๆ ในเชิงพาณิชย์ → สองฟังก์ชันนั้นเป็น stub ซื่อสัตย์

const notImplemented = (todo) => ({ ok: false, reason: 'not-implemented', todo });

export default {
  name: 'leaflet',
  needsKey: false,

  // config ที่ปลอดภัยส่งให้ client — ไม่มี key ใดๆ
  clientConfig() {
    return {
      ok: true,
      provider: 'leaflet',
      cssUrl: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
      jsUrl: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    };
  },

  // 3 ตัวนี้ทำงานฝั่ง client ด้วย Leaflet ตรงๆ (map.html เป็นคนเรียก L.map/L.marker/L.polyline)
  renderMap() {
    return { ok: true, note: 'client วาดเองด้วย L.map — ใช้ clientConfig() ประกอบ' };
  },
  addMarker() {
    return { ok: true, note: 'client วาดเองด้วย L.circleMarker' };
  },
  drawRoute() {
    return { ok: true, note: 'client วาดเองด้วย L.polyline' };
  },

  // OSM/Nominatim มีเงื่อนไขการใช้ — ยังไม่ทำจนกว่าเจ้าของเคาะ provider จริง
  geocode() {
    return notImplemented('geocode ต้องใช้ provider ที่มี key (Longdo/Google/Mapbox) — รอเจ้าของเคาะ');
  },
  distanceMatrix() {
    return notImplemented('distance matrix ต้องใช้ provider ที่มี key — รอเจ้าของเคาะ');
  },
};
