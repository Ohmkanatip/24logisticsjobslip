// จุดต่อกลาง "เขียนเบอร์ตู้กลับเข้าใบงานร่าง" — interface เดียว: fillContainer({ jobUid, containerNo, confirmedBy, driverId, ts })
// ✅ เจ้าของเคาะแล้ว (28 ส.ค. 2569): ใช้ทาง ③ d1 staging — บอทไม่แตะชีท เว็บดึงเอง (ดู ARCHITECTURE-OPTIONS.md)
//    ทาง ①/② เก็บเป็น stub ไว้อ้างอิง — ห้ามใช้โดยไม่คุยกับเจ้าของก่อน
import * as appsScriptAdapter from './appsScriptAdapter.js';
import * as sheetsApiAdapter from './sheetsApiAdapter.js';
import { createStagingWriteback } from './d1StagingAdapter.js';
import { makeMemoryStagingRepo, makeD1StagingRepo } from '../db/staging.js';

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

// เลือก adapter ตามค่า WRITEBACK_PROVIDER
// 'd1' = ทางที่เคาะแล้ว: มี env.DB → ตาราง D1 จริง · ไม่มี (โหมด mock/เทส) → memory (หายเมื่อ isolate รีเซ็ต — พอสำหรับ dev)
// ให้ stagingRepo ส่งเข้ามาแทนได้ (worker เก็บ memory repo ระดับโมดูลไว้ให้ endpoint ดึงเห็นก้อนเดียวกัน)
export function chooseWriteback(env, stagingRepo) {
  const provider = ((env && env.WRITEBACK_PROVIDER) || 'mock').toLowerCase();
  switch (provider) {
    case 'appsscript': return { provider, fillContainer: appsScriptAdapter.fillContainer };
    case 'sheetsapi': return { provider, fillContainer: sheetsApiAdapter.fillContainer };
    case 'd1': {
      const repo = stagingRepo || (env && env.DB ? makeD1StagingRepo(env.DB) : makeMemoryStagingRepo());
      return createStagingWriteback(repo);
    }
    case 'mock':
    default:
      return Object.assign({ provider: 'mock' }, createMockWriteback());
  }
}
