# CLAUDE.md — repo 24logisticsjobslip (โครง monorepo)

> ไฟล์นี้คุมขอบเขตงานใน repo นี้ · กติกา/ประวัติฉบับเต็มอยู่ที่ `~/Documents/24 Logistics/CLAUDE.md` (อ่านอัตโนมัติทุก session อยู่แล้ว)

## ขอบเขตงาน (สำคัญ)

- **ไฟล์ production (ระบบใบงาน/วางบิล) อยู่ที่ root เดิม: `index.html` + `logo.png` — ห้ามแก้ ห้ามย้าย** เว้นแต่สั่งตรงและมีทาง rollback (ย้าย path = GitHub Pages/Apps Script พังทันที)
- งานใหม่ทั้งหมดทำใต้ `apps/` เท่านั้น (`apps/fleet`, `apps/ocr`) — แต่ละตัวมี `CLAUDE.md` ของตัวเอง **อ่านก่อนทำ**
- **ห้าม dependency/ไฟล์ของ apps/ ปนเข้าโค้ด production เดิม**
- งานใหม่อยู่บน branch แยก (`feat/fleet`, `feat/ocr`) — **ยังไม่ merge เข้า main** จนกว่าเจ้าของสั่ง
- `docs/` และ `apps/` ถูก gitignore บน main **โดยตั้งใจ** — repo เป็น public + Pages เสิร์ฟทุกไฟล์บน main · เหตุผลเต็มใน `docs/README.md` · ห้ามเอาออกจาก .gitignore

## โครง

```
24logisticsjobslip/
├── index.html + logo.png        ← production (main · GitHub Pages)
├── 24logistics.code-workspace   ← เปิดด้วย VS Code เห็น 4 โปรเจกต์
├── apps/
│   ├── fleet/                   ← แผนที่+GPS (Cloudflare Worker/D1/R2) · branch feat/fleet
│   └── ocr/                     ← OCR เบอร์ตู้ (LINE bot/LIFF + Worker) · branch feat/ocr
└── docs/                        ← สเปก/พร้อมพ์ (ในเครื่องเท่านั้น ไม่ push)
```

## คิวงานจริง (ตามแผนแม่บท `docs/24LOGISTICS-MASTER-SPEC.md`)

- fleet/ocr ตอนนี้เป็น **โครงรอ (scaffold)** — mock-first ทุกอย่างรันได้โดยไม่มี key จริง · **ห้าม deploy**
- ก่อนลงมือจริงต้องรอเจ้าของเคาะ: OCR engine · map provider · สถาปัตยกรรมเขียนเบอร์ตู้กลับใบงาน (ดู `apps/ocr/ARCHITECTURE-OPTIONS.md`)
