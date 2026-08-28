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

/* ══════════════════════════════════════════════════════════════════════════
   แก้เบอร์ตู้ตาม "ตำแหน่ง" — วิธีที่ตรงที่สุด (เจ้าของชี้ 28 ส.ค. 2569)

   ISO 6346 บังคับรูปแบบตายตัว:  ตัวอักษร 4 ตัว + ตัวเลข 7 ตัว
   → **ตำแหน่งบอกได้เลยว่าตัวนั้นต้องเป็นอะไร** ไม่ต้องเดา ไม่ต้องลองสลับทีละตัว
     ตำแหน่ง 0-3 เจอเลข  → ต้องเป็นตัวอักษรที่หน้าตาเหมือนเลขนั้น (5→S · 0→O · 1→I · 8→B …)
     ตำแหน่ง 4-10 เจอตัวอักษร → ต้องเป็นเลขที่หน้าตาเหมือนตัวอักษรนั้น (S→5 · O→0 · I→1 · B→8 …)

   ทำไมดีกว่าวิธีเดิม (ลองสลับทีละตัวแล้วเช็คดิจิต):
     ① แก้ได้ทีเดียวหลายตัว — เดิมผิด 2 ตัวก็จบเลย
     ② แก้ได้แม้ตัวเลขถูกอ่านเป็นตัวอักษร — เดิมหาไม่เจอตั้งแต่ต้นทาง
     ③ ไม่ต้องพึ่งเช็คดิจิตมาช่วยเดา — ใช้เช็คดิจิตเป็น "ตัวยืนยัน" อย่างเดียวตามหน้าที่จริงของมัน
   ══════════════════════════════════════════════════════════════════════════ */

// เลข → ตัวอักษรที่หน้าตาเหมือนกัน (ใช้กับ 4 ตัวแรกเท่านั้น) — เรียงตัวที่น่าจะใช่ที่สุดไว้หน้า
const TO_LETTER = { '0': ['O', 'D', 'Q'], '1': ['I', 'L'], '2': ['Z'], '4': ['A'],
  '5': ['S'], '6': ['G'], '7': ['T'], '8': ['B'], '9': ['G'] };
// ตัวอักษร → เลขที่หน้าตาเหมือนกัน (ใช้กับ 7 ตัวหลังเท่านั้น)
// ⚠️ บางตัวเหมือนได้หลายเลข: S เหมือนทั้ง 5 และ 8 · B เหมือนทั้ง 8 และ 6 · G เหมือนทั้ง 6 และ 9
//    จึงต้องลองหลายทาง แล้วให้ "เช็คดิจิต" เป็นตัวชี้ขาดว่าอันไหนถูก
const TO_DIGIT = { O: ['0'], D: ['0'], Q: ['0'], I: ['1'], L: ['1'], Z: ['2'], A: ['4'],
  S: ['5', '8'], G: ['6', '9'], T: ['7'], B: ['8', '6'], E: ['8'], C: ['0'] };

// คืน { ok, value, fixed:[{pos,from,to}] } — เอาตัวเลือกแรก (น่าจะใช่ที่สุด) ของแต่ละตำแหน่ง
// ok:false เมื่อมีตัวที่แปลงกลับไม่ได้ (เช่นเลข 3 ใน 4 ตัวแรก — ไม่มีตัวอักษรไหนหน้าตาเหมือน 3)
export function normalizeByPosition(input) {
  const all = positionCandidates(input);
  if (!all.ok) return all;
  return { ok: true, value: all.candidates[0], fixed: all.fixed };
}

// คืนทุกความเป็นไปได้ตามตำแหน่ง (จำกัดจำนวนไว้ กันระเบิด) — ให้เช็คดิจิตเป็นตัวชี้ขาดทีหลัง
// ⚠️ จำกัด 12 ตัวเลือก: ของจริงอ่านผิดพร้อมกันเกิน 2-3 ตัวแทบไม่มี · เสนอเยอะ = คนขับสับสน
export function positionCandidates(input, max = 12) {
  const s = normalize(input);
  if (s.length !== 11) return { ok: false, reason: 'bad-length', value: s, fixed: [], candidates: [] };
  let heads = [''];
  const fixed = [];
  for (let i = 0; i < 11; i++) {
    const c = s[i];
    const wantLetter = i < 4;
    const isLetter = c >= 'A' && c <= 'Z';
    const isDigit = c >= '0' && c <= '9';
    let opts;
    if ((wantLetter && isLetter) || (!wantLetter && isDigit)) {
      opts = [c];                                     // ตรงตำแหน่งอยู่แล้ว ไม่ต้องแตะ
    } else {
      opts = (wantLetter ? TO_LETTER : TO_DIGIT)[c];
      if (!opts) return { ok: false, reason: 'unfixable-char', at: i, char: c, value: s, fixed, candidates: [] };
      fixed.push({ pos: i, from: c, to: opts[0], alts: opts });
    }
    const next = [];
    for (const h of heads) for (const o of opts) { if (next.length < max) next.push(h + o); }
    heads = next;
  }
  return { ok: true, fixed, candidates: heads };
}
