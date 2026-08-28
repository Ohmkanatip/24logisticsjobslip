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
  // ── เช็คดิจิต ISO 6346 — หัวใจของทั้งระบบ (อ่านผิดแล้วเบอร์ตู้ผิดเข้าใบงาน) ──
  { name: 'ตารางค่าตัวอักษร: A = 10 → 11 (ค่าเดียวเพี้ยน ทั้งตารางเลื่อน)',
    file: 'src/iso6346/check.js', find: '  A: 10, B: 12,', replace: '  A: 11, B: 12,' },
  { name: 'น้ำหนักตำแหน่ง: 2^i → 2*i (สูตรผิดแบบที่คนมักเข้าใจผิด)',
    file: 'src/iso6346/check.js', find: 'sum += charValue(first10[i]) * Math.pow(2, i);', replace: 'sum += charValue(first10[i]) * 2 * i;' },
  { name: '⚠️ กฎ mod 11 ได้ 10 → ใช้ 0 (ถอดทิ้ง — เบอร์ที่ลงท้าย 0 ถูกปฏิเสธหมด)',
    file: 'src/iso6346/check.js', find: '  return m === 10 ? 0 : m;', replace: '  return m;' },
  { name: 'validate: ไม่เทียบเช็คดิจิต ตอบผ่านทุกเบอร์',
    file: 'src/iso6346/check.js', find: '  const ok = expected === got;', replace: '  const ok = true;' },
  { name: 'ตัดด่านตรวจรูปแบบทิ้ง (อะไรก็ผ่านเข้าไปคิดเช็คดิจิต)',
    file: 'src/iso6346/check.js', find: '  if (!fmt.ok) {', replace: '  if (false) {' },

  // ── ดึงเบอร์จากข้อความ OCR ──
  { name: 'regex: ตัดขอบหน้า (จับเบอร์ที่ต่อท้ายคำอื่นมั่ว)',
    file: 'src/ocr/extract.js', find: '/(?<![A-Z0-9])[A-Z]{4}', replace: '/[A-Z]{4}' },
  { name: 'regex: ตัดขอบหลัง (จับเบอร์ที่มีอักขระต่อท้าย)',
    file: 'src/ocr/extract.js',
    find: "const RX = /(?<![A-Z0-9])[A-Z]{4}[\\s\\-]*(?:[0-9][\\s\\-]*){6}[0-9](?![A-Z0-9])/g;",
    replace: "const RX = /(?<![A-Z0-9])[A-Z]{4}[\\s\\-]*(?:[0-9][\\s\\-]*){6}[0-9]/g;" },
  { name: 'near-miss: ยอมรับเลขล้วน (เลขอื่นในรูปถูกเสนอเป็นเบอร์ตู้)',
    file: 'src/ocr/extract.js',
    find: '    if (!/[A-Z]/.test(n.slice(0, 4))) continue;',
    replace: '    if (false) continue;' },

  // ── กู้เคสตัวอักษรถูกอ่านเป็นเลข ──
  { name: '⚠️ ถอดด่านกู้ near-miss (C5QU→CSQU ใช้ไม่ได้ = ตัวซ่อมตายสนิทอีกครั้ง)',
    file: 'src/line/webhook.js', find: '    if (!candidates.length) {', replace: '    if (false) {' },
  { name: 'near-miss: ยอมรับเบอร์ที่รูปแบบถูกอยู่แล้ว (เสนอซ้ำซ้อนมั่ว)',
    file: 'src/ocr/extract.js',
    find: '    if (isValidFormat(n).ok) continue;              // รูปแบบถูกอยู่แล้ว = ไม่ใช่ near-miss',
    replace: '    if (false) continue;' },

  // ── แก้ตามตำแหน่ง ISO ──
  { name: '⚠️ ถอดการชี้ขาดด้วยเช็คดิจิต (โยนทุกทางให้คนขับเลือกเอง รวมตัวผิด)',
    file: 'src/line/webhook.js',
    find: '          const good = byPos.candidates.filter((c) => validate(c).ok);',
    replace: '          const good = byPos.candidates;' },
  { name: 'positionCandidates: S ในโซนเลขเหลือทางเดียว (เคส 8 หาไม่เจอ)',
    file: 'src/iso6346/check.js',
    find: "  S: ['5', '8'], G: ['6', '9'], T: ['7'], B: ['8', '6'], E: ['8'], C: ['0'] };",
    replace: "  S: ['5'], G: ['6', '9'], T: ['7'], B: ['8', '6'], E: ['8'], C: ['0'] };" },

  // ── ด่านลายเซ็น LINE ──
  { name: '⚠️ verifySignature: ตอบผ่านทุกลายเซ็น (ใครก็ปลอม webhook ได้)',
    file: 'src/line/signature.js', find: '  return diff === 0;', replace: '  return true;' },
  { name: 'verifySignature: ยอมรับลายเซ็นว่าง',
    file: 'src/line/signature.js',
    find: "  if (!channelSecret || typeof bodyText !== 'string' || typeof signatureBase64 !== 'string' || !signatureBase64) {",
    replace: "  if (false) {" },

  // ── กติกาเหล็ก: เช็คดิจิตไม่ผ่าน ห้ามเขียนอะไรทั้งสิ้น ──
  { name: '⚠️ ถอดด่านเช็คดิจิตตอนคนขับกดยืนยัน (เบอร์ผิดไหลเข้าใบงาน)',
    file: 'src/line/webhook.js', find: '      if (!v.ok) {', replace: '      if (false) {' },

  // ── ตารางพักผล (staging) ──
  { name: '⚠️ markPulled: ถอด WHERE status=confirmed (2 คนดึงเบอร์เดียวไป 2 ใบได้)',
    file: 'src/db/staging.js',
    find: "         WHERE id = ? AND status = 'confirmed'`",
    replace: "         WHERE id = ?`" },
  { name: 'listResults: เรียงคนละทางกับ D1 (memory หลอกว่าเหมือนกัน)',
    file: 'src/db/staging.js', find: '.sort((a, b) => b.id - a.id);', replace: '.sort((a, b) => a.id - b.id);' },
  { name: 'insertResult: กลับไปตอบ ok:true เสมอ (D1 เขียนพลาดแต่บอกว่าสำเร็จ)',
    file: 'src/db/staging.js',
    find: "      if (r && r.success === false) return { ok: false, reason: 'd1-insert-failed' };",
    replace: '      if (false) return { ok: false };' },
  { name: 'memory markPulled: ยอมให้ดึงซ้ำ (เบอร์เดียวไป 2 ใบ)',
    file: 'src/db/staging.js',
    find: "      if (r.status === 'pulled') return { ok: false, reason: 'already-pulled', pulledBy: r.pulled_by };",
    replace: '      if (false) return { ok: false };' },

  // ── เลือก OCR engine ──
  { name: '⚠️ ชื่อ engine ผิด → ถอยมา mock เงียบๆ (คนขับได้เบอร์ตู้ปลอมทุกรูป)',
    file: 'src/ocr/engine.js',
    find: "      if (!env || !env.OCR_PROVIDER) {",
    replace: '      if (true) {' },

  // ── เพดานข้อความ LINE ──
  { name: '⚠️ ถอดการตัดข้อความยาว (เกิน 5,000 = LINE ไม่ส่ง คนขับเงียบสนิท)',
    file: 'src/line/client.js',
    find: "    if (typeof out.text === 'string' && out.text.length > LINE_TEXT_MAX) {",
    replace: '    if (false) {' },
  { name: 'ถอดการตัดปุ่ม quick reply (เกิน 13 ปุ่ม = LINE ปฏิเสธทั้งข้อความ)',
    file: 'src/line/client.js',
    find: '    if (out.quickReply && Array.isArray(out.quickReply.items) && out.quickReply.items.length > LINE_QUICKREPLY_MAX) {',
    replace: '    if (false) {' },

  // ── ด่านความปลอดภัยของ endpoint ที่เว็บ jobslip เรียก ──
  { name: '⚠️ ถอดด่าน PULL_TOKEN (ใครก็อ่าน/ติดธงผลเบอร์ตู้ได้)',
    file: 'src/worker/index.js', find: "  return (request.headers.get('authorization') || '') === 'Bearer ' + token;", replace: '  return true;' },
  { name: 'โหมดจริงลืมตั้ง PULL_TOKEN แล้วปล่อยผ่าน (ประตูเปิดโล่ง)',
    file: 'src/worker/index.js', find: "  if (!token) return isMockMode(env) ? true : 'missing-pull-token';", replace: '  if (!token) return true;' },
  { name: 'CORS: ปล่อยทุกโดเมนแม้ไม่ได้ตั้งค่า',
    file: 'src/worker/index.js', find: "  if (!origin) return {};", replace: "  if (!origin) return { 'access-control-allow-origin': '*' };" },
  { name: 'writeback: ค่าเริ่มต้นกลับไปเป็น mock (ยืนยันแล้วข้อมูลหายเงียบ)',
    file: 'src/worker/index.js', find: "  return ((env && env.WRITEBACK_PROVIDER) || 'd1').toLowerCase();", replace: "  return ((env && env.WRITEBACK_PROVIDER) || 'mock').toLowerCase();" },
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
