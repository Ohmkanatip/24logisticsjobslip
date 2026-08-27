// ดึงเบอร์ตู้ที่เป็นไปได้ออกจากข้อความดิบที่ OCR อ่านมา
// ยอมให้มีช่องว่าง/ขีดคั่นระหว่างกลุ่ม เช่น "MSKU 123456 7" หรือ "MSKU-123456-7"
import { normalize, isValidFormat } from '../iso6346/check.js';

// อักษร 4 ตัวติดกัน + เลข 7 หลัก (คั่นด้วยช่องว่าง/ขีดได้) · กันเลขยาวเกินด้วย lookaround
const RX = /(?<![A-Z0-9])[A-Z]{4}[\s\-]*(?:[0-9][\s\-]*){6}[0-9](?![A-Z0-9])/g; // ขอบหลังกันทั้งเลขและตัวอักษร (เท่าขอบหน้า)

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
