// จุดต่อกลาง "เขียนเบอร์ตู้กลับเข้าใบงานร่าง" — interface เดียว: fillContainer({ jobUid, containerNo, confirmedBy })
// ⚠️ วิธีเขียนกลับจริงยังไม่เคาะ (ทางเลือกสถาปัตยกรรมอยู่ใน ARCHITECTURE-OPTIONS.md)
//    ตอนนี้มีแค่ mock ให้เทส/dev — adapter จริง 3 แบบเป็น stub ซื่อสัตย์รอเคาะ
import * as appsScriptAdapter from './appsScriptAdapter.js';
import * as sheetsApiAdapter from './sheetsApiAdapter.js';
import * as d1StagingAdapter from './d1StagingAdapter.js';

// 🎭 mock writeback — บันทึกลง array ให้เทสตรวจ ไม่แตะข้อมูลจริงใดๆ
export function createMockWriteback() {
  const records = [];
  return {
    mock: true,
    records,
    async fillContainer({ jobUid, containerNo, confirmedBy }) {
      if (!containerNo) return { ok: false, reason: 'no-container' };
      records.push({ jobUid: jobUid || null, containerNo, confirmedBy: confirmedBy || null });
      return { ok: true, mock: true };
    }
  };
}

// เลือก adapter ตามค่า WRITEBACK_PROVIDER (ยังไม่มีตัวไหน implement จริง — default mock)
export function chooseWriteback(env) {
  const provider = ((env && env.WRITEBACK_PROVIDER) || 'mock').toLowerCase();
  switch (provider) {
    case 'appsscript': return { provider, fillContainer: appsScriptAdapter.fillContainer };
    case 'sheetsapi': return { provider, fillContainer: sheetsApiAdapter.fillContainer };
    case 'd1': return { provider, fillContainer: d1StagingAdapter.fillContainer };
    case 'mock':
    default:
      return Object.assign({ provider: 'mock' }, createMockWriteback());
  }
}
