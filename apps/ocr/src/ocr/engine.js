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
    default:
      // ไม่รู้จัก provider = ถอยมา mock (ปลอดภัย ไม่ยิงของจริงมั่ว)
      return Object.assign({ provider: 'mock' }, createMockEngine());
  }
}
