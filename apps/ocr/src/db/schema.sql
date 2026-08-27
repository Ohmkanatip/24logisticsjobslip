-- ตารางพักผลเบอร์ตู้ที่คนขับยืนยันแล้ว (ทางเลือก ③ — เจ้าของเคาะ 28 ส.ค. 2569)
-- บอทเขียนที่นี่เท่านั้น ไม่แตะชีท · เว็บ jobslip ดึงผ่าน GET /api/ocr/results แล้วเข้าชีทตามเส้นทางบันทึกเดิม
-- แถวไม่ถูกลบ — ดึงไปใช้แล้วติดธง pulled ไว้สาวย้อน (หลักเดียวกับประวัติ/ถังขยะของระบบแม่)
CREATE TABLE IF NOT EXISTS ocr_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_no TEXT NOT NULL,       -- เบอร์ตู้ที่ผ่านเช็คดิจิตแล้ว (ตรวจซ้ำตอน postback อีกชั้น)
  confirmed_by TEXT,                -- LINE userId ของคนขับที่กดยืนยัน
  driver_id TEXT,                   -- driverId (D001…) ถ้าจับคู่ LINE↔คนขับได้แล้ว
  job_uid TEXT,                     -- uid ใบงาน/ร่าง ถ้ารู้ (เฟส LIFF จะรู้เสมอ · เฟสแชทอาจว่าง)
  ts INTEGER,                       -- เวลาที่ยืนยัน (ms — จาก event.timestamp ของ LINE)
  status TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed = รอเว็บดึง · pulled = เว็บใช้แล้ว
  pulled_by TEXT,                   -- ใครดึงไปใช้ (ชื่อผู้ใช้ฝั่งเว็บ)
  pulled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ocr_results_status ON ocr_results(status, driver_id);
