// adapter: Longdo Map — clientConfig พร้อมเสียบ key จริงแล้ว (28 ส.ค. 2569)
// ข้อดี-ข้อเสีย: เจ้าไทย — ข้อมูลที่อยู่/จราจรไทยดีที่สุด ราคาถูกกว่า Google · community เล็กกว่า docs อังกฤษน้อย
// สมัคร key: map.longdo.com/console → ใส่ MAP_API_KEY (client) + MAP_SERVER_KEY (server) ใน .dev.vars

const stub = (todo) => ({ ok: false, reason: 'not-implemented', todo });

export default {
  name: 'longdo',
  needsKey: true,
  keyHint: 'สมัครที่ map.longdo.com/console → MAP_API_KEY (แสดงแผนที่) + MAP_SERVER_KEY (geocode/route)',

  // ✅ ของจริง: มี MAP_API_KEY = คืน config ที่หน้าเว็บใช้โหลด Longdo Map API ได้เลย
  // ⚠️ ส่งเฉพาะ client key — MAP_SERVER_KEY ห้ามหลุดไป client เด็ดขาด (มีเทสล็อกไว้)
  clientConfig(env = {}) {
    if (!env.MAP_API_KEY) return { ok: false, reason: 'no-key', hint: this.keyHint };
    return {
      ok: true,
      provider: 'longdo',
      jsUrl: 'https://api.longdo.com/map/?key=' + encodeURIComponent(env.MAP_API_KEY),
      // วิธีวาดฝั่ง client (หน้าเว็บอ่าน engine นี้ไปเลือกโค้ดวาด):
      //   new longdo.Map({ placeholder: el }) · map.location({ lon, lat }) · longdo.Marker
      engine: 'longdo',
    };
  },
  renderMap() { return stub('วาดฝั่ง client: new longdo.Map({placeholder}) — ตัววาดในหน้าเว็บจะ implement ตอนมี key ให้ทดสอบจริง'); },
  addMarker() { return stub('longdo.Marker({ lon, lat }, { title })'); },
  drawRoute() { return stub('longdo.Polyline หรือ Route service'); },
  // ฝั่ง server — ใช้ MAP_SERVER_KEY เท่านั้น · endpoint จริงจดไว้แล้ว รอ key เพื่อทดสอบก่อนเปิดใช้
  geocode() { return stub('GET https://search.longdo.com/addresslookup/api/addr/geocoding?text=<ที่อยู่>&key=<MAP_SERVER_KEY>'); },
  distanceMatrix() { return stub('GET https://api.longdo.com/RouteService/json/route/guide?flon=..&flat=..&tlon=..&tlat=..&key=<MAP_SERVER_KEY>'); },
};
