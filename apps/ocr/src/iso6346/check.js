// ตรวจเบอร์ตู้คอนเทนเนอร์ตามมาตรฐาน ISO 6346 (เช็คดิจิต)
// รูปแบบ: ตัวอักษร 4 ตัว (ตัวที่ 4 มักเป็น U) + เลข 6 หลัก + เช็คดิจิต 1 หลัก เช่น CSQU3054383
// ⚠️ ห้ามใช้เวลาปัจจุบัน (Date.now) ในไฟล์นี้ — logic ล้วน เทสได้ 100%

// ตารางค่าตัวอักษรตามมาตรฐาน — ข้ามพหุคูณของ 11 (ไม่มีค่า 11, 22, 33) ห้ามคิดเอง/ห้ามแก้
const LETTER_VALUES = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38
};

// ตัดช่องว่าง/ขีดคั่นออก แล้วแปลงเป็นตัวพิมพ์ใหญ่ เช่น "csqu 305438-3" → "CSQU3054383"
export function normalize(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[\s\-]+/g, '').toUpperCase();
}

// ตรวจรูปแบบ: ตัวอักษร A-Z 4 ตัว + ตัวเลข 7 หลัก
// ตัวที่ 4 ตามมาตรฐานคือ U (ตู้สินค้า) / J (อุปกรณ์ติดตู้) / Z (หางลาก)
// ถ้าไม่ใช่ 3 ตัวนี้ ให้ "ผ่าน format" แต่แนบ warning ไว้ (OCR อาจอ่านผิด หรือเป็นรหัสนอกมาตรฐาน)
export function isValidFormat(s) {
  const warnings = [];
  if (typeof s !== 'string' || !/^[A-Z]{4}[0-9]{7}$/.test(s)) {
    return { ok: false, warnings };
  }
  if (!'UJZ'.includes(s[3])) {
    warnings.push('ตัวอักษรตัวที่ 4 ไม่ใช่ U/J/Z — ตรวจกับรูปอีกครั้ง');
  }
  return { ok: true, warnings };
}

// ค่าของอักขระ 1 ตัว (ตัวเลข = ค่าตัวเอง · ตัวอักษร = ตามตารางด้านบน)
export function charValue(ch) {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  const v = LETTER_VALUES[ch];
  if (v === undefined) throw new Error('อักขระนอกตาราง ISO 6346: ' + ch);
  return v;
}

// คำนวณเช็คดิจิตจาก 10 ตัวแรก: ตำแหน่ง i=0..9 คูณน้ำหนัก 2^i → รวม → mod 11 → ได้ 10 ให้ใช้ 0
export function computeCheckDigit(first10) {
  if (typeof first10 !== 'string' || !/^[A-Z]{4}[0-9]{6}$/.test(first10)) {
    throw new Error('ต้องส่ง 10 ตัวแรก (อักษร 4 + เลข 6) เช่น "CSQU305438"');
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += charValue(first10[i]) * Math.pow(2, i);
  }
  const m = sum % 11;
  return m === 10 ? 0 : m;
}

// ตรวจเบอร์ตู้เต็มรูป: คืน { ok, normalized, expected, got, warnings, reason }
export function validate(input) {
  const normalized = normalize(input);
  const fmt = isValidFormat(normalized);
  if (!fmt.ok) {
    return { ok: false, normalized, expected: null, got: null, warnings: fmt.warnings, reason: 'bad-format' };
  }
  const expected = computeCheckDigit(normalized.slice(0, 10));
  const got = Number(normalized[10]);
  const ok = expected === got;
  return { ok, normalized, expected, got, warnings: fmt.warnings, reason: ok ? null : 'check-digit-mismatch' };
}
