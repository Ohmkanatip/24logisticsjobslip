// ตัวเลือก OCR engine ตามค่า OCR_PROVIDER (ค่าเริ่มต้น = mock)
// interface ที่ทุก engine ต้องมี: async readImage(bytes) → { ok, rawText } หรือ { ok:false, reason }
import { createMockEngine } from './engines/mock.js';
import * as qwen from './engines/qwen.js';
import * as vision from './engines/vision.js';
import * as typhoon from './engines/typhoon.js';

export function chooseEngine(env) {
  const provider = ((env && env.OCR_PROVIDER) || 'mock').toLowerCase();
  switch (provider) {
    case 'qwen': return { provider, readImage: qwen.readImage };
    case 'vision': return { provider, readImage: vision.readImage };
    case 'typhoon': return { provider, readImage: typhoon.readImage };
    case 'mock':
      return Object.assign({ provider: 'mock' }, createMockEngine());
    default:
      if (!env || !env.OCR_PROVIDER) {
        // ไม่ได้ตั้งค่าเลย = โหมด dev → mock (ตามที่เอกสารบอกไว้)
        return Object.assign({ provider: 'mock' }, createMockEngine());
      }
      // ⛔ ตั้งค่ามาแต่สะกดผิด/ไม่รู้จัก — **ห้ามถอยมา mock เด็ดขาด**
      // ของจริงที่พิสูจน์แล้ว 28 ส.ค. 2569: พิมพ์ 'qwen-vl' แทน 'qwen' → ทุกรูปที่คนขับส่ง
      // จะได้เบอร์ปลอม CSQU3054383 (เช็คดิจิตผ่านด้วย) → คนขับกดยืนยัน → เบอร์ปลอมเข้าใบงาน
      // ล้มดังๆ ดีกว่าเงียบแล้วข้อมูลเสีย
      return {
        provider,
        unknown: true,
        async readImage() {
          return { ok: false, reason: 'unknown-ocr-provider', detail: 'OCR_PROVIDER = ' + provider + ' ไม่รู้จัก — ตรวจการตั้งค่า' };
        }
      };
  }
}
