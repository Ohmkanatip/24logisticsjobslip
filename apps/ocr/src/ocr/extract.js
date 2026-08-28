// ดึงเบอร์ตู้ที่เป็นไปได้ออกจากข้อความดิบที่ OCR อ่านมา
// ยอมให้มีช่องว่าง/ขีดคั่นระหว่างกลุ่ม เช่น "MSKU 123456 7" หรือ "MSKU-123456-7"
import { normalize, isValidFormat } from '../iso6346/check.js';

// อักษร 4 ตัวติดกัน + เลข 7 หลัก (คั่นด้วยช่องว่าง/ขีดได้) · กันเลขยาวเกินด้วย lookaround
const RX = /(?<![A-Z0-9])[A-Z]{4}[\s\-]*(?:[0-9][\s\-]*){6}[0-9](?![A-Z0-9])/g; // ขอบหลังกันทั้งเลขและตัวอักษร (เท่าขอบหน้า)

// "เกือบใช่" — 4 ตัวแรกเป็นตัวอักษร**หรือเลข** + เลข 7 หลัก
// ⚠️ ทำไมต้องมี (พิสูจน์จากหน้าลองเล่นจริง 28 ส.ค. 2569):
//    OCR ผิดบ่อยที่สุดคือสับสน "ตัวอักษร ↔ ตัวเลขหน้าตาคล้ายกัน" ในกลุ่ม 4 ตัวแรก (S↔5 · O↔0 · B↔8 · I↔1)
//    เช่นเบอร์จริง CSQU3054383 ถูกอ่านเป็น C5QU3054383
//    RX ตัวบนรับเฉพาะ [A-Z]{4} → หาไม่เจอเลย → บอทตอบ "หาเบอร์ตู้ไม่เจอ" → **suggestRepairs ไม่เคยถูกเรียกใช้**
//    = ฟีเจอร์เสนอตัวซ่อมตายสนิทในเส้นทางจริง ทั้งที่ตัวมันเองซ่อมได้ (ผู้ตรวจอิสระทักไว้ถูกแล้ว)
const RX_NEAR = /(?<![A-Z0-9])[A-Z0-9]{4}[\s\-]*(?:[0-9][\s\-]*){6}[0-9](?![A-Z0-9])/g;

// คืนเฉพาะตัวที่ "ไม่ใช่รูปแบบถูกต้อง แต่ใกล้เคียงพอจะลองซ่อม" — ตัวที่ถูกต้องอยู่แล้วไปทาง extractCandidates
export function extractNearMisses(rawText) {
  if (typeof rawText !== 'string') return [];
  const matches = rawText.toUpperCase().match(RX_NEAR) || [];
  const out = [], seen = new Set();
  for (const raw of matches) {
    const n = normalize(raw);
    if (n.length !== 11) continue;
    if (isValidFormat(n).ok) continue;              // รูปแบบถูกอยู่แล้ว = ไม่ใช่ near-miss
    if (!/^[A-Z0-9]{4}[0-9]{7}$/.test(n)) continue; // ต้องเป็น 4+7 จริงๆ ไม่ใช่ขยะ
    if (!/[A-Z]/.test(n.slice(0, 4))) continue;     // เลขล้วน 11 หลัก = ไม่ใช่เบอร์ตู้ที่อ่านเพี้ยน (เช่นเลขตู้คอนเทนเนอร์ปลอม/เลขอื่นในรูป)
    if (seen.has(n)) continue;
    seen.add(n); out.push(n);
  }
  return out;
}

// คืน list เบอร์ที่ normalize แล้ว ผ่าน format แล้ว ไม่ซ้ำ (ยังไม่ได้ตรวจเช็คดิจิต — ไปตรวจต่อที่ validate)
export function extractCandidates(rawText) {
  if (typeof rawText !== 'string') return [];
  const matches = rawText.toUpperCase().match(RX) || [];
  const out = [];
  const seen = new Set();
  for (const raw of matches) {
    const n = normalize(raw);
    if (!isValidFormat(n).ok) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
