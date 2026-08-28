// สูตร haversine — ระยะทางวงกลมใหญ่ระหว่างพิกัด 2 จุด คืนค่าเป็น "เมตร"
// ใช้เป็นตัวตัดสิน "รถขยับจริงไหม" ใน ingest.js (mitigation ข้อ 1 ของเพดานเขียน D1)

const EARTH_R_M = 6371000; // รัศมีโลกเฉลี่ย (เมตร)

export function haversineM(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(a));
}
