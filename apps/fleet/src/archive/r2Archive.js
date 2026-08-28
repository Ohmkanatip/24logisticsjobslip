// สำรอง gps_track ที่เก่ากว่า cutoff ขึ้น R2 แล้วลบออกจาก D1 (cadence: cron รายวัน · cutoff = ตอนนี้ − 60 วัน)
// pure ต่อเวลา: cutoffTs มาจากคนเรียก — ไฟล์นี้ไม่แตะ Date.now()
// r2 เป็น object ฉีดเข้ามา (interface ขั้นต่ำ: put(key, bytes)) — เทสใช้ memory r2 ได้

export const CSV_HEADER = 'id,vehicle_id,lat,lng,ts';

// gzip ข้อความ → Uint8Array
// บน Cloudflare Worker ใช้ CompressionStream (มีในตัว) · ถ้าไม่มี (Node เก่า) ถอยไปใช้ node:zlib
async function gzipText(text) {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.gzipSync(text));
}

// แถว track → CSV (ค่าเป็นตัวเลข/ทะเบียนรถ ไม่มี comma ในตัว — ไม่ต้อง escape ซับซ้อน)
function toCsv(rows) {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push([r.id, r.vehicle_id, r.lat, r.lng, r.ts].join(','));
  }
  return lines.join('\n') + '\n';
}

// key บน R2 แยกตามเดือน (UTC) + ประทับ cutoff ของรอบรัน เช่น gps_track/2026-06/run-1750000000000.csv.gz
// ⚠️ ทำไมต้องมี run-<cutoffTs>: ถ้า key เป็นแค่รายเดือน การรันรอบถัดไปที่แตะเดือนเดิม
//    จะ put ทับไฟล์เก่า — แต่แถวรอบก่อน "ถูกลบจาก D1 ไปแล้ว" = ข้อมูลหายถาวร
//    (ตัวตรวจอิสระเจอ 28 ส.ค. 2569) · key ไม่ซ้ำต่อรอบ = archive เป็นแบบสะสม ไม่มีทางทับกันเอง
function monthKeyOf(ts, cutoffTs) {
  return `gps_track/${new Date(ts).toISOString().slice(0, 7)}/run-${cutoffTs}.csv.gz`;
}

// เลือกแถวเก่ากว่า cutoff → CSV แยกเดือน → gzip → r2.put → ลบจาก repo
// ลำดับสำคัญ: put ขึ้น R2 "ครบทุกก้อน" สำเร็จก่อน แล้วค่อยลบ — ถ้า put พังกลางทาง ข้อมูลใน D1 ยังอยู่ครบ
export async function archiveOldTracks(repo, r2, cutoffTs) {
  const rows = await repo.selectTrackOlderThan(cutoffTs);
  if (rows.length === 0) {
    return { ok: true, archived: 0, keys: [] };
  }

  // จัดกลุ่มตามเดือน
  const byMonth = new Map();
  for (const r of rows) {
    const key = monthKeyOf(r.ts, cutoffTs);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(r);
  }

  // อัปขึ้น R2 ทีละเดือน
  const keys = [];
  for (const [key, monthRows] of byMonth) {
    const bytes = await gzipText(toCsv(monthRows));
    await r2.put(key, bytes);
    keys.push(key);
  }

  // อัปครบแล้วค่อยลบ — **ลบเฉพาะ id ที่อยู่ในไฟล์ที่อัปขึ้นไปจริง** ไม่ใช่เหมาลบตาม cutoff
  // ⚠️ ปิงเก่าที่แทรกเข้ามาระหว่างอัป จะไม่ถูกลบ — รอบสำรองรอบหน้าค่อยเก็บไป (ช้ากว่าแต่ไม่หาย)
  const ids = rows.map((r) => r.id).filter((id) => id !== undefined && id !== null);
  const deleted = await repo.deleteTrackByIds(ids);
  return { ok: true, archived: rows.length, deleted, keys };
}
