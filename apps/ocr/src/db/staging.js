// ชั้นเก็บ "ผลเบอร์ตู้ที่คนขับยืนยันแล้ว" — หัวใจของทางเลือก ③ ที่เจ้าของเคาะ (28 ส.ค. 2569):
// บอทไม่แตะชีทเลย · ผลพักไว้ที่นี่ (Cloudflare D1) · เว็บ jobslip เป็นฝ่าย "ดึงมาต่อ" เอง
// ข้อมูลเข้าชีทผ่านเส้นทางบันทึกเดิมของเว็บเท่านั้น — ระบบหลักเป็นเจ้าของข้อมูลเหมือนเดิม 100%
//
// มี 2 implementation interface เหมือนกันเป๊ะ (แพทเทิร์นเดียวกับ apps/fleet — มีเทสเทียบ Object.keys กันไว้):
//   makeMemoryStagingRepo()  — เทส/โหมด mock
//   makeD1StagingRepo(db)    — ของจริงบน D1 (SQL ตรงกับ schema.sql)
//
// สถานะของแถว: 'confirmed' (คนขับยืนยันแล้ว รอเว็บดึง) → 'pulled' (เว็บเอาไปใช้แล้ว — ไม่ลบแถว ไว้สาวย้อน)

export function makeMemoryStagingRepo() {
  const rows = [];
  let nextId = 1;
  return {
    // เพิ่มผลที่ยืนยันแล้ว — คืน id ของแถว
    async insertResult({ containerNo, confirmedBy, jobUid, driverId, ts }) {
      const row = {
        id: nextId++,
        container_no: containerNo,
        confirmed_by: confirmedBy || null,   // LINE userId ของคนขับ
        driver_id: driverId || null,         // driverId (D001…) ถ้าจับคู่ได้แล้ว
        job_uid: jobUid || null,             // uid ใบงาน/ร่าง ถ้ารู้ (เฟส LIFF จะรู้เสมอ)
        ts: ts || null,                      // เวลาที่ยืนยัน (มาจาก event.timestamp ของ LINE — ไม่แตะ Date.now ในชั้นนี้)
        status: 'confirmed',
        pulled_by: null,
        pulled_at: null,
      };
      rows.push(row);
      return { ok: true, id: row.id };
    },
    // รายการผลตามตัวกรอง — ค่าเริ่มต้นคืนเฉพาะที่ยังไม่ถูกดึง (status=confirmed)
    async listResults({ status = 'confirmed', driverId, jobUid } = {}) {
      // ⚠️ ต้องเรียง id มาก→น้อย ให้ตรงกับ D1 (ORDER BY id DESC) เป๊ะ
      //    เดิม memory คืนตามลำดับที่ใส่ (น้อย→มาก) — ตัวตรวจอิสระจับได้ว่า "interface เท่ากัน" แต่ผลลัพธ์ไม่เท่า
      return rows.filter((r) =>
        (status === 'all' || r.status === status) &&
        (!driverId || r.driver_id === driverId) &&
        (!jobUid || r.job_uid === jobUid)
      ).map((r) => ({ ...r })).sort((a, b) => b.id - a.id);
    },
    // เว็บเอาไปใช้แล้ว — ติดธง ไม่ลบแถว (หลักเดียวกับถังขยะ/ประวัติของระบบแม่: ของไม่หายเงียบ)
    async markPulled(id, pulledBy, ts) {
      const r = rows.find((x) => x.id === Number(id));
      if (!r) return { ok: false, reason: 'not-found' };
      if (r.status === 'pulled') return { ok: false, reason: 'already-pulled', pulledBy: r.pulled_by };
      r.status = 'pulled';
      r.pulled_by = pulledBy || null;
      r.pulled_at = ts || null;
      return { ok: true };
    },
  };
}

export function makeD1StagingRepo(db) {
  return {
    async insertResult({ containerNo, confirmedBy, jobUid, driverId, ts }) {
      const r = await db.prepare(
        `INSERT INTO ocr_results (container_no, confirmed_by, driver_id, job_uid, ts, status)
         VALUES (?, ?, ?, ?, ?, 'confirmed')`
      ).bind(containerNo, confirmedBy || null, driverId || null, jobUid || null, ts || null).run();
      // ⚠️ ต้องตรวจผลจริง — เดิมคืน ok:true เสมอ · D1 เขียนไม่สำเร็จแบบไม่ throw = คนขับเห็น "รับแล้ว" แต่ของไม่มีในฐาน
      if (r && r.success === false) return { ok: false, reason: 'd1-insert-failed' };
      const id = r && r.meta ? r.meta.last_row_id : null;
      if (id === null || id === undefined) return { ok: false, reason: 'd1-no-row-id' };
      return { ok: true, id };
    },
    async listResults({ status = 'confirmed', driverId, jobUid } = {}) {
      let sql = 'SELECT * FROM ocr_results WHERE 1=1';
      const args = [];
      if (status !== 'all') { sql += ' AND status = ?'; args.push(status); }
      if (driverId) { sql += ' AND driver_id = ?'; args.push(driverId); }
      if (jobUid) { sql += ' AND job_uid = ?'; args.push(jobUid); }
      sql += ' ORDER BY id DESC';
      const rs = await db.prepare(sql).bind(...args).all();
      return rs.results || [];
    },
    async markPulled(id, pulledBy, ts) {
      // ⚠️ ต้องเป็นคำสั่งเดียว (UPDATE ... WHERE status='confirmed') — เดิมเป็น SELECT แล้วค่อย UPDATE
      //    2 คำสั่งแยกกัน = มีช่องว่างให้คนที่ 2 แทรกกลาง แล้วดึงเบอร์เดียวกันไปใช้ 2 ใบ (ตัวตรวจอิสระจับได้)
      //    UPDATE เดียวจบ: ใครถึงก่อนได้ไป · คนหลัง changes = 0 แล้วค่อยไปดูว่าทำไม
      const upd = await db.prepare(
        `UPDATE ocr_results SET status = 'pulled', pulled_by = ?, pulled_at = ?
         WHERE id = ? AND status = 'confirmed'`
      ).bind(pulledBy || null, ts || null, Number(id)).run();
      const changed = upd && upd.meta ? upd.meta.changes : 0;
      if (changed > 0) return { ok: true };
      // ไม่ได้แถว = ไม่มี id นี้ หรือมีคนดึงไปแล้ว — ค่อยถามเพื่อบอกเหตุผลให้ถูก
      const row = await db.prepare('SELECT status, pulled_by FROM ocr_results WHERE id = ?').bind(Number(id)).first();
      if (!row) return { ok: false, reason: 'not-found' };
      return { ok: false, reason: 'already-pulled', pulledBy: row.pulled_by };
    },
  };
}
