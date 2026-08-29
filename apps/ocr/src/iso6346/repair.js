// เสนอทางซ่อมเบอร์ตู้ที่เช็คดิจิตไม่ผ่าน — ลองสลับอักขระที่ OCR ชอบอ่านผิด ทีละ 1 ตำแหน่ง
// ⚠️ กติกาเหล็ก: ผลลัพธ์เป็นแค่ "ข้อเสนอให้คนเลือก" ห้ามระบบ auto-ใช้เองเด็ดขาด
import { normalize, validate } from './check.js';

// คู่อักขระที่ OCR สับสนบ่อย (สลับได้สองทิศ): O↔0, I↔1, B↔8, S↔5, Z↔2, G↔6, D↔0, Q↔0, T↔7, A↔4
// หมายเหตุ: '0' จึงสลับกลับได้ 3 ทาง (O/D/Q)
const SWAP = {
  O: ['0'], '0': ['O', 'D', 'Q'],
  I: ['1'], '1': ['I'],
  B: ['8'], '8': ['B'],
  S: ['5'], '5': ['S'],
  Z: ['2'], '2': ['Z'],
  G: ['6'], '6': ['G'],
  D: ['0'],
  Q: ['0'],
  T: ['7'], '7': ['T'],
  A: ['4'], '4': ['A']
};

// คืน list เบอร์ที่แก้แล้วเช็คดิจิตผ่าน (ปกติได้ 0-1 ตัว) — ไม่ซ้ำ และไม่รวมสตริงเดิม
export function suggestRepairs(input) {
  const s = normalize(input);
  if (s.length !== 11) return [];
  const found = new Set();
  for (let i = 0; i < 11; i++) {
    const alts = SWAP[s[i]] || [];
    for (const alt of alts) {
      const cand = s.slice(0, i) + alt + s.slice(i + 1);
      const v = validate(cand);
      if (v.ok) found.add(v.normalized);
    }
  }
  found.delete(s); // กันกรณีสตริงเดิมหลุดเข้ามา (ฟังก์ชันนี้ควรถูกเรียกเฉพาะตอนไม่ผ่านอยู่แล้ว)
  return [...found];
}
