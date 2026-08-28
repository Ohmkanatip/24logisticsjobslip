# SETUP — วางงานใหม่ใน repo เดิม แบบแยกโปรเจกต์ (monorepo + multi-root)

> เป้าหมาย: อยู่ใน repo `24logisticsjobslip` ที่เดียว แต่ OCR และแผนที่/GPS เป็นโปรเจกต์อิสระใต้ `apps/` — deploy/รัน/ทดสอบแยกกัน ไม่ปนกับ production V63.7

---

## หลักการ

- **ระบบเดิม (V63.7) อยู่ที่เดิม ห้ามย้าย/ห้ามแตะ** — ย้าย path = เสี่ยง GitHub Pages/Apps Script พัง
- งานใหม่ทั้งหมดอยู่ใต้ `apps/` แต่ละตัวมี `package.json` + `wrangler.jsonc` + `CLAUDE.md` ของตัวเอง
- เปิด VS Code แบบ **multi-root workspace** → เห็นเป็นหลายโปรเจกต์แยกกันในหน้าต่างเดียว

## โครงที่ต้องสร้าง

```
24logisticsjobslip/
├── (production V63.7 เดิม — ไม่แตะ)
├── CLAUDE.md                 ← เดิม + เพิ่มบล็อกกติกาด้านล่าง
├── apps/
│   ├── fleet/                ← แผนที่ + GPS (Worker/D1/Pages)
│   │   ├── package.json
│   │   ├── wrangler.jsonc
│   │   ├── CLAUDE.md
│   │   ├── src/
│   │   │   ├── worker/        (endpoint /api/fleet/live, ingest, haversine)
│   │   │   ├── map/           (MapProvider interface + adapters: leaflet/longdo/google/mapbox)
│   │   │   ├── db/            (D1 schema, migrations)
│   │   │   ├── archive/       (job สำรอง gps_track >60วัน → R2)
│   │   │   └── mock/          (mock GPS feed)
│   │   └── tests/
│   └── ocr/                  ← OCR (LINE bot/LIFF + Worker)
│       ├── package.json
│       ├── wrangler.jsonc
│       ├── CLAUDE.md
│       ├── src/
│       │   ├── worker/        (OCR endpoint, เรียก engine, เขียนกลับใบงาน)
│       │   ├── iso6346/       (เช็คดิจิต ISO 6346)
│       │   ├── line/          (chat webhook + LIFF)
│       │   └── ocr/           (engine adapter: qwen/vision/typhoon — สลับได้)
│       └── tests/
└── docs/
    ├── 24LOGISTICS-MASTER-SPEC.md
    ├── PROMPT-OCR-เบอร์ตู้.md
    └── PROMPT-แผนที่-GPS-scaffold.md
```

## ไฟล์ `24logistics.code-workspace` (วางที่ root)

```jsonc
{
  "folders": [
    { "name": "① PRODUCTION (V63.7 — อย่าแตะ)", "path": "." },
    { "name": "② Fleet Map + GPS", "path": "apps/fleet" },
    { "name": "③ OCR (LINE/LIFF)", "path": "apps/ocr" },
    { "name": "④ Docs", "path": "docs" }
  ],
  "settings": {
    "files.exclude": { "apps": false },
    "search.exclude": { "**/node_modules": true, "**/dist": true, "**/.next": true }
  }
}
```
> เปิดไฟล์นี้ใน VS Code (File → Open Workspace from File) → เห็น 4 โปรเจกต์แยกในหน้าต่างเดียว แต่ละอันมี terminal/settings ของตัวเอง Claude Code ยังเห็นบริบทรวม

## บล็อกที่ต้องเพิ่มใน root `CLAUDE.md`

```md
## ขอบเขตงาน (สำคัญ)
- ไฟล์ production V63.7 (ระบบใบงาน/วางบิล) อยู่ที่ root เดิม — **ห้ามแก้ ห้ามย้าย** เว้นแต่สั่งตรงและมี rollback
- งานใหม่ทั้งหมดทำใต้ `apps/` เท่านั้น (`apps/fleet`, `apps/ocr`) — แต่ละตัวมี CLAUDE.md ของตัวเอง อ่านก่อนทำ
- ห้าม dependency/ไฟล์ของ apps/ ปนเข้าโค้ด production เดิม
- ทำงานใหม่บน branch แยก (`feat/fleet`, `feat/ocr`) ยังไม่ merge เข้า main จน production นิ่ง
```

## ลำดับให้ Claude Code ทำ

1. อ่าน root `CLAUDE.md`, `docs/24LOGISTICS-MASTER-SPEC.md`
2. สร้างโครง `apps/fleet` และ `apps/ocr` ตามด้านบน (แต่ละตัว init เป็นโปรเจกต์อิสระ + CLAUDE.md ย่อย)
3. ทำ **mock-first** ตาม `docs/PROMPT-แผนที่-GPS-scaffold.md` และ `docs/PROMPT-OCR-เบอร์ตู้.md`
4. **แต่คิวจริงตามแผน: งาน ① (เชื่อมจ่ายงาน→ใบงาน) ก่อน** — fleet/ocr เป็นโครงรอ ไม่ deploy production

## git

- branch แยกต่องาน: `feat/fleet`, `feat/ocr`
- `.gitignore` ครอบ `apps/**/node_modules`, `apps/**/dist`, `apps/**/.wrangler`
- production เดิมยังอยู่ main ตามปกติ ไม่กระทบ
