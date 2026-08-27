// adapter: Longdo Map — 🚧 stub ซื่อสัตย์ ยังไม่ implement (รอเจ้าของเคาะ + มี key ก่อน)
// ข้อดี-ข้อเสีย: เจ้าไทย — ข้อมูลที่อยู่/จราจรไทยดีที่สุด ราคาถูกกว่า Google · community เล็กกว่า docs อังกฤษน้อย
// key ที่ต้องมี: MAP_API_KEY (client แสดงแผนที่) + MAP_SERVER_KEY (server เรียก geocode/route)

const stub = (todo) => ({ ok: false, reason: 'not-implemented', todo });

export default {
  name: 'longdo',
  needsKey: true,
  keyHint: 'สมัครที่ map.longdo.com/console → เอา key มาใส่ MAP_API_KEY / MAP_SERVER_KEY ใน .dev.vars',

  clientConfig(env = {}) {
    // ⚠️ ส่งได้เฉพาะ MAP_API_KEY (client key) — MAP_SERVER_KEY ห้ามหลุดไป client เด็ดขาด
    return stub('TODO: คืน { jsUrl: https://api.longdo.com/map/?key=<MAP_API_KEY> } เมื่อ implement จริง');
  },
  renderMap() {
    return stub('TODO: ฝั่ง client ใช้ new longdo.Map({...})');
  },
  addMarker() {
    return stub('TODO: longdo.Marker');
  },
  drawRoute() {
    return stub('TODO: longdo.Polyline หรือ route service');
  },
  geocode() {
    return stub('TODO: GET https://search.longdo.com/addresslookup/api/addr/geocoding (ใช้ MAP_SERVER_KEY ฝั่ง Worker เท่านั้น)');
  },
  distanceMatrix() {
    return stub('TODO: GET https://api.longdo.com/RouteService/json/route/guide (ใช้ MAP_SERVER_KEY ฝั่ง Worker เท่านั้น)');
  },
};
