// 🧬 Mutation test — พิสูจน์ว่า "เทสผ่าน" แปลว่าเทสดีจริง ไม่ใช่เทสหลอก
//
// ปัญหาที่เครื่องมือนี้แก้:
//   เทสที่เขียนไว้อาจเป็นเทสที่ไม่ว่าโค้ดจะผิดยังไงก็ผ่านหมด — เราจะไม่มีวันรู้เลยจนกว่าจะพัง
//   วิธีพิสูจน์: **แกล้งฝังบั๊กลงโค้ดจริง → รันเทส → เทสต้องตก** · ตกแปลว่าด่านทำงานจริง
//
// วิธีรัน: node tests/mutation.js   (หรือ npm run mutation)
//   ✅ ฆ่าได้ = เทสจับบั๊กที่ฝังได้        → ด่านนั้นเชื่อถือได้
//   🕳 SURVIVED = ฝังบั๊กแล้วเทสยังเขียว   → **เทสมีรู ต้องเพิ่มเทส**
//
// ความปลอดภัย: คืนไฟล์ต้นฉบับใน finally เสมอ (ต่อให้ throw กลางคัน) + ตรวจซ้ำท้ายสุดว่าทุกไฟล์กลับเป็นเดิม
// แล้วรันเทสปิดท้ายอีกรอบเพื่อพิสูจน์ว่าไม่มีบั๊กค้างในโค้ด

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (f) => join(ROOT, f);

// ── รายการบั๊กที่จะแกล้งฝัง — เลือกเฉพาะ "หัวใจของความถูกต้อง" ──
// find ต้องเจอ 1 ที่พอดี ไม่งั้นถือว่า mutation เสีย (MUTATION-BROKEN) ต้องมาแก้รายการนี้
const MUTATIONS = [
  // ── สูตรระยะทาง ──
  { name: 'haversine: ลืมคูณ 2 (ระยะทางเหลือครึ่งเดียว)',
    file: 'src/worker/haversine.js',
    find: 'return 2 * EARTH_R_M * Math.asin(Math.sqrt(a));',
    replace: 'return EARTH_R_M * Math.asin(Math.sqrt(a));' },

  // ── กลไกกันเพดานเขียน D1 (mitigation ทั้ง 3 ข้อ) ──
  { name: 'เพดานเขียน: เปลี่ยน 100,000 เป็น 1,000,000 (เพดานพัง)',
    file: 'src/worker/ingest.js', find: 'export const WRITE_OVER = 100000;', replace: 'export const WRITE_OVER = 1000000;' },
  { name: 'เพดานเขียน: >= กลายเป็น > (แตะพอดีเป๊ะไม่ถูกจับ)',
    file: 'src/worker/ingest.js', find: 'if (n >= WRITE_OVER)', replace: 'if (n > WRITE_OVER)' },
  { name: 'เตือนใกล้เต็ม: 90,000 → 99,999 (เตือนช้าเกินจนไม่ทัน)',
    file: 'src/worker/ingest.js', find: 'export const WRITE_WARN = 90000;', replace: 'export const WRITE_WARN = 99999;' },
  { name: 'movement filter: > กลายเป็น >= (เขียนเพิ่มโดยไม่จำเป็น)',
    file: 'src/worker/ingest.js', find: 'if (distM > th)', replace: 'if (distM >= th)' },
  { name: 'movement filter: ตัดด่านความเร็วทิ้ง (รถวิ่งอยู่แต่ไม่บันทึก)',
    file: 'src/worker/ingest.js',
    find: "if (Number(ping.speed_kmh) > 0) return { write: true, reason: 'speed' };",
    replace: "if (false) return { write: true, reason: 'speed' };" },
  { name: 'threshold ติดลบ: ถอด clamp (กลับไปเขียนทุกปิงจนทะลุเพดาน)',
    file: 'src/worker/ingest.js', find: 'return n < 0 ? 0 : n;', replace: 'return n;' },

  // ── ด่านตรวจปิงเสีย ──
  { name: 'validatePing: ถอดด่าน lat นอกช่วง (พิกัดมั่วเข้าฐานได้)',
    file: 'src/worker/ingest.js',
    find: "if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, reason: 'bad-lat' };",
    replace: "if (!Number.isFinite(lat)) return { ok: false, reason: 'bad-lat' };" },
  { name: 'validatePing: ยอมรับ ts = 0 (วันที่ไม่ถูกต้องเข้าฐาน)',
    file: 'src/worker/ingest.js',
    find: "if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'bad-ts' };",
    replace: "if (!Number.isFinite(ts)) return { ok: false, reason: 'bad-ts' };" },
  { name: 'validatePing: ถอดด่านทะเบียนรถว่าง',
    file: 'src/worker/ingest.js',
    find: "if (typeof id !== 'string' || !id.trim()) return { ok: false, reason: 'bad-vehicle-id' };",
    replace: "if (false) return { ok: false, reason: 'bad-vehicle-id' };" },

  // ── ด่านกันลบข้อมูลทั้งตาราง (บั๊กร้ายแรงที่สุดที่เจอ 28 ส.ค.) ──
  { name: '⚠️ ถอดด่าน assertCutoff (cutoff เป็นข้อความ = D1 กวาดทั้งตารางไปลบ)',
    file: 'src/db/repo.js',
    find: "    throw new Error('cutoffTs ต้องเป็น epoch millis (ตัวเลข) — ได้ ' + JSON.stringify(cutoffTs));",
    replace: '    return;' },
  { name: 'countTrackWritesOn: นับแถวที่ ts เพี้ยนด้วย (ตัวเลขไม่ตรงกับ D1)',
    file: 'src/db/repo.js',
    find: "      return track.filter((r) => typeof r.ts === 'number' && Number.isFinite(r.ts)\n        && r.ts >= range.startMs && r.ts < range.endMs).length;",
    replace: '      return track.filter((r) => r.ts >= range.startMs && r.ts < range.endMs).length;' },
  { name: 'dayRangeMs: ยอมรับรูปแบบวันที่มั่ว (นับ write ผิดวัน)',
    file: 'src/db/repo.js',
    find: "  if (typeof day !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) return null;",
    replace: "  if (typeof day !== 'string') return null;" },

  // ── ลำดับ archive: ต้อง put ขึ้น R2 ให้ครบก่อนค่อยลบ ──
  { name: '⚠️ archive: กลืน error ของ R2 (อัปไม่ขึ้นแต่ลบข้อมูลทิ้ง = หายถาวร)',
    file: 'src/archive/r2Archive.js',
    find: '    await r2.put(key, bytes);',
    replace: '    try { await r2.put(key, bytes); } catch (e) {}' },
  { name: 'archive: key ไม่มี run-<cutoff> (รอบใหม่ทับไฟล์เก่า = ข้อมูลหาย)',
    file: 'src/archive/r2Archive.js',
    find: "  return `gps_track/${new Date(ts).toISOString().slice(0, 7)}/run-${cutoffTs}.csv.gz`;",
    replace: "  return `gps_track/${new Date(ts).toISOString().slice(0, 7)}.csv.gz`;" },

  // ── mock feed: เวลาเพี้ยน ──
  { name: 'safeDt: ถอด clamp (เวลาเพี้ยนครั้งเดียว = พิกัดรถ NaN ถาวร)',
    file: 'src/mock/feed.js',
    find: '  if (!Number.isFinite(n) || n <= 0) return 0;',
    replace: '  if (false) return 0;' },
  { name: 'safeDt: ไม่ตัดค่ามหาศาล (เครื่อง sleep แล้วตื่น = รถกระโดดข้ามประเทศ)',
    file: 'src/mock/feed.js',
    find: '  return n > maxSec ? maxSec : n;',
    replace: '  return n;' },

  // ── ด่านความปลอดภัย ──
  { name: '⚠️ ถอดด่าน INGEST_TOKEN (ใครก็ยิงปิงปลอมเข้าฐานได้)',
    file: 'src/worker/api.js',
    find: "  return h === 'Bearer ' + env.INGEST_TOKEN;",
    replace: '  return true;' },
  { name: 'mapconfig: ปล่อย MAP_SERVER_KEY ออกฝั่ง client (คีย์ลับรั่ว)',
    file: 'src/worker/api.js',
    find: '    client: p.clientConfig ? p.clientConfig(env) : null,',
    replace: '    client: Object.assign({}, p.clientConfig ? p.clientConfig(env) : null, { serverKey: env.MAP_SERVER_KEY }),' },
  { name: 'chooseProvider: ไม่ fallback เมื่อไม่มี key (แผนที่ขึ้นไม่ได้เงียบๆ)',
    file: 'src/map/provider.js',
    find: '  if (adapter.needsKey && !env.MAP_API_KEY) return leaflet;',
    replace: '  if (false) return leaflet;' },
];

// ── ตัวรัน ──
function runTests() {
  const r = spawnSync(process.execPath, [join(ROOT, 'tests', 'run.js')], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

let killed = 0, survived = 0, broken = 0;
const problems = [];

console.log('🧬 Mutation test — แกล้งฝังบั๊ก ' + MUTATIONS.length + ' ตัว แล้วดูว่าเทสจับได้ไหม\n');

// เก็บต้นฉบับของทุกไฟล์ที่เกี่ยวข้องไว้ตั้งแต่ต้น — ใช้ตรวจซ้ำท้ายสุด
const originals = new Map();
for (const m of MUTATIONS) {
  if (!originals.has(m.file)) originals.set(m.file, readFileSync(abs(m.file), 'utf8'));
}

for (const m of MUTATIONS) {
  const path = abs(m.file);
  const before = readFileSync(path, 'utf8');
  const hits = before.split(m.find).length - 1;

  if (hits !== 1) {
    broken++;
    problems.push('MUTATION-BROKEN: "' + m.name + '" — หา find เจอ ' + hits + ' ที่ (ต้องเจอ 1 ที่พอดี)');
    console.log('⚠️  MUTATION-BROKEN  ' + m.name + ' (เจอ ' + hits + ' ที่)');
    continue;
  }

  try {
    writeFileSync(path, before.replace(m.find, m.replace), 'utf8');
    const { code } = runTests();
    if (code !== 0) {
      killed++;
      console.log('✅ ฆ่าได้        ' + m.name);
    } else {
      survived++;
      problems.push('🕳 SURVIVED: "' + m.name + '" (' + m.file + ') — ฝังบั๊กแล้วเทสยังเขียว = เทสมีรู');
      console.log('🕳 SURVIVED     ' + m.name + '  ← เทสมีรู ต้องเพิ่มเทส');
    }
  } finally {
    writeFileSync(path, before, 'utf8');   // คืนต้นฉบับเสมอ ต่อให้พังกลางคัน
  }
}

// ── ตรวจซ้ำว่าทุกไฟล์กลับเป็นต้นฉบับจริง ──
console.log('\n── ตรวจว่าคืนโค้ดครบ ──');
let dirty = 0;
for (const [file, orig] of originals) {
  if (readFileSync(abs(file), 'utf8') !== orig) {
    dirty++;
    console.log('❌ ' + file + ' ไม่กลับเป็นต้นฉบับ!');
  }
}
if (dirty === 0) console.log('✅ ทุกไฟล์กลับเป็นต้นฉบับครบ');

// ── รันเทสปิดท้าย: พิสูจน์ว่าไม่มีบั๊กค้าง ──
const final = runTests();
const finalOk = final.code === 0;
console.log(finalOk ? '✅ เทสหลังคืนโค้ด: เขียว' : '❌ เทสหลังคืนโค้ด: ตก — มีบั๊กค้างในโค้ด!');

console.log('\n══════════════════════════════');
console.log('mutation: ฆ่าได้ ' + killed + '/' + MUTATIONS.length +
  (survived ? ' · 🕳 รอด ' + survived : '') + (broken ? ' · ⚠️ เสีย ' + broken : ''));
if (problems.length) {
  console.log('\nต้องแก้:');
  for (const p of problems) console.log('  - ' + p);
}

const pass = survived === 0 && broken === 0 && dirty === 0 && finalOk;
process.exit(pass ? 0 : 1);
