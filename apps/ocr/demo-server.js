// 🎬 หน้าลองเล่น OCR อ่านเบอร์ตู้ — รันในเครื่อง ไม่ต้องมี LINE / ไม่ต้องมี API key
//
//   node demo-server.js   →   เปิด http://localhost:8790
//
// ⚠️ สำคัญ: หน้านี้ **ใช้โค้ดจริงทุกชั้น** ไม่ได้จำลองผลลัพธ์
//    เช็คดิจิต ISO 6346 · การดึงเบอร์จากข้อความ · flow ของบอท · ตารางพักผล — ของจริงหมด
//    จำลองแค่ 2 อย่าง: (1) กล้อง/LINE (2) ตัว OCR เอง (พิมพ์เองว่า "AI อ่านได้ว่าอะไร")
//    → ได้ลองทุกเคสที่อยากลอง รวมทั้งเคสที่ AI อ่านผิด ซึ่งของจริงจะเจอแน่นอน

import http from 'node:http';
import { handleEvent } from './src/line/webhook.js';
import { createMockLineClient } from './src/line/client.js';
import { createMockEngine } from './src/ocr/engines/mock.js';
import { makeMemoryStagingRepo } from './src/db/staging.js';
import { chooseWriteback } from './src/writeback/index.js';

const PORT = Number(process.env.PORT || 8790);   // เปลี่ยนได้ด้วย PORT=xxxx node demo-server.js
const staging = makeMemoryStagingRepo();                       // ตารางพักผล (ของจริง แค่เก็บในหน่วยความจำ)
const writeback = chooseWriteback({ WRITEBACK_PROVIDER: 'd1' }, staging);
const chat = [];                                                // ประวัติแชทที่จะโชว์

function push(who, text, buttons) { chat.push({ who, text, buttons: buttons || [] }); }

// ดึงข้อความ + ปุ่มจากสิ่งที่บอทตอบจริง (เก็บใน mock client)
function drainReplies(client) {
  client.calls.filter((c) => c.fn === 'replyMessage').forEach((c) => {
    (c.messages || []).forEach((m) => {
      const btns = (m.quickReply && m.quickReply.items || [])
        .map((it) => ({ label: (it.action && it.action.label) || '', data: (it.action && it.action.data) || '' }));
      push('bot', m.text || '', btns);
    });
  });
  client.calls.length = 0;
}

// คนขับส่งรูป → เดินผ่าน flow จริงของบอท
async function sendPhoto(ocrText) {
  push('driver', '📷 [ส่งรูปตู้]' + (ocrText ? '  —  AI อ่านได้ว่า: "' + ocrText + '"' : ''));
  const client = createMockLineClient();
  await handleEvent(
    { type: 'message', replyToken: 'rt', timestamp: Date.now(), message: { type: 'image', id: 'img' }, source: { userId: 'U-คนขับ' } },
    { lineClient: client, engine: createMockEngine({ rawText: ocrText }), writeback }
  );
  drainReplies(client);
}

// คนขับกดปุ่ม (ยืนยัน / ถ่ายใหม่)
async function pressButton(data, label) {
  push('driver', '👆 กด "' + label + '"');
  const client = createMockLineClient();
  await handleEvent(
    { type: 'postback', replyToken: 'rt', timestamp: Date.now(), postback: { data }, source: { userId: 'U-คนขับ' } },
    { lineClient: client, engine: createMockEngine({ rawText: '' }), writeback }
  );
  drainReplies(client);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    if (url.pathname === '/api/state') {
      return json({ chat, staged: await staging.listResults({ status: 'all' }) });
    }
    if (url.pathname === '/api/photo') {
      await sendPhoto(url.searchParams.get('text') || '');
      return json({ ok: true });
    }
    if (url.pathname === '/api/press') {
      await pressButton(url.searchParams.get('data') || '', url.searchParams.get('label') || '');
      return json({ ok: true });
    }
    if (url.pathname === '/api/pull') {
      const r = await staging.markPulled(Number(url.searchParams.get('id')), 'ธุรการ (จำลอง)', Date.now());
      return json(r);
    }
    if (url.pathname === '/api/reset') { chat.length = 0; return json({ ok: true }); }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log('🎬 หน้าลองเล่น OCR: http://localhost:' + PORT);
  console.log('   (ใช้โค้ดจริงทุกชั้น · ไม่ต้องมี LINE / API key · Ctrl+C เพื่อหยุด)');
});

const PAGE = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ลองเล่น OCR อ่านเบอร์ตู้ — 24 Logistics</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Taviraj:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0d1220;--ink:#f1f4fa;--ink-soft:#a8b2c8;--line:#3b4560;--paper:#181e30;--panel:#1e2438;
  --accent:#5fb5e0;--field:#141a2c;--ok:#4bce8c;--warn:#f0776a;--gold:#e0a565;--line-line:#06c755}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans Thai',sans-serif;font-size:15px;line-height:1.6}
.top{background:var(--paper);border-bottom:1px solid var(--line);padding:12px 18px}
.top h1{font-family:'Taviraj',serif;font-weight:500;font-size:20px;margin:0}
.top p{margin:3px 0 0;color:var(--ink-soft);font-size:12.5px}
.wrap{max-width:1150px;margin:0 auto;padding:18px;display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:900px){.wrap{grid-template-columns:1fr}}
.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.card h2{font-family:'Taviraj',serif;font-weight:500;font-size:16.5px;margin:0;padding:12px 15px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.card .bd{padding:14px 15px}
.hint{color:var(--ink-soft);font-size:12.5px;margin:0 0 12px}
.chat{background:#8fa5c0;border-radius:10px;padding:12px;min-height:230px;max-height:430px;overflow:auto}
.msg{display:flex;margin-bottom:9px}
.msg.d{justify-content:flex-end}
.bub{max-width:82%;padding:8px 12px;border-radius:14px;font-size:13.5px;white-space:pre-wrap;word-break:break-word;line-height:1.55}
.msg.d .bub{background:var(--line-line);color:#04340f;border-bottom-right-radius:4px}
.msg.b .bub{background:#fff;color:#16202e;border-bottom-left-radius:4px}
.qr{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.qr button{background:#fff;border:1.5px solid var(--line-line);color:#04340f;border-radius:99px;
  padding:5px 12px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.qr button:hover{background:#e8fbef}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
input,select{background:var(--field);border:1px solid var(--line);color:var(--ink);border-radius:8px;
  padding:9px 11px;font:inherit;font-size:13.5px;flex:1 1 200px;min-width:0}
button.act{background:var(--accent);border:0;color:#06222e;border-radius:8px;padding:9px 15px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer}
button.gh{background:var(--field);border:1px solid var(--line);color:var(--ink);font-weight:500}
.preset{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
.preset button{background:var(--field);border:1px solid var(--line);color:var(--ink-soft);border-radius:7px;
  padding:5px 10px;font:inherit;font-size:11.5px;cursor:pointer;text-align:left}
.preset button:hover{border-color:var(--accent);color:var(--ink)}
.preset b{color:var(--ink);font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{border-bottom:1px solid var(--line);padding:8px 9px;text-align:left;vertical-align:middle}
th{color:var(--ink-soft);font-size:11px;font-weight:600}
tr:last-child td{border-bottom:0}
.st{font-size:10.5px;font-weight:700;border-radius:5px;padding:2px 8px;white-space:nowrap}
.st.c{background:rgba(224,165,101,.16);color:var(--gold)}
.st.p{background:rgba(75,206,140,.16);color:var(--ok)}
.mono{font-family:ui-monospace,monospace;font-size:13px}
.empty{color:var(--ink-soft);font-size:12.5px;padding:16px;text-align:center}
.pull{background:var(--ok);border:0;color:#06210f;border-radius:6px;padding:4px 10px;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}
.note{background:rgba(95,181,224,.10);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;
  padding:11px 14px;font-size:13px;margin:0 18px 18px;max-width:1150px}
.note b{display:block;margin-bottom:3px}
.wrap2{max-width:1150px;margin:0 auto}
</style></head><body>
<div class="top">
  <h1>🎬 ลองเล่น OCR อ่านเบอร์ตู้</h1>
  <p>ใช้โค้ดจริงทุกชั้น (เช็คดิจิต · flow บอท · ตารางพักผล) — จำลองแค่กล้องกับตัว AI · ไม่ต้องมี LINE ไม่ต้องมี key</p>
</div>
<div class="wrap">
  <div class="card">
    <h2>📱 หน้าจอคนขับ <span style="font-size:11.5px;color:var(--ink-soft);font-weight:400">(จำลองแชท LINE)</span></h2>
    <div class="bd">
      <p class="hint">พิมพ์ว่า “AI อ่านรูปแล้วได้ข้อความว่าอะไร” แล้วกดส่ง — จะได้เห็นว่าบอทตอบอะไรกลับ</p>
      <div class="chat" id="chat"></div>
      <div class="row">
        <input id="txt" placeholder="เช่น CONTAINER CSQU 305438 3" value="CONTAINER CSQU 305438 3">
        <button class="act" onclick="photo()">📷 ส่งรูป</button>
        <button class="act gh" onclick="reset()">ล้างแชท</button>
      </div>
      <div class="preset">
        <button onclick="setT('CONTAINER CSQU 305438 3')"><b>เบอร์ถูกต้อง</b> — ผ่านเช็คดิจิต</button>
        <button onclick="setT('CSQU 305438 4')"><b>อ่านผิด 1 หลัก</b> — ต้องถูกจับได้</button>
        <button onclick="setT('C5QU3054383')"><b>S อ่านเป็น 5</b> — ระบบเสนอตัวซ่อม</button>
        <button onclick="setT('ตู้สกปรกมาก อ่านไม่ออก')"><b>อ่านไม่ออก</b></button>
        <button onclick="setT('MSKU 907032 3 และ TCLU 123456 8')"><b>เจอ 2 เบอร์ในรูป</b></button>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>🏢 หน้าจอออฟฟิศ <span style="font-size:11.5px;color:var(--ink-soft);font-weight:400">(ผลที่รอดึงเข้าใบงาน)</span></h2>
    <div class="bd">
      <p class="hint">บอท<b>ไม่แตะชีทเลย</b> — ผลที่คนขับยืนยันจะมาพักตรงนี้ รอออฟฟิศกดดึงไปใส่ใบงานเอง</p>
      <div id="tb"></div>
    </div>
  </div>
</div>
<div class="wrap2"><div class="note"><b>ลองอะไรได้บ้าง</b>
  ① กดปุ่มตัวอย่างด้านล่างช่องพิมพ์ แล้วกด <b>📷 ส่งรูป</b> · ② ดูว่าบอทตอบอะไร แล้วกดปุ่มในแชทได้เลย ·
  ③ พอกดยืนยัน ผลจะโผล่ฝั่งขวา · ④ กด <b>ดึงเข้าใบงาน</b> แล้วลองกดซ้ำ — ระบบต้องปฏิเสธ (กันเบอร์เดียวไป 2 ใบ)
</div></div>
<script>
function setT(v){ document.getElementById('txt').value=v; }
async function photo(){ await fetch('/api/photo?text='+encodeURIComponent(document.getElementById('txt').value)); draw(); }
async function press(d,l){ await fetch('/api/press?data='+encodeURIComponent(d)+'&label='+encodeURIComponent(l)); draw(); }
async function pull(id){ const r=await(await fetch('/api/pull?id='+id)).json(); if(!r.ok) alert('ดึงไม่ได้: '+(r.reason==='already-pulled'?('มีคนดึงไปแล้ว ('+r.pulledBy+')'):r.reason)); draw(); }
async function reset(){ await fetch('/api/reset'); draw(); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
async function draw(){
  const s=await(await fetch('/api/state')).json();
  document.getElementById('chat').innerHTML = s.chat.length ? s.chat.map(function(m){
    const qr = m.buttons.length ? '<div class="qr">'+m.buttons.map(function(b){
      return '<button onclick="press(\\''+esc(b.data).replace(/'/g,"\\\\'")+'\\',\\''+esc(b.label).replace(/'/g,"\\\\'")+'\\')">'+esc(b.label)+'</button>'; }).join('')+'</div>' : '';
    return '<div class="msg '+(m.who==='driver'?'d':'b')+'"><div class="bub">'+esc(m.text)+qr+'</div></div>';
  }).join('') : '<div style="color:#33455e;font-size:12.5px;text-align:center;padding:24px">ยังไม่มีข้อความ — กด “📷 ส่งรูป” เพื่อเริ่ม</div>';
  const c=document.getElementById('chat'); c.scrollTop=c.scrollHeight;
  document.getElementById('tb').innerHTML = s.staged.length
    ? '<table><tr><th>เบอร์ตู้</th><th>คนยืนยัน</th><th>สถานะ</th><th></th></tr>'+s.staged.map(function(r){
        return '<tr><td class="mono"><b>'+esc(r.container_no)+'</b></td><td>'+esc(r.confirmed_by||'-')+'</td>'
          +'<td><span class="st '+(r.status==='pulled'?'p':'c')+'">'+(r.status==='pulled'?'ดึงแล้ว · '+esc(r.pulled_by||''):'รอออฟฟิศดึง')+'</span></td>'
          +'<td>'+(r.status==='pulled'?'':'<button class="pull" onclick="pull('+r.id+')">ดึงเข้าใบงาน</button>')+'</td></tr>'; }).join('')+'</table>'
    : '<div class="empty">ยังไม่มีผลที่ยืนยัน — ลองส่งรูปแล้วกดยืนยันในแชทฝั่งซ้าย</div>';
}
draw();
</script></body></html>`;
