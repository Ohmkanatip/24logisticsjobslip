// adapter: Mapbox — 🚧 stub ซื่อสัตย์ ยังไม่ implement (รอเจ้าของเคาะ + มี key ก่อน)
// ข้อดี-ข้อเสีย: กลางๆ — ราคากลาง สวย ปรับสไตล์ง่าย free tier กว้าง · ข้อมูลที่อยู่ไทยสู้ Longdo ไม่ได้
// key ที่ต้องมี: MAP_API_KEY (public token pk.*) + MAP_SERVER_KEY (secret token sk.* — server เท่านั้น)

const stub = (todo) => ({ ok: false, reason: 'not-implemented', todo });

export default {
  name: 'mapbox',
  needsKey: true,
  keyHint: 'สร้าง token ที่ account.mapbox.com → public token ใส่ MAP_API_KEY · secret token ใส่ MAP_SERVER_KEY',

  clientConfig(env = {}) {
    // ⚠️ ส่งได้เฉพาะ public token (MAP_API_KEY) — secret token ห้ามหลุดไป client เด็ดขาด
    return stub('TODO: คืน { jsUrl: https://api.mapbox.com/mapbox-gl-js/v3.x/mapbox-gl.js, token: <MAP_API_KEY> } เมื่อ implement จริง');
  },
  renderMap() {
    return stub('TODO: ฝั่ง client ใช้ new mapboxgl.Map(...)');
  },
  addMarker() {
    return stub('TODO: new mapboxgl.Marker(...)');
  },
  drawRoute() {
    return stub('TODO: map.addLayer แบบ line จาก GeoJSON');
  },
  geocode() {
    return stub('TODO: GET https://api.mapbox.com/geocoding/v5/mapbox.places/ (ใช้ MAP_SERVER_KEY ฝั่ง Worker เท่านั้น)');
  },
  distanceMatrix() {
    return stub('TODO: GET https://api.mapbox.com/directions-matrix/v1/ (ใช้ MAP_SERVER_KEY ฝั่ง Worker เท่านั้น)');
  },
};
