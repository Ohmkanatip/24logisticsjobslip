-- 0001_init — migration แรก: สร้าง 5 ตารางของระบบติดตามรถ (Cloudflare D1 = SQLite)
-- รันตอน setup จริงด้วย: wrangler d1 migrations apply fleet-24logistics
-- เนื้อหาต้องตรงกับ src/db/schema.sql เสมอ (schema.sql = ภาพรวมล่าสุด)

-- ทะเบียนรถ + คนขับประจำคัน (แถวน้อย แก้ไม่บ่อย)
CREATE TABLE IF NOT EXISTS vehicles (
  id          TEXT PRIMARY KEY,          -- ทะเบียนรถ เช่น '71-3760'
  driver_name TEXT,                      -- ชื่อคนขับประจำคัน
  active      INTEGER NOT NULL DEFAULT 1 -- 1 = ยังวิ่งอยู่ · 0 = ปลดระวาง/ขายแล้ว (soft delete ไม่ลบแถว)
);

-- ตำแหน่งล่าสุดของแต่ละคัน — UPSERT ทับแถวเดิมเสมอ (mitigation ข้อ 2: 1 แถว/คัน ไม่งอกตามเวลา)
CREATE TABLE IF NOT EXISTS gps_live (
  vehicle_id TEXT PRIMARY KEY,           -- อ้าง vehicles.id
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  speed_kmh  REAL NOT NULL DEFAULT 0,    -- ความเร็ว กม./ชม.
  heading    REAL NOT NULL DEFAULT 0,    -- ทิศหัวรถ (องศา 0-360)
  updated_at INTEGER NOT NULL            -- epoch millis ของปิงล่าสุด
);

-- ประวัติเส้นทาง — เขียนเฉพาะตอนรถขยับ (mitigation ข้อ 1) · เก่ากว่า 60 วันย้ายขึ้น R2 แล้วลบ (src/archive/r2Archive.js)
CREATE TABLE IF NOT EXISTS gps_track (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id TEXT NOT NULL,              -- อ้าง vehicles.id
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  ts         INTEGER NOT NULL            -- epoch millis ของปิง
);
-- index หลักของการดูเส้นทางย้อนหลังรายคัน + การเลือกช่วงเวลาไป archive
CREATE INDEX IF NOT EXISTS idx_track ON gps_track (vehicle_id, ts);

-- งานที่จ่ายให้รถแต่ละคัน (เชื่อมกับระบบใบงานภายหลัง — ตอนนี้เก็บเองก่อน)
CREATE TABLE IF NOT EXISTS job_assignment (
  job_id       TEXT,                     -- เลขงาน/uid จากระบบใบงาน
  vehicle_id   TEXT,                     -- อ้าง vehicles.id
  container_no TEXT,                     -- เบอร์ตู้
  origin       TEXT,                     -- ต้นทาง
  destination  TEXT,                     -- ปลายทาง
  status       TEXT,                     -- สถานะงาน เช่น assigned / running / done
  assigned_at  INTEGER                   -- epoch millis ตอนจ่ายงาน
);

-- สรุประยะทาง/จำนวนเที่ยวต่อคันต่อวัน — ⭐ เก็บถาวร ไม่ลบ (แถวน้อย ใช้ทำ KPI/กำไรต่อเที่ยวย้อนหลังได้ตลอด)
CREATE TABLE IF NOT EXISTS trip_daily (
  vehicle_id  TEXT NOT NULL,             -- อ้าง vehicles.id
  day         TEXT NOT NULL,             -- 'YYYY-MM-DD' (UTC)
  distance_km REAL NOT NULL DEFAULT 0,   -- ระยะทางรวมของวัน
  trips       INTEGER NOT NULL DEFAULT 0,-- จำนวนเที่ยวของวัน
  PRIMARY KEY (vehicle_id, day)
);
