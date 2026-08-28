# PROMPT — ร่างโครงแผนที่ติดตามรถ (รอแค่ API key) · เก็บ GPS บน Cloudflare D1 ที่เดียว

> วางไฟล์นี้ให้ Claude Code (VSCode) พร้อม repo `24logisticsjobslip` และ `24LOGISTICS-MASTER-SPEC.md` ในเวิร์กสเปซ
> **สถาปัตยกรรมเคาะแล้ว: D1 อย่างเดียว (ไม่ใช้ Supabase) + สำรองขึ้น R2 เมื่อข้อมูลเกิน 2 เดือน**

---

## เป้าหมาย

ร่าง **โครง (scaffold)** แผนที่ติดตามรถเรียลไทม์ — รถคันไหนอยู่ไหน วิ่งงานไหน — ให้ **พร้อมเสียบทันทีเมื่อได้ API key** (ตอนนี้รัน mock ได้เลย) โดยเก็บ GPS จาก Cartrack ลง **Cloudflare D1 ที่เดียว** เป็นงาน ② ตามแผนแม่บท ทำหลังงาน ① ตอนนี้ทำโครงรอ ไม่แตะ production

## สิ่งที่ต้องทำ (อ่าน 1–2 ก่อนเขียนโค้ด)

1. อ่าน `CLAUDE.md`, `24LOGISTICS-MASTER-SPEC.md` (งาน ②) และดูโครง repo จริง
2. เสนอที่วางไฟล์/สถาปัตยกรรมให้เข้ากับของเดิม แล้วรอเคาะ ค่อย implement
3. Implement **mock-first**: ทุกส่วนรันได้ด้วยข้อมูลปลอมทันที จุดรอของจริงคั่นด้วย env var + adapter ชัดเจน

---

## สถาปัตยกรรมข้อมูล: D1 ที่เดียว

**ทำไม D1 อย่างเดียว:** ฟรี 5GB, อยู่ค่าย Cloudflare เดียวกับ Worker/R2, query จาก Worker ให้แผนที่ได้ตรงๆ ไม่ต้องมี 2 ที่เก็บ/ไม่ต้อง sync

**⚠️ เพดานที่ต้องออกแบบรับมือ — D1 free เขียนได้ 100,000 แถว/วัน (รีเซ็ตเที่ยงคืน UTC):**
- 60 คัน × ปิง 1/นาที = **86,400 แถว/วัน** → เหลือ headroom แค่ ~15%
- ปิง 30 วิ = 172,800/วัน → **ทะลุ เขียนไม่เข้าทั้งวัน**; รถเพิ่มเป็น 70 คัน@1นาที = 100,800/วัน → **ทะลุ**
- **บังคับ mitigations ในโค้ด:**
  1. **เขียน `gps_track` เฉพาะตอนรถขยับ** (ระยะจากจุดก่อนหน้า > threshold เช่น 20 ม. หรือ speed > 0) — รถจอดท่า/ลานไม่บันทึกซ้ำ ตัด write 30–50%
  2. คงปิงที่ **1/นาที** เป็นเพดานบน อย่าถี่กว่า
  3. `gps_live` ใช้ **UPSERT** 1 แถว/คัน (ไม่เพิ่มแถว) — อัปเดตตำแหน่งล่าสุด
  4. ทำ counter เตือนเมื่อ write ใกล้ 90k/วัน + ทางหนี: อัป Workers Paid ($5/เดือน) ปลดเพดานทันที
- storage ไม่ใช่คอขวด: 60 วัน ~0.5GB จาก 5GB

**Retention + สำรองขึ้น R2 (เกิน 2 เดือน):**
- เก็บ `gps_track` สดใน D1 **60 วันล่าสุด**
- job รายเดือน: export แถวที่เก่ากว่า 60 วัน → บีบอัด (gzip CSV/Parquet) → อัปขึ้น **R2** แล้วลบออกจาก D1
- R2 free 10GB + egress ฟรี (5M แถว/2เดือน บีบแล้ว ~20–50MB → เก็บได้หลายปี)
- `trip_daily` (สรุปรายวัน) **เก็บถาวรใน D1** ไม่ลบ (เล็กมาก)

## Schema บน D1 (SQLite — ร่าง ปรับได้)

```sql
CREATE TABLE vehicles (            -- ทะเบียนรถ (sync จากระบบเดิม)
  id TEXT PRIMARY KEY,             -- "71-3760"
  driver_name TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE gps_live (            -- ตำแหน่งล่าสุด 1 แถว/คัน (UPSERT, แผนที่อ่านตัวนี้)
  vehicle_id TEXT PRIMARY KEY,
  lat REAL, lng REAL,
  speed_kmh REAL, heading INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE gps_track (           -- ปิงดิบ 60 วัน (เขียนเฉพาะตอนขยับ)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id TEXT, lat REAL, lng REAL, ts TEXT NOT NULL
);
CREATE INDEX idx_track ON gps_track(vehicle_id, ts);

CREATE TABLE job_assignment (      -- จับคู่ใบงาน ↔ รถ (เชื่อมงาน ①/③)
  job_id TEXT, vehicle_id TEXT,
  container_no TEXT,               -- เบอร์ตู้จาก OCR (งาน ③)
  origin TEXT, destination TEXT,
  status TEXT,                     -- รับงาน/กำลังวิ่ง/ส่งแล้ว
  assigned_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE trip_daily (          -- สรุปรายวันถาวร
  vehicle_id TEXT, day TEXT,
  distance_km REAL, trips INTEGER,
  PRIMARY KEY (vehicle_id, day)
);
```
> ไม่มี PostGIS — คำนวณระยะ/รัศมีด้วย haversine ใน Worker (พอสำหรับ use case นี้)

## แผนที่ (frontend) — อ่านจาก D1 ผ่าน Worker

- Worker endpoint (เช่น `GET /api/fleet/live`) อ่าน `gps_live` join `job_assignment` → คืน JSON
- หน้าแผนที่วาง marker ทุกคัน สีตามสถานะงาน (ว่าง/วิ่ง/ถึงแล้ว) กด marker → ทะเบียน+คนขับ+งาน+เบอร์ตู้
- อัปเดตสด: **poll ทุก 15–30 วิ** (D1 ไม่มี realtime push แบบ Supabase — ใช้ polling; อ่าน 5M แถว/วันเหลือเฟือ)
- สถานะ "รอ key": ไม่มี `MAP_API_KEY` → fallback Leaflet+OSM + mock feed + แบนเนอร์ "โหมด mock"

## Map provider = adapter สลับได้ รอแค่ key

- interface กลาง `MapProvider` (`renderMap/addMarker/drawRoute/geocode/distanceMatrix`) แต่ละเจ้าเป็น adapter แยกไฟล์
- เลือกด้วย env: `MAP_PROVIDER` + `MAP_API_KEY`; default ไม่มี key = **Leaflet+OSM** (ไม่ต้อง key) + mock markers
- adapter ที่ควรเตรียมโครง (เจ้าของยังไม่เคาะ): **Longdo Map** (เจ้าไทย ที่อยู่/จราจรไทยดี), **Google Maps** (route แม่น แพง), **Mapbox** (กลาง), **Leaflet+OSM** (ฟรี, dev)
- แยก **client key** (แสดงแผนที่) ออกจาก **server key** (geocode/distance คิดเงิน) — server key ห้ามหลุด client

## Env (placeholder รอเติม)

```
MAP_PROVIDER=leaflet          # leaflet | longdo | google | mapbox
MAP_API_KEY=                  # เว้นว่าง = โหมด mock
MAP_SERVER_KEY=               # geocode/distance ฝั่ง server เท่านั้น
CARTRACK_API_URL=
CARTRACK_API_KEY=             # ยืนยันรูปแบบจริงจากบัญชี Cartrack ไทย
R2_BUCKET=                    # ปลายทางสำรอง gps_track เกิน 60 วัน
```

## กติกา/ข้อควรระวัง

- **ทำโครงรอเท่านั้น** — ไม่แตะ production, ไม่รอ key, รัน mock ได้
- ใส่ mitigations เพดาน write 100k/วันตั้งแต่แรก (เขียนตอนขยับ + UPSERT live + counter เตือน)
- Cartrack API จริง (auth/endpoint/ความถี่) ต่างตามสัญญา/รีเจียน → ทำ adapter + mock feed อย่าเดา endpoint
- server key ห้ามอยู่ client; ผ่านกติกากรอง 2 ข้อ (Cartrack กรอกอัตโนมัติ ✓ / ศูนย์จัดรถใช้ตัดสินใจ ✓)

## ต้องให้เจ้าของเคาะ

- Map provider จริง — Longdo vs Google vs Mapbox: ความแม่นที่อยู่ไทย + ค่าใช้จ่ายที่ ~60–100 งาน/วัน
- ความถี่ปิง Cartrack จริง (ยิ่งถี่ยิ่งชนเพดาน write)
- threshold "รถขยับ" ที่จะเริ่มบันทึก (กี่เมตร)

## เสร็จเมื่อ (เฟสโครงรอ)

- รันแล้วเห็นแผนที่ + รถ mock วิ่ง กดดูข้อมูลงานได้ — โดยไม่ต้องมี key
- สลับ provider ได้ด้วยแก้ env ตัวเดียว
- Schema D1 + Worker endpoint + map/storage adapter + mock feed + logic เขียนตอนขยับ + job สำรอง R2 ครบ, มีเทสต์
- เขียนใน `CLAUDE.md`: สถาปัตยกรรม D1-only + เพดาน write 100k/วัน + วิธีรับมือ + cadence สำรอง R2
