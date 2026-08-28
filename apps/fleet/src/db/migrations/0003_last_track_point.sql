-- แก้บั๊ก "รถคืบช้าๆ ไม่ถูกบันทึก track" (จดค้างไว้ใน CLAUDE.md — แก้ 28 ส.ค. 2569)
-- movement filter เดิมวัดระยะจาก "ปิงล่าสุด" ซึ่งขยับตามทุกปิง → รถที่คืบครั้งละ < threshold
-- ที่ speed=0 ไม่มีวันสะสมระยะถึงเกณฑ์ = เส้นทางหายไปทั้งช่วงแบบเงียบๆ
-- ตอนนี้จำ "จุด track ล่าสุดที่ถูกเขียนจริง" ไว้ใน gps_live แล้ววัดจากจุดนั้นแทน
ALTER TABLE gps_live ADD COLUMN last_track_lat REAL;
ALTER TABLE gps_live ADD COLUMN last_track_lng REAL;
