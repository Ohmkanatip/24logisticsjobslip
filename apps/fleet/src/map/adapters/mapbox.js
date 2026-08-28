// adapter: Mapbox — clientConfig พร้อมเสียบ key จริงแล้ว (28 ส.ค. 2569)
// ข้อดี-ข้อเสีย: สวย ปรับแต่งสไตล์ได้เยอะ ฟรีเทียร์กว้าง (50k โหลด/เดือน) · ข้อมูลที่อยู่ไทยสู้ Longdo/Google ไม่ได้
// สมัคร key: account.mapbox.com → access token (pk.*) ใส่ MAP_API_KEY

const stub = (todo) => ({ ok: false, reason: 'not-implemented', todo });

export default {
  name: 'mapbox',
  needsKey: true,
  keyHint: 'account.mapbox.com → access token (ขึ้นต้น pk.) ใส่ MAP_API_KEY · จำกัด URL ใน token settings',

  clientConfig(env = {}) {
    if (!env.MAP_API_KEY) return { ok: false, reason: 'no-key', hint: this.keyHint };
    return {
      ok: true,
      provider: 'mapbox',
      jsUrl: 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js',
      cssUrl: 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css',
      accessToken: env.MAP_API_KEY,   // pk.* เป็น public token ออกแบบมาให้อยู่ฝั่ง client ได้
      engine: 'mapbox',               // ฝั่ง client: new mapboxgl.Map({container, style})
    };
  },
  renderMap() { return stub('new mapboxgl.Map({container, style: mapbox://styles/mapbox/streets-v12}) — implement ตอนมี key'); },
  addMarker() { return stub('new mapboxgl.Marker().setLngLat([lng,lat])'); },
  drawRoute() { return stub('map.addLayer line จาก GeoJSON'); },
  geocode() { return stub('GET https://api.mapbox.com/geocoding/v5/mapbox.places/<query>.json?access_token=<MAP_SERVER_KEY>'); },
  distanceMatrix() { return stub('GET https://api.mapbox.com/directions-matrix/v1/mapbox/driving/<coords>?access_token=<MAP_SERVER_KEY>'); },
};
