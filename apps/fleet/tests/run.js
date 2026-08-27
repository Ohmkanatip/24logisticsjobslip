// ชุดทดสอบ apps/fleet — plain Node ไม่มี npm dependency · รัน: node tests/run.js
// ผ่านทุกเคส = exit 0 · พังเคสเดียวก็ exit 1 · สรุปท้าย "ผ่าน X · ตก Y"

import { readFile } from 'node:fs/promises';
import zlib from 'node:zlib';

import { haversineM } from '../src/worker/haversine.js';
import { checkWriteBudget, shouldWriteTrack, processPing, WRITE_WARN, WRITE_OVER } from '../src/worker/ingest.js';
import { makeMemoryRepo, makeD1Repo, dayOfTs } from '../src/db/repo.js';
import { makeInitialState, tick, toPings, positionAt, ROUTE, ROUTE_TOTAL_M } from '../src/mock/feed.js';
import { chooseProvider } from '../src/map/provider.js';
import longdoAdapter from '../src/map/adapters/longdo.js';
import googleAdapter from '../src/map/adapters/google.js';
import mapboxAdapter from '../src/map/adapters/mapbox.js';
import { archiveOldTracks, CSV_HEADER } from '../src/archive/r2Archive.js';

let pass = 0;
let fail = 0;
function ok(cond, name, detail) {
  if (cond) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    fail++;
    console.log('  ❌ ' + name + (detail ? ' — ' + detail : ''));
  }
}
function section(t) {
  console.log('\n— ' + t + ' —');
}

// ปิงตัวช่วย
function ping(vehicleId, lat, lng, speed, ts) {
  return { vehicle_id: vehicleId, lat, lng, speed_kmh: speed, heading: 0, ts };
}
const T0 = Date.UTC(2026, 5, 1, 3, 0, 0); // 2026-06-01T03:00Z — เวลาคงที่ในเทส (ห้ามใช้เวลาเครื่อง)

async function main() {
  // ========== haversine ==========
  section('haversine (ระยะที่รู้ค่า)');
  ok(haversineM(13.0827, 100.8918, 13.0827, 100.8918) === 0, 'จุดเดียวกัน = 0 เมตร');
  {
    // กรุงเทพ(สีลม) → พัทยา เส้นตรง ~101 กม. (ใช้เป็นเคส "~100กม. ±10%")
    const d = haversineM(13.7563, 100.5018, 12.9236, 100.8825);
    ok(d > 90000 && d < 110000, 'กรุงเทพ→พัทยา ~100กม. ±10%', 'ได้ ' + Math.round(d / 1000) + ' กม.');
  }
  {
    // กรุงเทพ → แหลมฉบัง เส้นตรงจริง ~86 กม. (ไม่ใช่ 100 — 100+ คือระยะถนน) เช็ค ±10% ของค่า geodesic
    const d = haversineM(13.7563, 100.5018, 13.0827, 100.8918);
    ok(d > 77000 && d < 95000, 'กรุงเทพ→แหลมฉบัง เส้นตรง ~86กม. ±10%', 'ได้ ' + Math.round(d / 1000) + ' กม.');
  }
  {
    const d = haversineM(13.0, 100.0, 14.0, 100.0); // 1 องศาละติจูด ≈ 111.19 กม.
    ok(Math.abs(d - 111190) < 1200, '1° ละติจูด ≈ 111.19 กม. ±1%', 'ได้ ' + Math.round(d));
  }
  {
    const d = haversineM(13.0, 100.0, 13.0002, 100.0); // ≈ 22.2 เมตร
    ok(d > 20 && d < 25, 'ระยะสั้น 0.0002° ≈ 22 เมตร', 'ได้ ' + d.toFixed(1));
  }

  // ========== movement filter ==========
  section('movement filter (mitigation ข้อ 1: รถจอดไม่เขียน track)');
  {
    const prev = { lat: 13.0, lng: 100.0 };
    ok(shouldWriteTrack(prev, ping('A', 13.0001, 100.0, 0, T0), 20).write === false, 'ขยับ ~11ม. + speed 0 = ไม่เขียน');
    ok(shouldWriteTrack(prev, ping('A', 13.0003, 100.0, 0, T0), 20).write === true, 'ขยับ ~33ม. > 20ม. = เขียน');
    ok(shouldWriteTrack(prev, ping('A', 13.00005, 100.0, 45, T0), 20).write === true, 'speed 45 กม./ชม. = เขียนแม้ระยะสั้น');
    ok(shouldWriteTrack(prev, ping('A', 13.0, 100.0, 0, T0), 20).write === false, 'อยู่จุดเดิมเป๊ะ + speed 0 = ไม่เขียน');
  }
  {
    // threshold ปรับได้ผ่านพารามิเตอร์ (มาจาก env MOVE_THRESHOLD_M)
    const prev = { lat: 13.0, lng: 100.0 };
    ok(shouldWriteTrack(prev, ping('A', 13.0003, 100.0, 0, T0), 50).write === false, 'threshold 50ม.: ขยับ 33ม. = ไม่เขียน');
    ok(shouldWriteTrack(prev, ping('A', 13.0001, 100.0, 0, T0), 5).write === true, 'threshold 5ม.: ขยับ 11ม. = เขียน');
    ok(shouldWriteTrack(null, ping('A', 13.0, 100.0, 0, T0), 20).write === true, 'ไม่มีจุดก่อนหน้า = เขียน (first-point)');
  }
  {
    // processPing ของจริง: รถจอด → ไม่เขียน track แต่ live ต้องอัปเดต
    const repo = makeMemoryRepo();
    const first = await processPing(repo, null, ping('71-3760', 13.0, 100.0, 0, T0), {});
    ok(first.wroteTrack === true, 'processPing จุดแรก: เขียน track');
    const parked = await processPing(repo, { lat: 13.0, lng: 100.0 }, ping('71-3760', 13.00005, 100.0, 0, T0 + 60000), {});
    ok(parked.wroteTrack === false && parked.reason === 'parked', 'processPing รถจอด: ไม่เขียน track');
    const live = await repo.getLiveAll();
    ok(live.length === 1 && live[0].updated_at === T0 + 60000, 'รถจอดแต่ gps_live ยังอัปเดตเวลาใหม่');
    const moved = await processPing(repo, { lat: 13.0, lng: 100.0 }, ping('71-3760', 13.0005, 100.0, 55, T0 + 120000), {});
    ok(moved.wroteTrack === true, 'processPing รถขยับ: เขียน track');
    ok((await repo.countTrackWritesOn(dayOfTs(T0))) === 2, 'track วันนี้มี 2 แถว (จุดแรก + ตอนขยับ) ไม่นับตอนจอด');
  }

  // ========== UPSERT live ==========
  section('UPSERT gps_live (mitigation ข้อ 2: 1 แถว/คัน)');
  {
    const repo = makeMemoryRepo();
    let prev = null;
    for (let i = 0; i < 100; i++) {
      const p = ping('82-1234', 13.0 + i * 0.001, 100.0, 60, T0 + i * 60000);
      await processPing(repo, prev, p, {});
      prev = { lat: p.lat, lng: p.lng };
    }
    const live = await repo.getLiveAll();
    ok(live.length === 1, 'ปิง 100 ครั้ง → gps_live มี 1 แถว');
    ok(Math.abs(live[0].lat - (13.0 + 99 * 0.001)) < 1e-9, 'แถว live เป็นค่าปิงล่าสุด');
    ok(live[0].updated_at === T0 + 99 * 60000, 'updated_at เป็นเวลาปิงล่าสุด');
  }

  // ========== write budget ==========
  section('checkWriteBudget (mitigation ข้อ 3: เพดาน D1 100k เขียน/วัน)');
  ok(checkWriteBudget(0).level === 'ok', '0 = ok');
  ok(checkWriteBudget(89999).level === 'ok', '89,999 = ok');
  ok(checkWriteBudget(90000).level === 'warn', '90,000 = warn');
  ok(checkWriteBudget(99999).level === 'warn', '99,999 = warn');
  ok(checkWriteBudget(100000).level === 'over', '100,000 = over');
  ok(checkWriteBudget(100001).level === 'over', '100,001 = over');
  ok(WRITE_WARN === 90000 && WRITE_OVER === 100000, 'ค่าคงที่ตรงสเปก 90,000/100,000');
  {
    // งบเต็ม: processPing ต้องไม่เขียน track แต่ live ยังอัปเดต
    const base = makeMemoryRepo();
    const repo = { ...base, countTrackWritesOn: async () => 100000 }; // จำลองว่าวันนี้เขียนเต็มเพดานแล้ว
    const r = await processPing(repo, null, ping('70-5566', 13.5, 100.5, 60, T0), {});
    ok(r.wroteTrack === false && r.budget.level === 'over', 'งบ over: ไม่เขียน track');
    ok((await base.getLiveAll()).length === 1, 'งบ over: live ยังอัปเดต (ไม่งอกแถว)');
  }

  // ========== archive R2 ==========
  section('archive ขึ้น R2 (เก่ากว่า 60 วัน)');
  {
    const repo = makeMemoryRepo();
    const OLD1 = Date.UTC(2026, 3, 10); // เม.ย. 2026 (เก่า)
    const OLD2 = Date.UTC(2026, 4, 20); // พ.ค. 2026 (เก่า อีกเดือน)
    const NEW1 = Date.UTC(2026, 7, 25); // ส.ค. 2026 (ใหม่ — ห้ามโดน)
    await repo.insertTrack({ vehicle_id: '71-3760', lat: 13.1, lng: 100.9, ts: OLD1 });
    await repo.insertTrack({ vehicle_id: '71-3760', lat: 13.2, lng: 100.8, ts: OLD1 + 60000 });
    await repo.insertTrack({ vehicle_id: '82-1234', lat: 13.3, lng: 100.7, ts: OLD2 });
    await repo.insertTrack({ vehicle_id: '82-1234', lat: 13.4, lng: 100.6, ts: NEW1 });
    const cutoff = Date.UTC(2026, 5, 28); // ปลาย มิ.ย. — เก่ากว่านี้ต้องโดน archive

    const oldRows = await repo.selectTrackOlderThan(cutoff);
    ok(oldRows.length === 3, 'selectTrackOlderThan เลือกเฉพาะแถวเก่า 3 แถว');
    ok(oldRows.every((r) => r.ts < cutoff), 'ทุกแถวที่เลือกเก่ากว่า cutoff จริง');

    const r2 = { puts: [], async put(key, bytes) { this.puts.push({ key, bytes }); } };
    const res = await archiveOldTracks(repo, r2, cutoff);
    ok(res.ok === true && res.archived === 3, 'archive แล้วรายงาน 3 แถว');
    ok(r2.puts.length === 2, 'แยกไฟล์ตามเดือน = put 2 ก้อน (เม.ย.+พ.ค.)');
    ok(r2.puts.some((p) => p.key === `gps_track/2026-04/run-${cutoff}.csv.gz`) && r2.puts.some((p) => p.key === `gps_track/2026-05/run-${cutoff}.csv.gz`),
      'key บน R2 = เดือน + run-<cutoff> (ไม่ซ้ำต่อรอบ)', JSON.stringify(r2.puts.map((p) => p.key)));
    {
      const csv = zlib.gunzipSync(Buffer.from(r2.puts[0].bytes)).toString('utf8');
      ok(csv.startsWith(CSV_HEADER + '\n'), 'gzip แตกกลับได้ + CSV header ถูกต้อง', csv.slice(0, 40));
      ok(csv.includes('71-3760'), 'เนื้อ CSV มีข้อมูลแถวจริง');
    }
    const left = await repo.selectTrackOlderThan(Number.MAX_SAFE_INTEGER);
    ok(left.length === 1 && left[0].ts === NEW1, 'แถวเก่าถูกลบหมด · แถวใหม่ยังอยู่');
    const res2 = await archiveOldTracks(repo, r2, cutoff);
    ok(res2.archived === 0 && r2.puts.length === 2, 'รันซ้ำตอนไม่มีของเก่า = archived 0 ไม่ put เพิ่ม');
    // ⭐ บั๊กที่ตัวตรวจอิสระเจอ: key รายเดือนล้วนถูก put ทับรอบถัดไป = ข้อมูลหายถาวร
    //    รอบรันต่างกัน (cutoff ต่างกัน) ต้องได้ key คนละตัว ไฟล์เก่าไม่โดนทับ
    {
      const repo2 = makeMemoryRepo();
      await repo2.insertTrack({ vehicle_id: '71-3760', lat: 13.1, lng: 100.9, ts: OLD1 + 1000 });
      const res3 = await archiveOldTracks(repo2, r2, cutoff + 86400000); // รันอีกรอบ cutoff ขยับ 1 วัน เดือนเดิม
      ok(res3.archived === 1 && r2.puts.length === 3, 'รอบใหม่เดือนเดิม put ก้อนใหม่ ไม่ทับของเก่า');
      const keys = r2.puts.map((p) => p.key);
      ok(new Set(keys).size === keys.length, 'key ทุกก้อนไม่ซ้ำกันเลย (archive สะสม ไม่มีทางทับ)', JSON.stringify(keys));
    }

  }

  // ========== worker api (ingest auth + mapconfig) ==========
  section('worker api: ด่าน ingest + mapconfig');
  {
    const { ingestAuthorized, mapConfigOf } = await import('../src/worker/api.js');
    const req = (auth) => ({ headers: { get: (k) => (k === 'authorization' ? auth : null) } });
    ok(ingestAuthorized(req(null), {}) === true, 'ไม่ตั้ง INGEST_TOKEN = ผ่าน (โหมดทดลองในเครื่อง)');
    ok(ingestAuthorized(req('Bearer s3cret'), { INGEST_TOKEN: 's3cret' }) === true, 'token ตรง = ผ่าน');
    ok(ingestAuthorized(req('Bearer wrong'), { INGEST_TOKEN: 's3cret' }) === false, 'token ผิด = ไม่ผ่าน');
    ok(ingestAuthorized(req(null), { INGEST_TOKEN: 's3cret' }) === false, 'ตั้ง token แล้วไม่แนบ header = ไม่ผ่าน');

    const c1 = mapConfigOf({});
    ok(c1.provider === 'leaflet' && c1.fallback === false, 'mapconfig ค่าเริ่มต้น = leaflet ไม่ใช่ fallback');
    const c2 = mapConfigOf({ MAP_PROVIDER: 'google' });     // ไม่มี key → ถอยมา leaflet + บอกตรงๆ
    ok(c2.provider === 'leaflet' && c2.wanted === 'google' && c2.fallback === true,
      'ตั้ง google แต่ไม่มี key = fallback leaflet และธง fallback ขึ้น (หน้าเว็บเอาไปแจ้งผู้ใช้)');
    ok(JSON.stringify(mapConfigOf({ MAP_PROVIDER: 'google', MAP_API_KEY: 'x', MAP_SERVER_KEY: 'SECRET' })).indexOf('SECRET') === -1,
      'MAP_SERVER_KEY ไม่มีทางหลุดออกทาง mapconfig');
  }

  // ========== map provider ==========
  section('chooseProvider (fallback = leaflet)');
  ok(chooseProvider({}).name === 'leaflet', 'ไม่ตั้ง MAP_PROVIDER = leaflet');
  ok(chooseProvider({ MAP_PROVIDER: 'longdo', MAP_API_KEY: 'demo-key' }).name === 'longdo', 'เลือก longdo ได้ (มี key)');
  ok(chooseProvider({ MAP_PROVIDER: 'longdo' }).name === 'leaflet', 'longdo แต่ไม่มี key = ถอยมา leaflet');
  ok(chooseProvider({ MAP_PROVIDER: 'ไม่รู้จัก' }).name === 'leaflet', 'provider ไม่รู้จัก = leaflet');
  ok(chooseProvider({ MAP_PROVIDER: 'GOOGLE', MAP_API_KEY: 'k' }).name === 'google', 'ชื่อ provider ไม่แคร์ตัวพิมพ์');
  {
    const cfg = chooseProvider({}).clientConfig({});
    ok(cfg.ok === true && cfg.jsUrl && cfg.tileUrl, 'leaflet clientConfig ใช้ได้จริง (มี CDN url)');
    ok(!JSON.stringify(cfg).includes('KEY') && !('serverKey' in cfg), 'clientConfig ของ leaflet ไม่มี key หลุด');
  }
  // stub ต้องซื่อสัตย์ — ไม่แกล้งตอบสำเร็จ
  for (const [nm, ad] of [['longdo', longdoAdapter], ['google', googleAdapter], ['mapbox', mapboxAdapter]]) {
    const g = ad.geocode({}, 'ลาดกระบัง');
    ok(g.ok === false && g.reason === 'not-implemented', `stub ${nm}.geocode ตอบ not-implemented ตรงๆ`);
    const c = ad.clientConfig({});
    ok(c.ok === false && c.reason === 'not-implemented', `stub ${nm}.clientConfig ไม่แกล้งตอบสำเร็จ`);
  }

  // ========== mock feed ==========
  section('mock feed (deterministic)');
  {
    const s0 = makeInitialState();
    ok(s0.vehicles.length === 4, 'รถ 4 คัน');
    ok(s0.mock === true, 'ติดป้าย mock:true');
    ok(s0.vehicles.some((v) => v.status === 'ว่าง'), 'มีคันที่ว่าง (จอด)');

    const s1 = tick(s0, 60);
    const run0 = s0.vehicles[0];
    const run1 = s1.vehicles[0];
    const p0 = positionAt(run0.dist_m);
    const p1 = positionAt(run1.dist_m);
    const moved = haversineM(p0.lat, p0.lng, p1.lat, p1.lng);
    ok(moved > 800 && moved < 1200, 'ความเร็ว ~60 กม./ชม.: 60 วิ ขยับ ~1 กม. ±20%', Math.round(moved) + ' ม.');

    const idle0 = s0.vehicles.find((v) => v.status === 'ว่าง');
    const idle1 = s1.vehicles.find((v) => v.id === idle0.id);
    ok(idle1.dist_m === idle0.dist_m && idle1.status === 'ว่าง', 'รถว่างไม่ขยับ');

    ok(JSON.stringify(tick(s0, 60)) === JSON.stringify(tick(s0, 60)), 'deterministic: input เดิม = ผลเดิม');
    ok(JSON.stringify(s0) === JSON.stringify(makeInitialState()), 'tick ไม่แก้ state เดิม (pure)');

    // วิ่งยาวจนสุดทาง (~90 กม. ที่ 60 กม./ชม. ≈ 1.5 ชม.) ต้องกลายเป็น "ถึงแล้ว" และไม่หลุดปลายทาง
    let s = s0;
    for (let i = 0; i < 120; i++) s = tick(s, 60);
    const arrived = s.vehicles[0];
    ok(arrived.status === 'ถึงแล้ว' && arrived.dist_m === ROUTE_TOTAL_M, 'วิ่งครบเส้นทาง = ถึงแล้ว + หยุดที่ปลายทาง');
    ok(arrived.speed_kmh === 0, 'ถึงแล้ว ความเร็วเป็น 0');

    const end = positionAt(ROUTE_TOTAL_M);
    const last = ROUTE[ROUTE.length - 1];
    ok(Math.abs(end.lat - last.lat) < 1e-9 && Math.abs(end.lng - last.lng) < 1e-9, 'positionAt(สุดทาง) = ลาดกระบัง ICD');
    const start = positionAt(0);
    ok(Math.abs(start.lat - ROUTE[0].lat) < 1e-9, 'positionAt(0) = แหลมฉบัง');

    const pings = toPings(s1, T0);
    ok(pings.length === 4 && pings.every((p) => p.ts === T0), 'toPings ครบ 4 คัน + ใช้ ts ที่ส่งเข้าไป (ไม่แตะเวลาเครื่อง)');
    ok(pings.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)), 'พิกัดทุกปิงเป็นตัวเลขจริง');
  }

  // ========== repo interface ==========
  section('repo: memory ต้องไม่หลวมกว่า D1 (บทเรียน stub โกหก)');
  {
    const fakeDb = { prepare() { throw new Error('เทสนี้ห้ามแตะ DB จริง'); } };
    const memKeys = Object.keys(makeMemoryRepo()).sort();
    const d1Keys = Object.keys(makeD1Repo(fakeDb)).sort();
    ok(JSON.stringify(memKeys) === JSON.stringify(d1Keys), 'Object.keys ของ 2 repo ตรงกันเป๊ะ',
      'mem=' + memKeys.join(',') + ' | d1=' + d1Keys.join(','));
    const need = ['upsertLive', 'insertTrack', 'getLiveAll', 'countTrackWritesOn', 'selectTrackOlderThan', 'deleteTrackOlderThan', 'listVehicles'];
    ok(need.every((k) => memKeys.includes(k)), 'มีครบทุกฟังก์ชันตามสเปก', 'ขาด: ' + need.filter((k) => !memKeys.includes(k)).join(','));
  }
  {
    const repo = makeMemoryRepo([{ id: '71-3760', driver_name: 'ทดสอบ-สมชาย' }, { id: '83-9012', driver_name: 'ทดสอบ-อนันต์', active: 0 }]);
    const vs = await repo.listVehicles();
    ok(vs.length === 1 && vs[0].id === '71-3760', 'listVehicles กรองเฉพาะ active=1');
    const dayA = dayOfTs(T0);
    await repo.insertTrack({ vehicle_id: 'X', lat: 1, lng: 1, ts: T0 });
    await repo.insertTrack({ vehicle_id: 'X', lat: 1, lng: 1, ts: T0 + 1000 });
    await repo.insertTrack({ vehicle_id: 'X', lat: 1, lng: 1, ts: T0 + 86400000 }); // วันถัดไป
    ok((await repo.countTrackWritesOn(dayA)) === 2, 'countTrackWritesOn นับแยกวันถูก');
  }

  // ========== schema ==========
  section('schema.sql + migration');
  {
    const schema = await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
    for (const t of ['vehicles', 'gps_live', 'gps_track', 'job_assignment', 'trip_daily']) {
      ok(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`).test(schema), `schema มีตาราง ${t}`);
    }
    ok(/CREATE INDEX IF NOT EXISTS idx_track ON gps_track \(vehicle_id, ts\)/.test(schema), 'schema มี index idx_track(vehicle_id, ts)');
    ok(/PRIMARY KEY \(vehicle_id, day\)/.test(schema), 'trip_daily มี PK(vehicle_id, day)');
    ok(/AUTOINCREMENT/.test(schema), 'gps_track ใช้ AUTOINCREMENT');

    const mig = await readFile(new URL('../src/db/migrations/0001_init.sql', import.meta.url), 'utf8');
    for (const t of ['vehicles', 'gps_live', 'gps_track', 'job_assignment', 'trip_daily']) {
      ok(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`).test(mig), `migration 0001 มีตาราง ${t}`);
    }
  }

  // ========== worker source (import ตรงๆ ไม่ได้เพราะ import ไฟล์ .html) ==========
  section('worker index.js (ตรวจจาก source)');
  {
    const src = await readFile(new URL('../src/worker/index.js', import.meta.url), 'utf8');
    ok(src.includes("'/api/fleet/live'"), 'มี route /api/fleet/live');
    ok(src.includes("'/api/fleet/ingest'"), 'มี route /api/fleet/ingest');
    ok(src.includes('CARTRACK_API_KEY'), 'ไม่มี CARTRACK_API_KEY = เข้าโหมด mock');
    ok(src.includes('export default'), 'เป็น module worker (export default fetch)');
    // จับเฉพาะ token จริงที่ hardcode (Bearer ตามด้วยตัวอักษรยาวๆ) — 'Bearer ' + env.X และคอมเมนต์ <token> ไม่นับ
    ok(!/AKfy|AIza|pk\.eyJ|sk\.eyJ|Bearer [A-Za-z0-9_\-]{8,}/.test(src), 'ไม่มี secret/API key ฝังใน worker');
  }

  // ══ รูที่ mutation test เจอ (28 ส.ค. 2569) — ฝังบั๊กแล้วเทสเดิมยังเขียว ══
  section('อุดรูจาก mutation test');
  {
    const { dayRangeMs } = await import('../src/db/repo.js');

    // ① dayRangeMs ต้องปฏิเสธรูปแบบวันที่มั่ว (ไม่งั้นนับ write ผิดวัน = ด่านกันเพดานเพี้ยน)
    ok(dayRangeMs('2026-08-28') !== null, 'รูปแบบถูกต้องผ่าน');
    for (const badDay of ['2026-8-28', '28/08/2026', '2026-08', 'พรุ่งนี้', '', '2026-08-28T00:00:00Z']) {
      ok(dayRangeMs(badDay) === null, 'ปฏิเสธวันที่รูปแบบผิด: ' + JSON.stringify(badDay));
    }
    ok(dayRangeMs('2026-08-28').endMs - dayRangeMs('2026-08-28').startMs === 86400000, 'ช่วงวันกว้าง 24 ชม.พอดี');

    // ② countTrackWritesOn ต้องไม่นับแถวที่ ts เพี้ยน (D1 จริงเทียบตัวเลขกับข้อความไม่ได้ ก็ไม่นับ)
    {
      const repo = makeMemoryRepo();
      const day = '2026-08-28';
      const { startMs } = dayRangeMs(day);
      await repo.insertTrack({ vehicle_id: 'a', lat: 1, lng: 1, ts: startMs + 1000 });
      await repo.insertTrack({ vehicle_id: 'a', lat: 1, lng: 1, ts: 'เมื่อวาน' });   // แถวเสีย
      await repo.insertTrack({ vehicle_id: 'a', lat: 1, lng: 1, ts: null });
      // ⭐ ตัวชี้ขาด: ts เป็น "สตริงตัวเลข" — JS แปลงให้เทียบผ่านได้ (ด่านหลวมจะนับด้วย)
      //    แต่ SQLite จัดลำดับ TEXT ไว้หลัง INTEGER เสมอ → D1 จริงไม่นับ · memory ต้องไม่นับเหมือนกัน
      await repo.insertTrack({ vehicle_id: 'a', lat: 1, lng: 1, ts: String(startMs + 2000) });
      const n = await repo.countTrackWritesOn(day);
      ok(n === 1, '⭐ นับเฉพาะแถวที่ ts เป็นตัวเลขจริง (สตริงตัวเลขก็ไม่นับ — ตรงกับ D1)', n);
    }

    // ③ ⚠️ รูที่อันตรายสุด: ไม่มีเทสครอบ "R2 พังกลางคัน" มาก่อนเลย
    //    ลำดับต้องเป็น put ให้ครบก่อน → ค่อยลบ · ถ้าลบก่อนแล้ว R2 พัง = ข้อมูลหายถาวร กู้ไม่ได้
    {
      const repo = makeMemoryRepo();
      const day1 = Date.UTC(2026, 3, 10), day2 = Date.UTC(2026, 4, 20);
      await repo.insertTrack({ vehicle_id: 'a', lat: 1, lng: 1, ts: day1 });
      await repo.insertTrack({ vehicle_id: 'b', lat: 2, lng: 2, ts: day2 });
      const cutoff = Date.UTC(2026, 5, 28);

      const r2Fail = { puts: 0, async put() { this.puts++; throw new Error('R2 ล่ม'); } };
      let threw = false;
      try { await archiveOldTracks(repo, r2Fail, cutoff); } catch (e) { threw = true; }
      ok(threw, 'R2 พัง → archiveOldTracks โยน error ออกมา ไม่กลืนเงียบ');
      const left = await repo.selectTrackOlderThan(Number.MAX_SAFE_INTEGER);
      ok(left.length === 2, '⭐⭐ R2 พังกลางคัน → ข้อมูลใน D1 ต้องยังอยู่ครบ ห้ามถูกลบ (put ก่อน ลบทีหลัง)', left.length);

      // พังที่ก้อนที่ 2 (ก้อนแรก put สำเร็จไปแล้ว) — ก็ยังห้ามลบอะไรทั้งสิ้น
      const r2Half = { n: 0, async put() { this.n++; if (this.n >= 2) throw new Error('R2 ล่มกลางคัน'); } };
      threw = false;
      try { await archiveOldTracks(repo, r2Half, cutoff); } catch (e) { threw = true; }
      ok(threw && (await repo.selectTrackOlderThan(Number.MAX_SAFE_INTEGER)).length === 2,
        '⭐ พังที่ก้อนที่ 2 (ก้อนแรกขึ้นไปแล้ว) ก็ยังไม่ลบอะไร — ยอมสำรองซ้ำ ดีกว่าข้อมูลหาย');

      // ปกติแล้วต้องลบได้จริง
      const r2Ok = { puts: [], async put(k) { this.puts.push(k); } };
      const res = await archiveOldTracks(repo, r2Ok, cutoff);
      ok(res.archived === 2 && (await repo.selectTrackOlderThan(Number.MAX_SAFE_INTEGER)).length === 0,
        'R2 ปกติ → อัปครบแล้วลบออกจาก D1 ได้');
    }
  }

  // ══ เคสขอบ + บั๊กที่เจอจากรีวิว adversarial 28 ส.ค. 2569 ══
  section('ปิงข้อมูลเพี้ยน — ต้องถูกปฏิเสธ ไม่ใช่เขียนค่าเสียลงฐาน');
  {
    const { validatePing, safeThreshold, shouldWriteTrack, processPing } = await import('../src/worker/ingest.js');
    const good = { vehicle_id: '71-3760', lat: 13.08, lng: 100.89, ts: 1756000000000, speed_kmh: 0 };
    ok(validatePing(good).ok === true, 'ปิงปกติผ่าน');
    const bad = [
      [{ ...good, lat: NaN }, 'bad-lat', 'lat เป็น NaN'],
      [{ ...good, lat: 'สิบสาม' }, 'bad-lat', 'lat เป็นข้อความไทย'],
      [{ ...good, lat: 91 }, 'bad-lat', 'lat เกิน 90'],
      [{ ...good, lat: -91 }, 'bad-lat', 'lat ต่ำกว่า -90'],
      [{ ...good, lng: 181 }, 'bad-lng', 'lng เกิน 180'],
      [{ ...good, lng: Infinity }, 'bad-lng', 'lng เป็น Infinity'],
      [{ ...good, ts: 0 }, 'bad-ts', 'ts = 0'],
      [{ ...good, ts: -5 }, 'bad-ts', 'ts ติดลบ'],
      [{ ...good, ts: 'เมื่อวาน' }, 'bad-ts', 'ts เป็นข้อความ'],
      [{ ...good, vehicle_id: '' }, 'bad-vehicle-id', 'ทะเบียนว่าง'],
      [{ ...good, vehicle_id: '   ' }, 'bad-vehicle-id', 'ทะเบียนเป็นช่องว่างล้วน'],
      [{ ...good, vehicle_id: 71 }, 'bad-vehicle-id', 'ทะเบียนเป็นตัวเลข'],
      [null, 'bad-ping', 'ปิงเป็น null'],
      ['ไม่ใช่ object', 'bad-ping', 'ปิงเป็นสตริง'],
    ];
    for (const [p, reason, name] of bad) {
      const r = validatePing(p);
      ok(r.ok === false && r.reason === reason, 'ปฏิเสธ: ' + name + ' → ' + reason, r);
    }

    // ⭐ ของจริงที่เจอ: พิกัด NaN ไม่เขียน track (ถูก) แต่เดิม upsertLive ยังเขียน NaN ลงฐาน (ผิด)
    {
      const repo = makeMemoryRepo();
      const r = await processPing(repo, null, { ...good, lat: NaN }, {});
      ok(r.ok === false && r.reason === 'bad-lat', '⭐ ปิงพิกัดเสีย → processPing ปฏิเสธ', r);
      ok((await repo.getLiveAll()).length === 0, '⭐ ปิงเสียต้องไม่มีอะไรลง gps_live เลย (เดิมเขียน NaN ลงไป)');
      const t = await repo.selectTrackOlderThan(Number.MAX_SAFE_INTEGER);
      ok(t.length === 0, 'ปิงเสียต้องไม่มีอะไรลง gps_track');
    }
  }

  section('threshold เพี้ยน — ต้องไม่ทำลายกลไกกันเพดาน D1');
  {
    const { safeThreshold, shouldWriteTrack, processPing } = await import('../src/worker/ingest.js');
    ok(safeThreshold(20) === 20, 'ค่าปกติผ่านตรงๆ');
    ok(safeThreshold(NaN) === 20, 'NaN → ค่าเริ่มต้น 20');
    ok(safeThreshold('abc') === 20, 'ข้อความ → ค่าเริ่มต้น 20');
    ok(safeThreshold(undefined) === 20, 'ไม่ส่งมา → ค่าเริ่มต้น 20');
    ok(safeThreshold('') === 20, 'สตริงว่าง → ค่าเริ่มต้น 20 (ไม่ใช่ 0 แบบที่ Number("") ให้)');
    ok(safeThreshold(-5) === 0, '⭐ ติดลบ → 0 (เดิม: ระยะทาง > ค่าติดลบ เสมอ = เขียนทุกปิงจนทะลุเพดาน)');
    ok(safeThreshold(0) === 0, '0 ใช้ได้ (เขียนเมื่อขยับแม้นิดเดียว)');

    const prev = { lat: 13.0, lng: 100.0 };
    const still = { vehicle_id: 'x', lat: 13.0, lng: 100.0, ts: 1, speed_kmh: 0 };
    ok(shouldWriteTrack(prev, still, -5).write === false, '⭐ threshold ติดลบ: รถจอดสนิทต้องยังไม่เขียน');
    ok(shouldWriteTrack(prev, still, NaN).write === false, 'threshold NaN: รถจอดสนิทต้องไม่เขียน');
    const moved = { vehicle_id: 'x', lat: 13.001, lng: 100.0, ts: 1, speed_kmh: 0 };
    ok(shouldWriteTrack(prev, moved, NaN).write === true, 'threshold NaN: ขยับ 111 เมตร ต้องเขียน (ใช้ค่าเริ่มต้น 20)');
    ok(shouldWriteTrack(prev, { ...still, speed_kmh: 'เร็ว' }).write === false,
      'speed เป็นข้อความ ไม่นับว่าเคลื่อนที่ (เดิม "เร็ว" || 0 ก็ยัง false แต่ล็อกไว้กันแก้พลาด)');
    ok(shouldWriteTrack(prev, { ...still, lat: NaN }).reason === 'bad-distance',
      'พิกัดเสีย → บอก bad-distance ไม่ใช่ปนกับ parked');
  }

  section('cutoff ของ archive — กันกวาดทั้งตาราง');
  {
    const repo = makeMemoryRepo();
    await repo.insertTrack({ vehicle_id: 'a', lat: 1, lng: 1, ts: 1000 });
    let threw = false;
    try { await repo.selectTrackOlderThan('abc'); } catch (e) { threw = true; }
    ok(threw, "⭐ cutoff เป็นข้อความต้อง throw — บน D1 จริง `ts < 'abc'` เป็นจริงทุกแถว = กวาดทั้งตารางไปลบ");
    threw = false;
    try { await repo.deleteTrackOlderThan(undefined); } catch (e) { threw = true; }
    ok(threw, 'cutoff undefined ก็ต้อง throw เหมือนกัน');
    ok((await repo.selectTrackOlderThan(Number.MAX_SAFE_INTEGER)).length === 1, 'ข้อมูลยังอยู่ครบ ไม่ถูกลบจากการลองผิด');
  }

  section('index ที่จำเป็นต้องมีจริงในไฟล์ schema/migration');
  {
    const { readFile } = await import('node:fs/promises');
    const schema = await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
    ok(/idx_track_ts[\s\S]*gps_track\s*\(\s*ts\s*\)/.test(schema),
      '⭐ schema มี index บน ts อย่างเดียว (countTrackWritesOn ใช้ช่วง ts — ไม่มี index = สแกนทั้งตารางทุกปิง)');
    const mig = await readFile(new URL('../src/db/migrations/0002_track_ts_index.sql', import.meta.url), 'utf8');
    ok(/CREATE INDEX IF NOT EXISTS idx_track_ts/.test(mig), 'มีไฟล์ migration 0002 จริง (คอมเมนต์ใน repo.js อ้างถึง)');
    const repoSrc = await readFile(new URL('../src/db/repo.js', import.meta.url), 'utf8');
    // ตัดบรรทัดคอมเมนต์ออกก่อน — คอมเมนต์ที่อธิบายบั๊กเก่าไม่ใช่โค้ดที่รัน
    const codeOnly = repoSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(!/date\(ts\s*\/\s*1000/.test(codeOnly),
      '⭐ ไม่เหลือ query แบบ date(ts/1000,...) ที่ใช้ index ไม่ได้ (กินโควตาอ่าน D1 5 ล้านแถว/ครั้ง)');
    ok(/ts\s*>=\s*\?\s*AND\s*ts\s*<\s*\?/.test(codeOnly), 'query นับ write ใช้ช่วง ts (ใช้ index ได้)');
  }

  // สรุป
  console.log('\n==============================');
  console.log(`ผ่าน ${pass} · ตก ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('เทสพังกลางทาง:', e);
  console.log(`ผ่าน ${pass} · ตก ${fail + 1}`);
  process.exit(1);
});
