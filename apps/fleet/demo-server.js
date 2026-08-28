// demo server — ⭐ ทางที่เจ้าของเห็นแผนที่ได้ทันที ไม่ต้องมี wrangler/key ใดๆ
// รัน: node demo-server.js → เปิด http://localhost:8787
// ใช้ mock feed + memory repo ผ่าน pipeline จริง (processPing) — โค้ดชั้นนี้เป็น "ชั้นนอก"
// จึงใช้เวลาเครื่อง (Date.now) ได้ ตามกติกา: logic ข้างในรับ timestamp เป็นพารามิเตอร์เท่านั้น

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { makeMemoryRepo } from './src/db/repo.js';
import { processPing } from './src/worker/ingest.js';
import { makeInitialState, tick, toPings } from './src/mock/feed.js';

const PORT = 8787;
const THRESHOLD_M = Number(process.env.MOVE_THRESHOLD_M || 20);

// สถานะ mock ของ demo — เดินตามเวลาจริงที่ผ่านไประหว่าง request
let state = makeInitialState();
let lastMs = Date.now();
const repo = makeMemoryRepo(state.vehicles.map((v) => ({ id: v.id, driver_name: v.driver_name })));

async function advance(nowMs) {
  const dtSec = Math.max(0, (nowMs - lastMs) / 1000);
  state = tick(state, dtSec);
  lastMs = nowMs;
  const liveRows = await repo.getLiveAll();
  const prevMap = new Map(liveRows.map((r) => [r.vehicle_id, r]));
  for (const ping of toPings(state, nowMs)) {
    await processPing(repo, prevMap.get(ping.vehicle_id) || null, ping, { thresholdM: THRESHOLD_M });
  }
}

async function liveJson() {
  await advance(Date.now());
  const live = await repo.getLiveAll();
  const meta = new Map(state.vehicles.map((v) => [v.id, v]));
  const vehicles = live.map((r) => {
    const m = meta.get(r.vehicle_id) || {};
    return { ...r, driver_name: m.driver_name || null, status: m.status || 'ว่าง', job: m.job || null };
  });
  return { mock: true, vehicles };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/' || url.pathname === '/map') {
      const html = await readFile(new URL('./src/public/map.html', import.meta.url), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname === '/api/fleet/mapconfig') {
      // demo ไม่มี env จริง — ตอบแบบ leaflet ตรงๆ (โครงเดียวกับ worker จริง)
      const { mapConfigOf } = await import('./src/worker/api.js');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(mapConfigOf(process.env)));
      return;
    }
    if (url.pathname === '/api/fleet/live') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(await liveJson()));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, reason: 'not-found' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, reason: 'error', detail: String((e && e.message) || e) }));
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('🧪 demo แผนที่ติดตามรถ (โหมด mock — ไม่มีข้อมูลจริง)');
  console.log(`   เปิดเบราว์เซอร์ที่ → http://localhost:${PORT}`);
  console.log('   หยุดเซิร์ฟเวอร์: กด Ctrl+C');
  console.log('');
});
