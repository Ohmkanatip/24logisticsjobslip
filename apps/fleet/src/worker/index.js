// Worker หลักของระบบติดตามรถ — ⚠️ โครงรอเท่านั้น ห้าม deploy จนเจ้าของเคาะ
// ไม่มี CARTRACK_API_KEY = โหมด mock ทั้งระบบ (mock feed + memory repo · ตอบ mock:true ให้หน้าเว็บขึ้นแบนเนอร์)
// wrangler.jsonc มี rules Text ให้ import ไฟล์ .html เป็นข้อความได้

import mapHtml from '../public/map.html';
import { makeMemoryRepo, makeD1Repo } from '../db/repo.js';
import { processPing } from './ingest.js';
import { makeInitialState, tick, toPings } from '../mock/feed.js';
import { archiveOldTracks } from '../archive/r2Archive.js';
import { ingestAuthorized, mapConfigOf } from './api.js';

// เก็บ track สดใน D1 กี่วันก่อน archive ขึ้น R2 (ตามสเปก 60 วัน)
const TRACK_KEEP_DAYS = 60;

// สถานะ mock ระดับโมดูล — อยู่ได้ตลอดอายุ isolate (พอสำหรับโหมดทดลอง ไม่ใช่ของจริง)
let mockState = null;
let mockRepo = null;
let mockLastMs = 0;

function isMockMode(env) {
  return !env.CARTRACK_API_KEY; // ไม่มี key จริง = mock
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// เดิน mock feed ตามเวลาจริงที่ผ่านไป — ชั้นนอกใช้ Date.now() ได้ (logic ข้างในยัง pure)
async function advanceMock(nowMs, thresholdM) {
  if (!mockState) {
    mockState = makeInitialState();
    mockRepo = makeMemoryRepo(mockState.vehicles.map((v) => ({ id: v.id, driver_name: v.driver_name })));
    mockLastMs = nowMs;
  }
  const dtSec = Math.max(0, (nowMs - mockLastMs) / 1000);
  mockState = tick(mockState, dtSec);
  mockLastMs = nowMs;

  // ยิงปิง mock เข้า pipeline จริง (movement filter + UPSERT live) — ใช้ของจริงทุกชั้นยกเว้นแหล่งข้อมูล
  const liveRows = await mockRepo.getLiveAll();
  const prevMap = new Map(liveRows.map((r) => [r.vehicle_id, r]));
  for (const ping of toPings(mockState, nowMs)) {
    await processPing(mockRepo, prevMap.get(ping.vehicle_id) || null, ping, { thresholdM });
  }
}

// GET /api/fleet/live — ตำแหน่งล่าสุด + งานของแต่ละคัน
async function liveHandler(env) {
  const thresholdM = Number(env.MOVE_THRESHOLD_M || 20);

  if (isMockMode(env)) {
    await advanceMock(Date.now(), thresholdM);
    const live = await mockRepo.getLiveAll();
    const meta = new Map(mockState.vehicles.map((v) => [v.id, v]));
    const vehicles = live.map((r) => {
      const m = meta.get(r.vehicle_id) || {};
      return { ...r, driver_name: m.driver_name || null, status: m.status || 'ว่าง', job: m.job || null };
    });
    return json({ mock: true, vehicles });
  }

  // โหมดจริง: อ่าน gps_live + join vehicles + job_assignment ที่ยังไม่จบงาน
  const rs = await env.DB.prepare(
    `SELECT l.vehicle_id, l.lat, l.lng, l.speed_kmh, l.heading, l.updated_at,
            v.driver_name,
            j.job_id, j.container_no, j.origin, j.destination, j.status AS job_status
     FROM gps_live l
     LEFT JOIN vehicles v ON v.id = l.vehicle_id
     LEFT JOIN (
       -- เอาเฉพาะงานล่าสุดที่ยังไม่จบ 1 งานต่อคัน — รถที่มีงานค้างหลายงานต้องไม่กลายเป็นหลาย marker
       SELECT j1.* FROM job_assignment j1
       WHERE j1.status != 'done'
         AND j1.assigned_at = (SELECT MAX(j2.assigned_at) FROM job_assignment j2
                               WHERE j2.vehicle_id = j1.vehicle_id AND j2.status != 'done')
     ) j ON j.vehicle_id = l.vehicle_id`
  ).all();
  const vehicles = (rs.results || []).map((r) => ({
    vehicle_id: r.vehicle_id,
    lat: r.lat, lng: r.lng, speed_kmh: r.speed_kmh, heading: r.heading, updated_at: r.updated_at,
    driver_name: r.driver_name || null,
    // สถานะจริงจาก Cartrack ยังไม่มี — เดาอย่างซื่อสัตย์จากความเร็ว+งาน
    status: r.speed_kmh > 0 ? 'กำลังวิ่ง' : (r.job_id ? 'กำลังวิ่ง' : 'ว่าง'),
    job: r.job_id
      ? { job_id: r.job_id, container_no: r.container_no, origin: r.origin, destination: r.destination, status: r.job_status }
      : null,
  }));
  return json({ mock: false, vehicles });
}

// POST /api/fleet/ingest — รับ ping array แล้วส่งเข้า processPing ทีละจุด
// body: [{vehicle_id, lat, lng, speed_kmh, heading, ts}] หรือ {pings:[...]}
async function ingestHandler(request, env) {
  // ด่านกันคนนอกยิงปิงปลอม (ตัวตรวจอิสระเจอ 28 ส.ค. 2569):
  // ตั้ง INGEST_TOKEN เมื่อไหร่ = ทุก request ต้องแนบ Authorization: Bearer <token> ให้ตรง
  // โหมด mock ในเครื่อง (ไม่ตั้ง token) ยังลองเล่นได้สะดวกเหมือนเดิม — แต่ก่อนใช้จริงต้องตั้งเสมอ
  if (!ingestAuthorized(request, env)) return json({ ok: false, reason: 'unauthorized' }, 401);
  const body = await request.json().catch(() => null);
  const pings = Array.isArray(body) ? body : body && Array.isArray(body.pings) ? body.pings : null;
  if (!pings) return json({ ok: false, reason: 'bad-body', hint: 'ต้องเป็น array ของ ping หรือ {pings:[...]}' }, 400);

  const thresholdM = Number(env.MOVE_THRESHOLD_M || 20);
  const repo = isMockMode(env) ? (await advanceMock(Date.now(), thresholdM), mockRepo) : makeD1Repo(env.DB);

  const liveRows = await repo.getLiveAll();
  const prevMap = new Map(liveRows.map((r) => [r.vehicle_id, r]));
  const results = [];
  for (const ping of pings) {
    if (!ping || !ping.vehicle_id || !Number.isFinite(ping.lat) || !Number.isFinite(ping.lng) || !Number.isFinite(ping.ts)) {
      results.push({ ok: false, reason: 'bad-ping' });
      continue;
    }
    const r = await processPing(repo, prevMap.get(ping.vehicle_id) || null, ping, { thresholdM });
    // อัปเดต prev ในหน่วยความจำ กันปิงคันเดียวกันหลายจุดในชุดเดียวเทียบกับจุดเก่าผิดตัว
    prevMap.set(ping.vehicle_id, { vehicle_id: ping.vehicle_id, lat: ping.lat, lng: ping.lng });
    results.push({ ok: true, ...r });
  }
  return json({ ok: true, mock: isMockMode(env), results });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '/map') {
        return new Response(mapHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      if (url.pathname === '/api/fleet/live' && request.method === 'GET') {
        return await liveHandler(env);
      }
      if (url.pathname === '/api/fleet/mapconfig' && request.method === 'GET') {
        return json(mapConfigOf(env));
      }
      if (url.pathname === '/api/fleet/ingest' && request.method === 'POST') {
        return await ingestHandler(request, env);
      }
      return json({ ok: false, reason: 'not-found' }, 404);
    } catch (e) {
      return json({ ok: false, reason: 'error', detail: String((e && e.message) || e) }, 500);
    }
  },

  // ตัวเรียก job สำรอง R2 (ตัวตรวจอิสระเจอว่า archiveOldTracks ไม่มีคนเรียก 28 ส.ค. 2569)
  // ทำงานก็ต่อเมื่อเปิด cron ใน wrangler.jsonc (ตอนนี้คอมเมนต์ไว้ — ห้าม deploy จนเจ้าของเคาะ)
  // โหมด mock ไม่มี D1/R2 จริง = ข้ามเงียบๆ ไม่พัง
  async scheduled(event, env, ctx) {
    if (isMockMode(env) || !env.DB || !env.ARCHIVE) return;
    const cutoffTs = Date.now() - TRACK_KEEP_DAYS * 24 * 60 * 60 * 1000;
    const repo = makeD1Repo(env.DB);
    ctx.waitUntil(archiveOldTracks(repo, env.ARCHIVE, cutoffTs));
  },
};
