# CLAUDE.md — apps/fleet: แผนที่ติดตามรถ + GPS บน Cloudflare D1 (โครงรอ · mock-first)

## โปรเจกต์นี้คืออะไร
ระบบติดตามรถหัวลาก ~46 คัน ของ 24 Logistics: รับพิกัด GPS จาก Cartrack → เก็บลง **Cloudflare D1 ที่เดียว** → แสดงแผนที่สดผ่าน Worker → ข้อมูลเก่ากว่า 60 วันสำรองขึ้น **R2** แล้วลบจาก D1
**สถานะ: โครงรอเท่านั้น — ห้าม deploy** · ยังไม่มี Cartrack API key → **ทุกอย่างรันได้ในโหมด mock โดยไม่ต้องมี key ใดๆ**

## สถาปัตยกรรม D1-only + เพดานเขียน 100,000 แถว/วัน
D1 free เขียนได้ **100,000 แถว/วัน** · 60 คัน × ปิงทุก 1 นาที = 86,400 แถว/วัน → headroom แค่ ~15% จึงบังคับ 3 อย่างในโค้ดจริง (ไม่ใช่แค่คอมเมนต์):
1. **เขียน `gps_track` เฉพาะตอนรถขยับ** — haversine จากจุดก่อนหน้า > threshold (ค่าเริ่มต้น 20 เมตร ปรับผ่าน env `MOVE_THRESHOLD_M`) หรือ `speed_kmh > 0` · รถจอดไม่บันทึกซ้ำ → ดู `src/worker/ingest.js`
2. **`gps_live` ใช้ UPSERT 1 แถว/คัน** ไม่เพิ่มแถว → ตำแหน่งล่าสุดมีแถวเดียวเสมอ
3. **counter นับ write วันนี้** + `checkWriteBudget(count)` คืน `{level:'ok'|'warn'|'over'}` — warn ที่ 90,000 · over ที่ 100,000 (over = หยุดเขียน track แต่ live ยังอัปเดต)

### cadence สำรองขึ้น R2
- `src/archive/r2Archive.js` → `archiveOldTracks(repo, r2, cutoffTs)` — เลือกแถว `gps_track` เก่ากว่า cutoff (= ตอนนี้ − 60 วัน) → CSV → gzip → `r2.put` → ลบจาก D1
- **key บน R2 = `gps_track/YYYY-MM/run-<cutoffTs>.csv.gz`** — มี run-<cutoffTs> เพราะตัวตรวจอิสระเจอบั๊ก (28 ส.ค. 2569): key รายเดือนล้วนถูกรอบถัดไป put ทับ ทั้งที่แถวรอบก่อนถูกลบจาก D1 แล้ว = หายถาวร · key ไม่ซ้ำต่อรอบ = archive สะสม ไม่มีทางทับ
- **ตัวเรียกมีแล้ว**: `scheduled` handler ใน `src/worker/index.js` (ข้ามเงียบในโหมด mock) · cron ใน `wrangler.jsonc` **คอมเมนต์ไว้** — เปิดตอน setup จริงหลังเจ้าของเคาะ cadence
- ตาราง `trip_daily` (สรุประยะทาง/เที่ยวต่อวัน) **เก็บถาวรใน D1 ไม่ลบ** — แถวน้อย (60 คัน × 365 วัน ≈ 22k แถว/ปี) · ⚠️ ตอนนี้มีแต่ schema ยังไม่มีโค้ดเขียน/อ่าน (ทำตอนต่อ Cartrack จริง)

## วิธีรัน (ไม่ต้องมี wrangler / ไม่ต้องมี key)
```bash
node demo-server.js     # หรือ npm run demo → เปิด http://localhost:8787 เห็นแผนที่รถ mock 4 คันวิ่งจริง
node tests/run.js       # หรือ npm test → ต้องเขียวทุกเคส (ผ่าน X · ตก 0)
```

## 🧬 Mutation test — พิสูจน์ว่าเทสไม่ใช่เทสหลอก
```bash
node tests/mutation.js     # หรือ npm run mutation
```
**หลักการ:** "เทสผ่าน" ไม่ได้แปลว่าเทสดี — อาจเป็นเทสที่ไม่ว่าโค้ดผิดยังไงก็ผ่าน
เครื่องมือนี้ **แกล้งฝังบั๊ก 18 ตัวลงโค้ดจริง → รันเทส → เทสต้องตก** แล้วคืนโค้ดต้นฉบับให้อัตโนมัติ (`finally` เสมอ + ตรวจซ้ำท้ายสุด + รันเทสปิดท้ายพิสูจน์ว่าไม่มีบั๊กค้าง)

- ✅ **ฆ่าได้** = ด่านนั้นเชื่อถือได้จริง
- 🕳 **SURVIVED** = ฝังบั๊กแล้วเทสยังเขียว → **เทสมีรู ต้องเพิ่มเทส** (exit 1)
- ⚠️ **MUTATION-BROKEN** = หา find ไม่เจอ/เจอหลายที่ → ต้องมาแก้รายการ mutation (โค้ดเปลี่ยนไปแล้ว)

**สถานะ: ฆ่าได้ 18/18** · รอบแรกรอด 3 ตัว = เจอรูจริงในเทส แล้วอุดจนครบ
**แก้โค้ดในไฟล์ที่ mutation อ้างถึงแล้ว ต้องรันตัวนี้ด้วยเสมอ** ไม่ใช่แค่ `npm test`

## สิ่งที่รอเจ้าของเคาะ (อย่าตัดสินใจแทน)
- **map provider จริง** — ตอนนี้ default = Leaflet+OSM (ฟรี ไม่มี key) · ทางเลือก: Longdo (เจ้าไทย ที่อยู่/จราจรไทยดี) · Google (route แม่นแต่แพง) · Mapbox (กลางๆ) — stub ทั้ง 3 อยู่ `src/map/adapters/`
- **ความถี่ปิงของ Cartrack** — สมมติไว้ 1/นาที ถ้าถี่กว่านี้ต้องคิดเพดาน D1 ใหม่
- **threshold รถขยับ** — ค่าเริ่มต้น 20 เมตร (env `MOVE_THRESHOLD_M`)
- สร้าง D1/R2 จริง + เติม `database_id` ใน `wrangler.jsonc`

## ข้อจำกัดที่รู้แล้ว (จดไว้ ไม่ใช่ลืม)
- **รถคืบช้าๆ ต่ำกว่า threshold ต่อปิงที่ speed=0** จะไม่ถูกบันทึก track แม้ขยับสะสมไกล — เพราะวัดระยะจากปิงก่อนหน้า (gps_live) ไม่ใช่จุด track ล่าสุดที่เขียน · เคสจริงเกิดยาก (speed>0 ก็เขียนแล้ว) · ถ้าเจอจริงค่อยเก็บพิกัด track ล่าสุดเพิ่มใน gps_live
- **budget level 'warn' ยังไม่มีช่องทางแจ้งเตือน** (ติดมากับ response ของ ingest เท่านั้น) — ช่องทางแจ้ง (อีเมล/อื่นๆ) รอเคาะพร้อมตอนต่อ Cartrack จริง
- `POST /api/fleet/ingest` มีด่าน `INGEST_TOKEN` แล้ว (ว่าง = โหมดทดลองไม่ตรวจ) — **ก่อนใช้จริงต้องตั้งเสมอ**
- `GET /api/fleet/mapconfig` บอกหน้าเว็บว่า env เลือก provider อะไร — แก้ `MAP_PROVIDER` ตัวเดียวหน้าแผนที่รู้ทันที (adapter ที่วาดได้จริงตอนนี้มีแค่ leaflet · ตัวอื่น fallback พร้อมแจ้งบนแบนเนอร์)

## 🔧 บั๊กที่แก้จากรีวิว adversarial (28 ส.ค. 2569 · เทส 95 → 132 เคส)
ทุกข้อ**พิสูจน์ด้วยการรันจริงก่อนแก้** และมีเทสล็อกกันย้อนกลับ:

| # | บั๊ก | ถ้าไม่แก้จะเป็นยังไง |
|---|---|---|
| 1 | `selectTrackOlderThan`/`deleteTrackOlderThan` รับ cutoff เป็นข้อความได้ | **อันตรายสุดในรอบนี้** — SQLite จัดลำดับ INTEGER มาก่อน TEXT เสมอ → `WHERE ts < 'abc'` เป็นจริง**ทุกแถว** = archive กวาด `gps_track` ทั้งตารางไปลบ · memory เดิมได้ 0 แถวเลยซ่อนบั๊กไว้ → ตอนนี้ throw ทั้ง 2 ฝั่ง |
| 2 | `countTrackWritesOn` ใช้ `WHERE date(ts/1000,'unixepoch') = ?` | ฟังก์ชันคร่อมคอลัมน์ = ใช้ index ไม่ได้ ต้องสแกนทั้งตาราง**ทุกปิง** (60 วัน ≈ 5 ล้านแถว) · D1 free อ่านได้ 5,000,000 แถว/วัน → **ปิงเดียวกินโควตาอ่านเกือบหมดวัน** → เปลี่ยนเป็นช่วง `ts >= ? AND ts < ?` + index `idx_track_ts` (migration 0002) |
| 3 | ปิงพิกัด NaN ไม่เขียน track (ถูก) แต่ยัง `upsertLive` (ผิด) | หมุดเพี้ยนบนแผนที่แบบเงียบๆ → `validatePing` ปฏิเสธทั้งก้อน ไม่เขียนอะไรลงฐานเลย |
| 4 | `MOVE_THRESHOLD_M` ติดลบ | ระยะทาง > ค่าติดลบ **เสมอ** = เขียน track ทุกปิง → **ทะลุเพดาน D1 ทั้งที่ mitigation 3 ข้อมีไว้กันเรื่องนี้** → `safeThreshold` clamp เป็น 0 · ค่าว่าง/NaN → 20 |
| 5 | memory repo เก็บ object ทั้งดุ้น | คีย์แปลกปลอมติดไปด้วย · คีย์ที่ขาดหายไปเลย — แต่ D1 จริงคืนคอลัมน์ครบเสมอ (ที่ไม่ใส่ = null) → **เทสผ่านแต่ของจริงพัง** → บังคับรูปแถวให้เหมือน D1 |
| 6 | `active: true` ใน memory vs `1` ใน SQLite | `listVehicles` กรองไม่ตรงกันระหว่าง 2 โหมด |
| 8 | **archive ลบด้วย cutoff แทนที่จะลบตาม id ที่อัปไปจริง** | **ข้อมูลหายถาวร** — R2 ใช้เวลาเป็นวินาที ระหว่างนั้นปิงเก่าแทรกเข้ามาได้ (คนขับอยู่ที่อับสัญญาณ เครื่องเก็บไว้ส่งย้อนหลัง = GPS ทำแบบนี้เป็นปกติ) → แถวที่เพิ่งแทรกถูกลบทั้งที่ไม่เคยถูกอัป · แก้เป็น `deleteTrackByIds()` ลบเฉพาะที่อัปสำเร็จ |
| 7 | `dayOfTs` โยน RangeError เมื่อ ts เพี้ยน | แถวเสียแถวเดียวทำให้ `countTrackWritesOn` ตายตลอดกาล = **ด่านกันเพดานตายเงียบ** → คืน null แทน |

## กติกา (ห้ามฝ่าฝืน)
- **ห้ามแตะ production** — โปรเจกต์นี้แยกขาดจากระบบใบงาน (`index.html` + Apps Script) · ห้าม deploy จนกว่าเจ้าของสั่ง
- **`MAP_SERVER_KEY` ห้ามอยู่ฝั่ง client เด็ดขาด** — ใช้ใน Worker เท่านั้น · key ทุกตัวอยู่ `.dev.vars` (ไม่ commit) · ในโค้ดมีแต่ placeholder ว่าง
- **stub ต้องซื่อสัตย์** — ยังไม่ implement = `{ ok:false, reason:'not-implemented' }` ห้ามแกล้งตอบสำเร็จ · mock ต้องติดป้าย `mock:true` ให้ผู้ใช้เห็น
- **logic ที่ต้องเทสได้ ห้ามเรียก `Date.now()`/`new Date()` เอง** — รับ timestamp เป็นพารามิเตอร์ (ชั้นนอกอย่าง demo-server/worker ค่อยส่งเวลาจริงเข้าไป)
- เทสเป็น plain Node ไม่มี npm dependency · แก้อะไรแล้วรัน `node tests/run.js` ให้เขียวก่อนเสมอ

## โครงไฟล์
- `src/db/schema.sql` + `src/db/migrations/0001_init.sql` — 5 ตาราง (vehicles · gps_live · gps_track · job_assignment · trip_daily)
- `src/db/repo.js` — ชั้นเข้าถึงข้อมูล 2 ตัว interface เหมือนกันเป๊ะ: `makeD1Repo(env.DB)` (SQL จริง) + `makeMemoryRepo()` (เทส/demo) — มีเทสเทียบ `Object.keys` กันไว้ (บทเรียนโปรเจกต์แม่: stub หลวมกว่าของจริง = เทสโกหก)
- `src/worker/haversine.js` · `src/worker/ingest.js` (movement filter + budget) · `src/worker/index.js` (routes)
- `src/map/provider.js` + `src/map/adapters/` (leaflet ใช้จริง · longdo/google/mapbox = stub ซื่อสัตย์)
- `src/mock/feed.js` — GPS mock deterministic 4 คัน วิ่งแหลมฉบัง → บางนา → ลาดกระบัง ICD
- `src/archive/r2Archive.js` · `src/public/map.html` · `demo-server.js` · `tests/run.js`
