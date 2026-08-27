-- index สำหรับนับ write รายวัน (เพิ่ม 28 ส.ค. 2569)
-- ⚠️ ทำไมต้องมี: countTrackWritesOn เดิมใช้ `WHERE date(ts/1000,'unixepoch') = ?`
--    ฟังก์ชันคร่อมคอลัมน์ = SQLite ใช้ index ไม่ได้ ต้องสแกนทั้งตารางทุกปิง
--    60 วัน × ~86,000 แถว ≈ 5 ล้านแถว/ครั้ง · D1 free อ่านได้ 5,000,000 แถว/วัน
--    → แค่ปิงเดียวก็เกือบหมดโควตาอ่านทั้งวัน
--    ตอนนี้ query เป็น `WHERE ts >= ? AND ts < ?` ซึ่งใช้ index ตัวนี้ได้ (อ่านเฉพาะแถวของวันนั้น)
-- idx_track (vehicle_id, ts) ที่มีอยู่ใช้กับ query นี้ไม่ได้ เพราะไม่ได้ระบุ vehicle_id
CREATE INDEX IF NOT EXISTS idx_track_ts ON gps_track (ts);
