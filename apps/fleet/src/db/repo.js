// ชั้นเข้าถึงข้อมูล (repository) — มี 2 implementation ที่ interface ต้องเหมือนกันเป๊ะ:
//   makeD1Repo(db)     → SQL จริงบน Cloudflare D1 (prepare/bind)
//   makeMemoryRepo()   → in-memory สำหรับเทส/demo (โหมด mock)
// ⚠️ บทเรียนโปรเจกต์แม่: stub ที่หลวมกว่าของจริงทำให้เทสโกหก — tests/run.js มีด่านเทียบ Object.keys
//    ของสองตัวนี้กัน ถ้าเพิ่ม/ลบฟังก์ชันต้องแก้ทั้งคู่พร้อมกันเสมอ

// แปลง epoch millis → 'YYYY-MM-DD' (UTC) — ใช้เป็นกุญแจนับ write ต่อวัน
export function dayOfTs(ts) {
  return new Date(ts).toISOString().slice(0, 10);
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
    async countTrackWritesOn(day) {
      const rs = await db.prepare(
        `SELECT COUNT(*) AS n FROM gps_track WHERE date(ts / 1000, 'unixepoch') = ?`
      ).bind(day).first();
      return rs ? Number(rs.n) : 0;
    },

    // เลือกแถว track ที่เก่ากว่า cutoff (epoch millis) — ใช้ตอน archive ขึ้น R2
    async selectTrackOlderThan(cutoffTs) {
      const rs = await db.prepare(
        `SELECT id, vehicle_id, lat, lng, ts FROM gps_track WHERE ts < ? ORDER BY ts`
      ).bind(cutoffTs).all();
      return rs.results || [];
    },

    // ลบแถว track ที่เก่ากว่า cutoff — เรียกหลังอัปขึ้น R2 สำเร็จแล้วเท่านั้น
    async deleteTrackOlderThan(cutoffTs) {
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
  const vehicles = seedVehicles.map((v) => ({ active: 1, ...v }));
  const live = new Map();   // vehicle_id → แถวล่าสุด
  const track = [];         // ประวัติเส้นทาง
  let nextId = 1;

  return {
    async upsertLive(row) {
      live.set(row.vehicle_id, { ...row });
    },

    async insertTrack(row) {
      track.push({ id: nextId++, vehicle_id: row.vehicle_id, lat: row.lat, lng: row.lng, ts: row.ts });
    },

    async getLiveAll() {
      return [...live.values()].map((r) => ({ ...r }));
    },

    async countTrackWritesOn(day) {
      return track.filter((r) => dayOfTs(r.ts) === day).length;
    },

    async selectTrackOlderThan(cutoffTs) {
      return track.filter((r) => r.ts < cutoffTs).sort((a, b) => a.ts - b.ts).map((r) => ({ ...r }));
    },

    async deleteTrackOlderThan(cutoffTs) {
      const before = track.length;
      for (let i = track.length - 1; i >= 0; i--) {
        if (track[i].ts < cutoffTs) track.splice(i, 1);
      }
      return before - track.length;
    },

    async listVehicles() {
      return vehicles.filter((v) => v.active === 1).map((v) => ({ ...v }));
    },
  };
}
