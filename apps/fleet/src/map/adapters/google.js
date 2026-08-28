// adapter: Google Maps — clientConfig พร้อมเสียบ key จริงแล้ว (28 ส.ค. 2569)
// ข้อดี-ข้อเสีย: route/ETA แม่นที่สุด docs ดีที่สุด · แพงที่สุด (ต้องผูกบัตร + ตั้ง quota กันบิลบาน)
// สมัคร key: console.cloud.google.com → เปิด Maps JavaScript API · **จำกัดโดเมน (HTTP referrer) เสมอ**

const stub = (todo) => ({ ok: false, reason: 'not-implemented', todo });

export default {
  name: 'google',
  needsKey: true,
  keyHint: 'console.cloud.google.com → Maps JavaScript API · client key ต้องจำกัดโดเมน · server key (geocode/distance) แยกคนละตัว',

  clientConfig(env = {}) {
    if (!env.MAP_API_KEY) return { ok: false, reason: 'no-key', hint: this.keyHint };
    return {
      ok: true,
      provider: 'google',
      jsUrl: 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(env.MAP_API_KEY) + '&language=th&region=TH',
      engine: 'google',   // ฝั่ง client: new google.maps.Map(el) · AdvancedMarkerElement
    };
  },
  renderMap() { return stub('new google.maps.Map(el, {center, zoom}) — ตัววาดจะ implement ตอนมี key ทดสอบจริง'); },
  addMarker() { return stub('google.maps.marker.AdvancedMarkerElement'); },
  drawRoute() { return stub('google.maps.Polyline / DirectionsService'); },
  geocode() { return stub('GET https://maps.googleapis.com/maps/api/geocode/json?address=..&key=<MAP_SERVER_KEY> (ฝั่ง Worker เท่านั้น — คิดเงินต่อครั้ง)'); },
  distanceMatrix() { return stub('GET https://maps.googleapis.com/maps/api/distancematrix/json?origins=..&destinations=..&key=<MAP_SERVER_KEY>'); },
};
