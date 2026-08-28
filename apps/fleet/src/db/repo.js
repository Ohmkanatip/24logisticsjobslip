// ชั้นเข้าถึงข้อมูล (repository) — มี 2 implementation ที่ interface ต้องเหมือนกันเป๊ะ:
//   makeD1Repo(db)     → SQL จริงบน Cloudflare D1 (prepare/bind)
//   makeMemoryRepo()   → in-memory สำหรับเทส/demo (โหมด mock)
// ⚠️ บทเรียนโปรเจกต์แม่: stub ที่หลวมกว่าของจริงทำให้เทสโกหก — tests/run.js มีด่านเทียบ Object.keys
//    ของสองตัวนี้กัน ถ้าเพิ่ม/ลบฟังก์ชันต้องแก้ทั้งคู่พร้อมกันเสมอ

// แปลง epoch millis → 'YYYY-MM-DD' (UTC) — ใช้เป็นกุญแจนับ write ต่อวัน
// ⚠️ เดิมเขียน new Date(ts).toISOString() ตรงๆ → ts พัง (NaN/undefined/สตริง/เกินช่วง Date)
//    โยน RangeError: Invalid time value ทำให้ processPing และ countTrackWritesOn ตายยกคำขอ
//    และแถวเสียแถวเดียวใน gps_track ทำให้นับ write ไม่ได้อีกเลย = ด่านกันเพดาน D1 ตายเงียบ
//    ตอนนี้: ts ที่ใช้ไม่ได้ → คืน null (คนเรียกเป็นคนตัดสินใจ) ไม่โยน error
export function dayOfTs(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null; // สตริง/null/undefined/NaN/Infinity = ใช้ไม่ได้
  if (Math.abs(ts) > 8.64e15) return null;                         // เกินช่วงที่ Date รองรับ
  return new Date(ts).toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' (UTC) → ช่วงเวลา [startMs, endMs) ของวันนั้น
// ใช้เขียน SQL แบบ "เทียบช่วง" แทน date(ts/1000,'unixepoch') = ? ซึ่งเอา index ไม่ได้ (ดู countTrackWritesOn)
export function dayRangeMs(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const startMs = Date.parse(day + 'T00:00:00.000Z');
  if (!Number.isFinite(startMs)) return null;
  return { startMs, endMs: startMs + 86400000 };
}

// ---------- ตัวปรับรูปแถวให้เหมือน D1 ----------
// ⚠️ บทเรียน stub โกหก (พิสูจน์แล้ว 28 ส.ค. 2569): memory repo เดิมเก็บ object ที่ส่งเข้ามาทั้งดุ้น
//    → คีย์แปลกปลอมที่ตาราง gps_live ไม่มี (เช่น job) ติดไปด้วย · คีย์ที่ขาดก็หายไปเลย
//    แต่ D1 จริงคืนคอลัมน์ครบทุกตัวเสมอ (ที่ไม่ได้ใส่ = null) → เทสผ่านแต่ของจริงพัง
const nul = (v) => (v === undefined ? null : v);

// คอลัมน์จริงของ gps_live เท่านั้น
function liveRowShape(row = {}) {
  return {
    vehicle_id: nul(row.vehicle_id),
    lat: nul(row.lat),
    lng: nul(row.lng),
    speed_kmh: nul(row.speed_kmh),
    heading: nul(row.heading),
    updated_at: nul(row.updated_at),
  };
}

// คอลัมน์จริงของ gps_track เท่านั้น (id เติมโดยคนเรียก)
function trackRowShape(row = {}) {
  return { vehicle_id: nul(row.vehicle_id), lat: nul(row.lat), lng: nul(row.lng), ts: nul(row.ts) };
}

// SQLite เก็บ boolean เป็น 0/1 — memory ต้องแปลงเหมือนกัน ไม่งั้น active:true ถูกกรองทิ้งข้างเดียว
function activeFlag(v) {
  if (v === undefined || v === null) return 1; // DEFAULT 1 ตาม schema
  return v === true || v === 1 ? 1 : 0;
}

// cutoff ของ archive ต้องเป็น epoch millis จริงเท่านั้น
// ⚠️ อันตรายจริงถ้าปล่อยผ่าน: SQLite จัดลำดับ INTEGER มาก่อน TEXT เสมอ → `WHERE ts < 'abc'` เป็นจริงทุกแถว
//    = archiveOldTracks(repo, r2, 'abc') บน D1 จะกวาดทั้งตาราง gps_track ไปลบ (memory เดิมได้ 0 แถว = ซ่อนบั๊ก)
function assertCutoff(cutoffTs) {
  if (typeof cutoffTs !== 'number' || !Number.isFinite(cutoffTs)) {
    throw new Error('cutoffTs ต้องเป็น epoch millis (ตัวเลข) — ได้ ' + JSON.stringify(cutoffTs));
  }
}

// ---------- D1 (SQL จริง) ----------
export function makeD1Repo(db) {
  return {
    // UPSERT ตำแหน่งล่าสุด — 1 แถว/คันเสมอ (mitigation ข้อ 2 ของเพดานเขียน 100k/วัน)
    async upsertLive(row) {
      await db.prepare(
        `INSERT INTO gps_live (vehicle_id, lat, lng, speed_kmh, heading, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(vehicle_id) DO UPDATE SET
           lat = excluded.lat, lng = excluded.lng, speed_kmh = excluded.speed_kmh,
           heading = excluded.heading, updated_at = excluded.updated_at`
      ).bind(row.vehicle_id, row.lat, row.lng, row.speed_kmh, row.heading, row.updated_at).run();
    },

    // เพิ่มจุดลงประวัติเส้นทาง (คนเรียกต้องผ่าน movement filter ใน ingest.js มาก่อน)
    async insertTrack(row) {
      await db.prepare(
        `INSERT INTO gps_track (vehicle_id, lat, lng, ts) VALUES (?, ?, ?, ?)`
      ).bind(row.vehicle_id, row.lat, row.lng, row.ts).run();
    },

    // ตำแหน่งล่าสุดทุกคัน
    async getLiveAll() {
      const rs = await db.prepare(`SELECT * FROM gps_live`).all();
      return rs.results || [];
    },

    // นับจำนวนแถว track ที่เขียนในวันนั้น (day = 'YYYY-MM-DD' UTC) — ใช้คู่กับ checkWriteBudget
    // ⚠️ เดิมเขียน `WHERE date(ts / 1000, 'unixepoch') = ?` — ใส่ฟังก์ชันคร่อมคอลัมน์ = SQLite ใช้ index ไม่ได้
    //    ต้องสแกนทั้ง gps_track "ทุกปิง" (60 วัน × ~86k แถว ≈ 5 ล้านแถว/ครั้ง)
    //    D1 free อ่านได้ 5,000,000 แถว/วัน → แค่ปิงเดียวก็เกือบหมดโควตาอ่านทั้งวัน
    //    ตอนนี้เทียบเป็นช่วง ts (sargable) + มี index idx_track_ts (migration 0002) → อ่านเฉพาะแถวของวันนั้น
    async countTrackWritesOn(day) {
      const range = dayRangeMs(day);
      if (!range) throw new Error('countTrackWritesOn: day ต้องเป็น YYYY-MM-DD (UTC) — ได้ ' + String(day));
      const rs = await db.prepare(
        `SELECT COUNT(*) AS n FROM gps_track WHERE ts >= ? AND ts < ?`
      ).bind(range.startMs, range.endMs).first();
      return rs ? Number(rs.n) : 0;
    },

    // เลือกแถว track ที่เก่ากว่า cutoff (epoch millis) — ใช้ตอน archive ขึ้น R2
    async selectTrackOlderThan(cutoffTs) {
      assertCutoff(cutoffTs); // กัน cutoff เป็นข้อความแล้ว SQLite เลือกทั้งตาราง (ดูคอมเมนต์ที่ assertCutoff)
      const rs = await db.prepare(
        `SELECT id, vehicle_id, lat, lng, ts FROM gps_track WHERE ts < ? ORDER BY ts`
      ).bind(cutoffTs).all();
      return rs.results || [];
    },

    // ลบเฉพาะแถวที่ระบุ id — archive ใช้ตัวนี้ (ลบเฉพาะที่อัปขึ้น R2 สำเร็จจริงเท่านั้น)
    // ⚠️ ทำไมไม่ลบด้วย cutoff: ระหว่างอัปขึ้น R2 (ช้าเป็นวินาที) มีปิงเก่าแทรกเข้ามาได้
    //    (คนขับอยู่ที่อับสัญญาณ เครื่องเก็บไว้ส่งย้อนหลัง — GPS ทำแบบนี้เป็นปกติ)
    //    ลบด้วย cutoff = กวาดแถวที่เพิ่งแทรกไปด้วย ทั้งที่ยังไม่ถูกอัป = หายถาวร (พิสูจน์แล้ว 28 ส.ค. 2569)
    async deleteTrackByIds(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return 0;
      const CHUNK = 500;   // กันชนเพดานจำนวนตัวแปรต่อคำสั่งของ SQLite
      let n = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const marks = part.map(() => '?').join(',');
        const rs = await db.prepare('DELETE FROM gps_track WHERE id IN (' + marks + ')').bind(...part).run();
        n += (rs && rs.meta ? rs.meta.changes : 0) || 0;
      }
      return n;
    },

    // ลบแถว track ที่เก่ากว่า cutoff — เก็บไว้ใช้ล้างข้อมูลแบบเหมา (archive ไม่ใช้แล้ว)
    async deleteTrackOlderThan(cutoffTs) {
      assertCutoff(cutoffTs);
      const rs = await db.prepare(`DELETE FROM gps_track WHERE ts < ?`).bind(cutoffTs).run();
      return rs.meta ? rs.meta.changes : 0;
    },

    // รายชื่อรถทั้งหมด (เฉพาะที่ยัง active)
    async listVehicles() {
      const rs = await db.prepare(`SELECT * FROM vehicles WHERE active = 1`).all();
      return rs.results || [];
    },
  };
}

// ---------- in-memory (เทส/demo) ----------
// seedVehicles: [{id, driver_name, active}] — ใส่ตอนสร้าง ไม่มี method เพิ่มทีหลัง (กัน interface เพี้ยนจาก D1)
export function makeMemoryRepo(seedVehicles = []) {
  // active ต้องกลายเป็น 0/1 เหมือนที่ SQLite เก็บ (true → 1) ไม่งั้น listVehicles กรองไม่ตรงกับ D1
  const vehicles = (seedVehicles || []).map((v) => ({ ...v, active: activeFlag(v && v.active) }));
  const live = new Map();   // vehicle_id → แถวล่าสุด
  const track = [];         // ประวัติเส้นทาง
  let nextId = 1;

  return {
    async upsertLive(row) {
      const r = liveRowShape(row); // เก็บเฉพาะคอลัมน์จริง — คีย์แปลกปลอมไม่ติดไปเหมือนของเก่า
      live.set(r.vehicle_id, r);
    },

    async insertTrack(row) {
      track.push({ id: nextId++, ...trackRowShape(row) });
    },

    async getLiveAll() {
      return [...live.values()].map((r) => ({ ...r }));
    },

    // ⚠️ เดิมเรียก dayOfTs(r.ts) ตรงๆ — แถวที่ ts พังแถวเดียวทำให้ throw ทั้งฟังก์ชันตลอดกาล
    //    D1 จริงไม่พัง (แถวที่เทียบไม่ได้แค่ไม่ถูกนับ) → memory ต้องประพฤติเหมือนกัน
    async countTrackWritesOn(day) {
      const range = dayRangeMs(day);
      if (!range) throw new Error('countTrackWritesOn: day ต้องเป็น YYYY-MM-DD (UTC) — ได้ ' + String(day));
      return track.filter((r) => typeof r.ts === 'number' && Number.isFinite(r.ts)
        && r.ts >= range.startMs && r.ts < range.endMs).length;
    },

    // เทียบเฉพาะ ts ที่เป็นตัวเลขจริง — ตรงกับ SQLite ที่จัดลำดับ INTEGER มาก่อน TEXT เสมอ
    // (แถว ts เป็นข้อความจึงไม่มีวัน "เก่ากว่า" ตัวเลข ทั้งใน D1 และ memory เหมือนกัน)
    async selectTrackOlderThan(cutoffTs) {
      assertCutoff(cutoffTs);
      return track.filter((r) => Number.isFinite(r.ts) && r.ts < cutoffTs)
        .sort((a, b) => a.ts - b.ts).map((r) => ({ ...r }));
    },

    async deleteTrackByIds(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return 0;
      const want = new Set(ids);
      const before = track.length;
      for (let i = track.length - 1; i >= 0; i--) {
        if (want.has(track[i].id)) track.splice(i, 1);
      }
      return before - track.length;
    },

    async deleteTrackOlderThan(cutoffTs) {
      assertCutoff(cutoffTs);
      const before = track.length;
      for (let i = track.length - 1; i >= 0; i--) {
        if (Number.isFinite(track[i].ts) && track[i].ts < cutoffTs) track.splice(i, 1);
      }
      return before - track.length;
    },

    async listVehicles() {
      return vehicles.filter((v) => v.active === 1).map((v) => ({ ...v }));
    },
  };
}
