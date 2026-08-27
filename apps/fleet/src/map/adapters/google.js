// adapter: Google Maps — 🚧 stub ซื่อสัตย์ ยังไม่ implement (รอเจ้าของเคาะ + มี key ก่อน)
// ข้อดี-ข้อเสีย: route/ETA แม่นที่สุด ecosystem ใหญ่ · แพง (คิดต่อ request หลังเครดิตฟรีหมด) ต้องผูกบัตร
// key ที่ต้องมี: MAP_API_KEY (client · จำกัดโดเมนแล้ว) + MAP_SERVER_KEY (server · จำกัด IP)

const stub = (todo) => ({ ok: false, reason: 'not-implemented', todo });

export default {
  name: 'google',
  needsKey: true,
  keyHint: 'สร้าง key ที่ console.cloud.google.com (เปิด Maps JavaScript API + Geocoding + Distance Matrix) → ใส่ .dev.vars',

  clientConfig(env = {}) {
    // ⚠️ ส่งได้เฉพาะ MAP_API_KEY — MAP_SERVER_KEY ห้ามหลุดไป client เด็ดขาด
    return stub('TODO: คืน { jsUrl: https://maps.googleapis.com/maps/api/js?key=<MAP_API_KEY> } เมื่อ implement จริง');
  },
  renderMap() {
    return stub('TODO: ฝั่ง client ใช้ new google.maps.Map(...)');
  },
  addMarker() {
    return stub('TODO: google.maps.marker.AdvancedMarkerElement');
  },
  drawRoute() {
    return stub('TODO: DirectionsService + DirectionsRenderer');
  },
  geocode() {
    return stub('TODO: GET https://maps.googleapis.com/maps/api/geocode/json (ใช้ MAP_SERVER_KEY ฝั่ง Worker เท่านั้น)');
  },
  distanceMatrix() {
    return stub('TODO: GET https://maps.googleapis.com/maps/api/distancematrix/json (ใช้ MAP_SERVER_KEY ฝั่ง Worker เท่านั้น)');
  },
};
