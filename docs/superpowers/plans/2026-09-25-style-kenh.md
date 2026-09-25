# Style kênh — Plan triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dán link kênh TikTok/Douyin → phân tích phong cách dựng của 30 video tốt nhất theo 6 lớp (ffmpeg đo số + Gemini tả chất) → tổng hợp bằng code thành Style Profile JSON → tải về skill Claude Code (.zip).

**Architecture:** Module mới `server/style/` độc lập, cùng khuôn với Xưởng (`server/studio/`): config đọc env một lần, bảng riêng, hàng đợi riêng poll 3 s claim nguyên tử, engine cắm-rút (Gemini thật / fake cho test), router mỏng mount ở `/api/style`. Tái dùng `account.ts` (resolve + fetch kênh), `tiktok.ts`/`douyin.ts` (tải video), `studio/ffmpeg.ts` (chạy ffmpeg), `auth.ts` (`requireEditor`). Frontend là thư mục `src/style/` riêng, `App.tsx` chỉ đăng ký tab.

**Tech Stack:** Node 22 + tsx, Express 4, sqlite3, `@google/genai` 1.52 (`videoMetadata.fps`), ffmpeg (system trong Docker / ffmpeg-static local), `fflate` (zip thuần JS), React 18 + Vite, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-25-style-kenh-design.md`

## Global Constraints

- Chạy test bằng **Node 22**: `nvm use 22` trước mọi lệnh `npm test` (nvm mặc định là 20, `node --test` không nhận glob ở Node 20).
- Mọi `assert.ok(...)` PHẢI kèm message (assert.ok fail không message làm tsx treo CPU 100 %).
- Không thêm dependency native. Thư viện mới duy nhất: `fflate`.
- Mọi ngưỡng/model/thư mục nằm trong `server/style/config.ts`, đọc từ env, có mặc định (spec §4, §6).
- Enum cố định đặt trong `server/style/types.ts`; validator sửa về mặc định + `warnings[]`, không throw (spec §5).
- Số trong SKILL.md lấy thẳng từ JSON bằng code; Gemini chỉ viết 3 đoạn văn (spec §7).
- Quyền: `requireEditor`; owner-scoping (Quản trị xem tất cả) (spec §2).
- Commit sau mỗi task, message tiếng Việt, prefix `feat(style):` / `test(style):`, kết bằng dòng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Đính chính so với spec §8:** hàng đợi style là hàng đợi RIÊNG (`server/style/queue.ts`, khuôn `studio/queue.ts`), KHÔNG chèn `if` vào `queue.ts` của mổ xẻ — vì `queue.ts` poll bảng `history`, còn phiếu style nằm ở `style_videos`. Kết quả cho người dùng không đổi (nền, resume sau restart).

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `server/style/config.ts` | `STYLE` — env, ngưỡng, model, thư mục tạm |
| `server/style/types.ts` | enum + type: `StyleMeasure`, `StyleAnalysis`, `StyleTimelineShot`, `StyleProfile`, `PickedVideo` |
| `server/style/db.ts` | `initStyleTables()` |
| `server/style/store.ts` | CRUD `style_profiles` / `style_videos` |
| `server/style/pick.ts` | `pickStyleVideos()` — top 30 view / 90 ngày, nới dần, 5 mẫu chuẩn |
| `server/style/measure.ts` | ffmpeg: cuts, loudness, màu, loop, frames; hàm parse thuần |
| `server/style/validate.ts` | `validateStyle()`, `validateTimeline()` |
| `server/style/analyze.ts` | `StyleEngine` (gemini / fake): `analyze`, `timeline`, `cluster`, `narrate`; prompt builder |
| `server/style/aggregate.ts` | `aggregateProfile()` — thống kê, hard/soft/never, outlier |
| `server/style/skill.ts` | `buildSkillMd()`, `buildTimelinesMd()`, `buildFormulasMd()` |
| `server/style/zip.ts` | `buildSkillZip()` bằng fflate |
| `server/style/pipeline.ts` | `runStyleVideo()`, `finalizeProfileIfDone()`, `recoverStyleInterrupted()` |
| `server/style/queue.ts` | `bootStyleQueue()`, `startStyleQueue()`, `stopStyleQueue()` |
| `server/style/routes.ts` | `makeStyleRouter(deps)` |
| `server/index.ts` | mount router, init bảng, boot queue |
| `src/style/styleApi.ts`, `src/style/StyleView.tsx`, `src/style/PickForm.tsx`, `src/style/ProgressPanel.tsx`, `src/style/ProfileView.tsx` | UI |
| `src/App.tsx` | đăng ký tab `style` (nav desktop, nav mobile, titles, render) |
| `scripts/deploy-videoana.sh`, `docker-compose.yml` | deploy rsync + mount `/data` |

---

### Task 1: Khung module — config, types, bảng, test runner

**Files:**
- Create: `server/style/config.ts`, `server/style/types.ts`, `server/style/db.ts`, `server/style/db.test.ts`
- Modify: `package.json` (script `test`, dependency `fflate`)

**Interfaces:**
- Produces: `STYLE` (config), toàn bộ enum/type dùng ở các task sau, `initStyleTables()`.

- [ ] **Step 1: Cài fflate + mở rộng glob test**

```bash
cd ~/videoana && nvm use 22 && npm i fflate@^0.8.3
```

Sửa `package.json` dòng `"test"` — thêm glob style và env engine fake:

```json
"test": "cross-env DB_PATH=:memory: STUDIO_DATA_DIR=./data/test-studio STUDIO_ENGINE_IMAGE=fake STUDIO_ENGINE_VIDEO=fake STUDIO_ENGINE_VOICE=fake STYLE_ENGINE=fake STYLE_TMP_DIR=./data/test-style node --import tsx --test \"server/studio/**/*.test.ts\" \"server/style/**/*.test.ts\"",
```

- [ ] **Step 2: Viết `server/style/types.ts`**

```ts
/**
 * server/style/types.ts — enum + type của module Style kênh. Enum cố định để bước tổng hợp đếm được.
 * Trường text tự do đánh dấu (*) trong spec §5 là string thường.
 */
export const HOOK_TYPES = ["text-big", "question", "curiosity-scene", "result-first", "talk-direct", "other"] as const;
export const LAYOUTS = ["hook-problem-content-cta", "vlog", "list", "story", "other"] as const;
export const TRANSITIONS = ["hard", "zoom", "whip", "jump", "match", "fade", "other"] as const;
export const CUT_SYNCS = ["beat", "speech", "none"] as const;
export const SHOOTINGS = ["static", "handheld", "mixed"] as const;
export const ANGLES = ["eye", "low", "high"] as const;
export const SHOT_SIZES = ["ECU", "CU", "MCU", "MS", "FS", "WS"] as const;
export const FRAMES = ["none", "border", "split", "pip"] as const;
export const TONES = ["warm", "cool", "neutral"] as const;
export const LEVELS = ["low", "mid", "high"] as const;
export const QUALITIES = ["clean", "raw", "grainy"] as const;
export const CAPTION_STYLES = ["word-pop", "sentence", "none"] as const;
export const WEIGHTS = ["regular", "bold", "black"] as const;
export const SIZE_RELS = ["small", "med", "large"] as const;
export const POSITIONS = ["top-third", "center", "lower-third", "bottom", "varies"] as const;
export const HIGHLIGHTS = ["color", "emoji", "icon", "none"] as const;
export const STICKERS = ["arrow", "circle", "meme", "lower-third", "emoji", "other"] as const;
export const ANIMS = ["pop", "bounce", "typewriter", "fade", "none"] as const;
export const MUSIC_SOURCES = ["trending", "original", "none"] as const;
export const LEVEL_VS = ["under", "equal", "over"] as const;
export const VOICE_MODES = ["direct", "voiceover", "tts", "none"] as const;
export const GENDERS = ["male", "female", "mixed"] as const;
export const PACES = ["slow", "normal", "fast"] as const;
export const SFX_TYPES = ["whoosh", "ding", "pop", "boom", "other"] as const;
export const DENSITIES = ["none", "sparse", "dense"] as const;
export const GENRES = ["review", "compare", "story", "pov", "tutorial", "unbox", "comedy", "other"] as const;
export const PERSONAS = ["friendly", "expert", "sassy", "serious", "other"] as const;
export const PRESENTATIONS = ["handheld", "macro", "before-after", "demo", "none"] as const;
export const WATERMARK_POS = ["top-left", "top-right", "bottom-left", "bottom-right", "center", "none"] as const;

type E<T extends readonly string[]> = T[number];

export interface StyleMeasure {
  duration: number | null; width: number | null; height: number | null; aspect: string | null; fps: number | null;
  cuts: number[]; cutsPerMin: number | null; medianShotLen: number | null; shotLenP10: number | null; shotLenP90: number | null; cutsIn3s: number | null;
  loudness: { integratedLufs: number | null; first3sLufs: number | null };
  silenceStart: number | null;
  color: { y: number; u: number; v: number; saturation: number; contrast: number; tone: E<typeof TONES>; saturationLevel: E<typeof LEVELS>; contrastLevel: E<typeof LEVELS> } | null;
  loopLikely: boolean | null;
  frames: string[]; // data-URL JPEG
}

export interface StyleAnalysis {
  structure: { hookType: E<typeof HOOK_TYPES>; hookText: string; hookVisual: string; layout: E<typeof LAYOUTS>; hasLoop: boolean;
    transitions: { at: number; type: E<typeof TRANSITIONS> }[]; cutSync: E<typeof CUT_SYNCS> };
  visual: { shooting: E<typeof SHOOTINGS>; angles: E<typeof ANGLES>[]; shotSizes: E<typeof SHOT_SIZES>[]; talkingHeadRatio: number; brollRatio: number;
    punchIn: boolean; frame: E<typeof FRAMES>; grade: { tone: E<typeof TONES>; saturation: E<typeof LEVELS>; contrast: E<typeof LEVELS>; preset: string }; quality: E<typeof QUALITIES> };
  text: { captionStyle: E<typeof CAPTION_STYLES>; font: { family: string; weight: E<typeof WEIGHTS>; sizeRel: E<typeof SIZE_RELS> }; color: string;
    stroke: boolean; shadow: boolean; box: boolean; position: E<typeof POSITIONS>; highlight: E<typeof HIGHLIGHTS>; stickers: E<typeof STICKERS>[];
    animIn: E<typeof ANIMS>; animOut: E<typeof ANIMS> };
  audio: { music: { genre: string; source: E<typeof MUSIC_SOURCES>; levelVsVoice: E<typeof LEVEL_VS> };
    voice: { mode: E<typeof VOICE_MODES>; gender: E<typeof GENDERS>; pace: E<typeof PACES> };
    sfx: { at: number; type: E<typeof SFX_TYPES> }[]; sfxDensity: E<typeof DENSITIES>; beatSync: boolean };
  content: { genre: E<typeof GENRES>; persona: E<typeof PERSONAS>; openingFormula: string; closingFormula: string; cta: string; productPresentation: E<typeof PRESENTATIONS>[] };
  brand: { watermark: { has: boolean; position: E<typeof WATERMARK_POS> }; intro: boolean; outro: boolean; mainColors: string[]; recurringOpeningFrame: boolean };
  notes: { oddities: string[] };
  estimated: boolean;
  warnings: string[];
}

export interface StyleTimelineShot { from: number; to: number; shot: string; textOnScreen: string; textAnim: E<typeof ANIMS>; sfx: string; music: string; voice: string }

export interface PickedVideo { awemeId: string; link: string; title: string; cover: string; views: number; likes: number; createTime: number; isExemplar: boolean }

export interface Stat { median: number; p25: number; p75: number; n: number }
export interface LayerField { value: string; share: number; rule: "hard" | "soft" | "none" }
export interface StyleProfile {
  channel: { platform: string; handle: string; nickname: string; avatar: string };
  analyzedAt: string; model: string;
  videos: { total: number; used: number; failed: number; outliers: { videoId: string; reasons: string[] }[] };
  metrics: { duration: Stat; cutsPerMin: Stat; shotLen: Stat; loudness: Stat; talkingHeadRatio: Stat; brollRatio: Stat };
  layers: Record<"structure" | "visual" | "text" | "audio" | "content" | "brand", Record<string, LayerField>>;
  rules: { hard: string[]; soft: string[]; never: string[] };
  formulas: { opening: Formula[]; closing: Formula[]; cta: Formula[] };
  exemplars: { videoId: string; link: string; views: number; duration: number | null; timeline: StyleTimelineShot[] }[];
  evidence: Record<string, string[]>;
}
export interface Formula { text: string; count: number; examples: string[] }

export interface ProfileRow { id: string; owner: string; platform: string; handle: string; nickname: string; avatar: string; status: "running" | "aggregating" | "done" | "failed";
  picked_ids: string; exemplar_ids: string; profile: string | null; skill_md: string | null; message: string | null; created_at: string; updated_at: string }
export interface VideoRow { id: string; profile_id: string; aweme_id: string; link: string; title: string; cover: string; views: number; likes: number; create_time: number; is_exemplar: number;
  status: "pending" | "processing" | "done" | "failed"; measure: string | null; analysis: string | null; timeline: string | null; frames: string | null; warnings: string | null; error: string | null; updated_at: string }
```

- [ ] **Step 3: Viết `server/style/config.ts`**

```ts
/**
 * server/style/config.ts — cấu hình Style kênh, đọc env một lần. Mọi ngưỡng ở đây (spec §4, §6, §11).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL } from "../nonelabPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const str = (v: string | undefined, d: string) => (v || "").trim() || d;

export const STYLE = {
  model: str(process.env.STYLE_MODEL, str(process.env.GEMINI_MODEL, DEFAULT_MODEL)),
  engine: str(process.env.STYLE_ENGINE, "gemini") as "gemini" | "fake",
  tmpDir: str(process.env.STYLE_TMP_DIR, path.join(__dirname, "..", "..", "data", "style-tmp")),
  concurrency: Math.max(1, num(process.env.STYLE_CONCURRENCY, 4)),
  sceneThreshold: num(process.env.STYLE_SCENE_THRESHOLD, 0.35),
  minVideos: Math.max(1, num(process.env.STYLE_MIN_VIDEOS, 15)),
  pickCount: 30, exemplarCount: 5,
  windowsDays: [90, 180, 365],
  recentDays: 90, oldWeight: 0.5,
  hardShare: 0.7, softShare: 0.4,
  outlierLayers: Math.max(1, num(process.env.STYLE_OUTLIER_LAYERS, 3)),
  fpsShort: 3, fpsLong: 2, fpsTimeline: 5, longVideoSec: 60,
  silenceDb: -35,
  frameCount: 6,
  /** Trường mà 0 % có nghĩa "kênh không bao giờ làm" (spec §6). key = layer.field, value = danh sách giá trị đáng nói. */
  neverFields: {
    "structure.transitions": ["zoom", "whip", "match", "fade"],
    "brand.intro": ["true"], "brand.outro": ["true"],
    "text.stickers": ["arrow", "circle", "meme", "lower-third", "emoji"],
    "visual.frame": ["border", "split", "pip"],
    "text.captionStyle": ["word-pop"],
    "audio.sfxDensity": ["dense"],
    "audio.music.levelVsVoice": ["over"],
    "visual.punchIn": ["true"],
  } as Record<string, string[]>,
};
```

- [ ] **Step 4: Viết test bảng `server/style/db.test.ts`**

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { connectDB, allQuery } from "../db.js";
import { initStyleTables } from "./db.js";

before(async () => { process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); });

test("initStyleTables tạo 2 bảng + index, chạy lại không lỗi", async () => {
  await initStyleTables(); await initStyleTables();
  const names = (await allQuery<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table','index')")).map((r) => r.name);
  assert.ok(names.includes("style_profiles"), "thiếu style_profiles");
  assert.ok(names.includes("style_videos"), "thiếu style_videos");
  assert.ok(names.includes("idx_style_videos_profile"), "thiếu index");
});
```

- [ ] **Step 5: Chạy test, phải FAIL vì chưa có `./db.js`**

```bash
nvm use 22 && npm test -- 2>&1 | tail -5
```
Expected: lỗi `Cannot find module` cho `server/style/db.js`.

- [ ] **Step 6: Viết `server/style/db.ts`**

```ts
/** server/style/db.ts — bảng Style kênh (spec §8). Gọi sau connectDB(). */
import { runQuery } from "../db.js";

export async function initStyleTables() {
  await runQuery(`CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY, owner TEXT, platform TEXT, handle TEXT, nickname TEXT, avatar TEXT,
    status TEXT DEFAULT 'running', picked_ids TEXT, exemplar_ids TEXT,
    profile TEXT, skill_md TEXT, message TEXT, created_at TEXT, updated_at TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS style_videos (
    id TEXT PRIMARY KEY, profile_id TEXT, aweme_id TEXT, link TEXT, title TEXT, cover TEXT,
    views INTEGER, likes INTEGER, create_time INTEGER, is_exemplar INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', measure TEXT, analysis TEXT, timeline TEXT, frames TEXT, warnings TEXT, error TEXT, updated_at TEXT)`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_style_videos_profile ON style_videos(profile_id)`);
  // Migration về sau thêm ở đây, SAU CREATE TABLE (bài học d84e0e6).
}
```

- [ ] **Step 7: Chạy test, phải PASS**

```bash
npm test -- 2>&1 | grep -E "^# (pass|fail)"
```
Expected: `# pass` tăng 1, `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json server/style/config.ts server/style/types.ts server/style/db.ts server/style/db.test.ts
git commit -m "feat(style): khung module Style kênh — config, enum/type, bảng style_profiles/style_videos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Chọn video — `pick.ts`

**Files:**
- Create: `server/style/pick.ts`, `server/style/pick.test.ts`

**Interfaces:**
- Consumes: `AccountVideo` từ `server/account.ts` (`{awemeId, desc, link, createTime, stats:{views, likes}}`), `STYLE.pickCount/exemplarCount/windowsDays`.
- Produces: `pickStyleVideos(videos: AccountVideo[], nowSec: number, opts?: {count?: number; exemplars?: number}): { videos: PickedVideo[]; exemplarIds: string[]; windowDays: number; note: string }`.

- [ ] **Step 1: Viết test `server/style/pick.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickStyleVideos } from "./pick.js";
import type { AccountVideo } from "../account.js";

const DAY = 86400;
const NOW = 1_800_000_000;
const mk = (i: number, daysAgo: number, views: number): AccountVideo => ({
  awemeId: `v${i}`, desc: `video ${i}`, author: "a", nickname: "A", link: `https://www.tiktok.com/@a/video/v${i}`,
  createTime: NOW - daysAgo * DAY, stats: { source: "TikTok", views, likes: views / 10, comments: 1, shares: 1, saves: 1 },
});

test("đủ video trong 90 ngày → lấy top view, 5 mẫu chuẩn là 5 view cao nhất, windowDays=90", () => {
  const vids = Array.from({ length: 60 }, (_, i) => mk(i, (i % 80) + 1, 1000 * (60 - i)));
  const r = pickStyleVideos(vids, NOW);
  assert.equal(r.videos.length, 30);
  assert.equal(r.windowDays, 90);
  assert.equal(r.exemplarIds.length, 5);
  assert.deepEqual(r.exemplarIds, ["v0", "v1", "v2", "v3", "v4"]);
  assert.ok(r.videos.every((v, i, a) => i === 0 || a[i - 1].views >= v.views), "phải xếp giảm dần theo view");
  assert.equal(r.videos.filter((v) => v.isExemplar).length, 5);
});

test("thiếu video trong 90 ngày → nới 180 rồi 365, ghi note", () => {
  const recent = Array.from({ length: 10 }, (_, i) => mk(i, 5, 100));
  const older = Array.from({ length: 25 }, (_, i) => mk(100 + i, 150, 500));
  const r = pickStyleVideos([...recent, ...older], NOW);
  assert.equal(r.windowDays, 180);
  assert.equal(r.videos.length, 30);
  assert.match(r.note, /180 ngày/);
});

test("kênh quá ít video → trả tất cả, windowDays=365, exemplars ≤ số video", () => {
  const r = pickStyleVideos([mk(1, 400, 10), mk(2, 400, 20), mk(3, 2, 5)], NOW);
  assert.equal(r.videos.length, 3);
  assert.equal(r.windowDays, 365);
  assert.equal(r.exemplarIds.length, 3);
});
```

- [ ] **Step 2: Chạy test, phải FAIL (module chưa có)**

```bash
npm test -- 2>&1 | grep -E "pick|Cannot find" | head -3
```

- [ ] **Step 3: Viết `server/style/pick.ts`**

```ts
/**
 * server/style/pick.ts — chọn video để phân tích style (spec §2, §3 bước 1).
 * Top `count` theo view trong cửa sổ 90 ngày; thiếu thì nới 180 → 365; vẫn thiếu thì lấy tất cả.
 * Top `exemplars` view cao nhất trong tập đã chọn = mẫu chuẩn.
 */
import type { AccountVideo } from "../account.js";
import { STYLE } from "./config.js";
import type { PickedVideo } from "./types.js";

export function pickStyleVideos(videos: AccountVideo[], nowSec: number, opts: { count?: number; exemplars?: number } = {}) {
  const count = Math.max(1, opts.count ?? STYLE.pickCount);
  const exemplars = Math.max(1, opts.exemplars ?? STYLE.exemplarCount);
  const byViews = (a: AccountVideo, b: AccountVideo) => (b.stats?.views || 0) - (a.stats?.views || 0);
  let windowDays = STYLE.windowsDays[STYLE.windowsDays.length - 1];
  let pool: AccountVideo[] = [];
  for (const w of STYLE.windowsDays) {
    pool = videos.filter((v) => v.createTime > 0 && nowSec - v.createTime <= w * 86400);
    windowDays = w;
    if (pool.length >= count) break;
  }
  if (pool.length < count) pool = [...videos];
  const chosen = [...pool].sort(byViews).slice(0, count);
  const exemplarIds = chosen.slice(0, Math.min(exemplars, chosen.length)).map((v) => v.awemeId);
  const ex = new Set(exemplarIds);
  const out: PickedVideo[] = chosen.map((v) => ({
    awemeId: v.awemeId, link: v.link, title: String(v.desc || "").slice(0, 120), cover: "",
    views: v.stats?.views || 0, likes: v.stats?.likes || 0, createTime: v.createTime, isExemplar: ex.has(v.awemeId),
  }));
  const note = windowDays === STYLE.windowsDays[0]
    ? `Lấy ${out.length} video view cao nhất trong ${windowDays} ngày gần đây.`
    : `Kênh không đủ ${count} video trong 90 ngày — đã nới cửa sổ lên ${windowDays} ngày (${out.length} video). Video cũ được tính trọng số 0,5 khi tổng hợp.`;
  return { videos: out, exemplarIds, windowDays, note };
}
```

- [ ] **Step 4: Chạy test, phải PASS**

```bash
npm test -- 2>&1 | grep -E "^# (pass|fail)"
```

- [ ] **Step 5: Commit**

```bash
git add server/style/pick.ts server/style/pick.test.ts
git commit -m "feat(style): pickStyleVideos — top 30 view trong 90 ngày, nới dần, 5 mẫu chuẩn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Đo bằng ffmpeg — `measure.ts`

**Files:**
- Create: `server/style/measure.ts`, `server/style/measure.test.ts`

**Interfaces:**
- Consumes: `runFfmpeg(args, {timeoutMs, nice})` và `FFMPEG` từ `server/studio/ffmpeg.ts`; `STYLE.sceneThreshold/silenceDb/frameCount`.
- Produces: `measureVideo(path: string): Promise<StyleMeasure>`; hàm parse thuần: `parseShowinfoTimes(stderr): number[]`, `parseEbur128(stderr): number|null`, `parseSignalstats(stderr): {y,u,v,sat}[]`, `parseSilenceStart(stderr): number|null`, `parseStreamInfo(stderr): {width,height,fps}|null`, `cutStats(cuts, duration)`.

- [ ] **Step 1: Viết test parse + tích hợp `server/style/measure.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "../studio/ffmpeg.js";
import { parseShowinfoTimes, parseEbur128, parseSignalstats, parseSilenceStart, parseStreamInfo, cutStats, colorLabels, measureVideo } from "./measure.js";

test("parseShowinfoTimes lấy pts_time từng cut", () => {
  const s = "[Parsed_showinfo_1 @ 0x1] n:   0 pts:  800 pts_time:26.6667 duration: 1\n[Parsed_showinfo_1 @ 0x1] n:   1 pts:  868 pts_time:28.9333 duration: 1\n";
  assert.deepEqual(parseShowinfoTimes(s), [26.6667, 28.9333]);
});
test("parseEbur128 đọc Integrated loudness", () => {
  assert.equal(parseEbur128("  Integrated loudness:\n    I:         -14.3 LUFS\n    Threshold: -24.5 LUFS"), -14.3);
  assert.equal(parseEbur128("rác"), null);
});
test("parseSignalstats đọc YAVG/UAVG/VAVG/SATAVG từng khung", () => {
  const s = "lavfi.signalstats.YAVG=120.5\nlavfi.signalstats.UAVG=118.0\nlavfi.signalstats.VAVG=140.2\nlavfi.signalstats.SATAVG=40.1\nlavfi.signalstats.YAVG=90\nlavfi.signalstats.UAVG=130\nlavfi.signalstats.VAVG=120\nlavfi.signalstats.SATAVG=20\n";
  const r = parseSignalstats(s);
  assert.equal(r.length, 2); assert.equal(r[0].v, 140.2); assert.equal(r[1].sat, 20);
});
test("parseSilenceStart chỉ nhận im lặng bắt đầu tại 0", () => {
  assert.equal(parseSilenceStart("[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 1.2 | silence_duration: 1.2"), 1.2);
  assert.equal(parseSilenceStart("[silencedetect @ 0x1] silence_start: 5.1\n[silencedetect @ 0x1] silence_end: 6 | silence_duration: 0.9"), null);
});
test("parseStreamInfo đọc kích thước và fps", () => {
  assert.deepEqual(parseStreamInfo("Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1080x1920, 2000 kb/s, 30 fps, 30 tbr"), { width: 1080, height: 1920, fps: 30 });
});
test("cutStats: cuts/phút, trung vị shot, P10/P90, cutsIn3s", () => {
  const r = cutStats([1, 2.5, 4, 6, 20], 30);
  assert.equal(r.cutsPerMin, 10);
  assert.equal(r.cutsIn3s, 2);
  assert.ok(r.medianShotLen !== null && Math.abs(r.medianShotLen - 2) < 0.01, `median=${r.medianShotLen}`);
  assert.ok(r.shotLenP90 !== null && r.shotLenP90 >= 10, `p90=${r.shotLenP90}`);
  assert.deepEqual(cutStats([], 10), { cutsPerMin: 0, medianShotLen: 10, shotLenP10: 10, shotLenP90: 10, cutsIn3s: 0 });
});
test("colorLabels: V cao hơn U → warm; sat/contrast theo ngưỡng", () => {
  assert.deepEqual(colorLabels({ y: 120, u: 110, v: 150, saturation: 70, contrast: 60 }), { tone: "warm", saturationLevel: "high", contrastLevel: "high" });
  assert.equal(colorLabels({ y: 120, u: 150, v: 110, saturation: 20, contrast: 20 }).tone, "cool");
});

test("measureVideo trên clip lavfi 2 màu 6s → đúng 1 cut ở ~3s, aspect 9:16, có frames", { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  const out = path.join(dir, "two.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=180x320:d=3:r=24", "-f", "lavfi", "-i", "color=c=blue:s=180x320:d=3:r=24", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", out], { nice: false });
  const m = await measureVideo(out);
  assert.ok(m.duration !== null && Math.abs(m.duration - 6) < 0.3, `duration=${m.duration}`);
  assert.equal(m.aspect, "9:16");
  assert.equal(m.cuts.length, 1, `cuts=${JSON.stringify(m.cuts)}`);
  assert.ok(Math.abs(m.cuts[0] - 3) < 0.2, `cut tại ${m.cuts[0]}`);
  assert.equal(m.frames.length, 6);
  assert.ok(m.frames[0].startsWith("data:image/jpeg;base64,"), "frame phải là data-URL");
  assert.equal(m.loopLikely, false);
});
```

- [ ] **Step 2: Chạy test, phải FAIL (module chưa có)**

- [ ] **Step 3: Viết `server/style/measure.ts`**

```ts
/**
 * server/style/measure.ts — đo phần đo được bằng ffmpeg, không AI (spec §4).
 * Mỗi phép đo độc lập: lỗi → trường null, không fail cả video.
 * ffmpeg-static không có ffprobe → mọi thông tin đọc từ stderr của ffmpeg.
 */
import { spawn } from "node:child_process";
import { runFfmpeg, FFMPEG, parseDurationLine } from "../studio/ffmpeg.js";
import { STYLE } from "./config.js";
import type { StyleMeasure } from "./types.js";
import { LEVELS, TONES } from "./types.js";

const T = 60_000;
/** Chạy ffmpeg và trả stderr dù thoát mã ≠ 0 (nhiều filter in kết quả rồi thoát 0, nhưng -i không output thoát 1). */
async function stderrOf(args: string[], timeoutMs = T): Promise<string> {
  try { return await runFfmpeg(args, { nice: false, timeoutMs }); }
  catch (e: any) { return String(e?.message || ""); }
}
function rawStderr(args: string[]): Promise<string> {
  return new Promise((res) => { const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] }); let s = ""; p.stderr.on("data", (c) => (s += String(c))); p.on("close", () => res(s)); p.on("error", () => res(s)); });
}

export function parseShowinfoTimes(s: string): number[] { return [...s.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n)); }
export function parseEbur128(s: string): number | null { const m = s.match(/Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+)\s*LUFS/); return m ? Number(m[1]) : null; }
export function parseSignalstats(s: string): { y: number; u: number; v: number; sat: number }[] {
  const ys = [...s.matchAll(/signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const us = [...s.matchAll(/signalstats\.UAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const vs = [...s.matchAll(/signalstats\.VAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const ss = [...s.matchAll(/signalstats\.SATAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return ys.map((y, i) => ({ y, u: us[i] ?? 128, v: vs[i] ?? 128, sat: ss[i] ?? 0 }));
}
export function parseSilenceStart(s: string): number | null {
  const start = s.match(/silence_start:\s*(-?[\d.]+)/); if (!start || Number(start[1]) > 0.05) return null;
  const end = s.match(/silence_end:\s*([\d.]+)/); return end ? Number(end[1]) : null;
}
export function parseStreamInfo(s: string): { width: number; height: number; fps: number } | null {
  const m = s.match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b.*?([\d.]+)\s*fps/); return m ? { width: Number(m[1]), height: Number(m[2]), fps: Number(m[3]) } : null;
}
export function aspectOf(w: number, h: number): string { const r = w / h; if (Math.abs(r - 9 / 16) < 0.05) return "9:16"; if (Math.abs(r - 1) < 0.05) return "1:1"; if (Math.abs(r - 16 / 9) < 0.05) return "16:9"; if (Math.abs(r - 3 / 4) < 0.05) return "3:4"; return `${w}:${h}`; }

const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p))); return s[i]; };
export function cutStats(cuts: number[], duration: number) {
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < duration), duration];
  const shots = bounds.slice(1).map((b, i) => b - bounds[i]).filter((d) => d > 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { cutsPerMin: duration > 0 ? r2((cuts.length / duration) * 60) : 0, medianShotLen: r2(q(shots, 0.5)), shotLenP10: r2(q(shots, 0.1)), shotLenP90: r2(q(shots, 0.9)), cutsIn3s: cuts.filter((c) => c <= 3).length };
}
export function colorLabels(c: { y: number; u: number; v: number; saturation: number; contrast: number }) {
  const d = c.v - c.u; const tone: (typeof TONES)[number] = d > 8 ? "warm" : d < -8 ? "cool" : "neutral";
  const lv = (x: number, lo: number, hi: number): (typeof LEVELS)[number] => (x < lo ? "low" : x > hi ? "high" : "mid");
  return { tone, saturationLevel: lv(c.saturation, 30, 60), contrastLevel: lv(c.contrast, 30, 55) };
}

async function grabFrame(file: string, sec: number): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ["-ss", String(Math.max(0, sec)), "-i", file, "-frames:v", "1", "-vf", "scale=-2:360", "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = []; p.stdout.on("data", (c) => chunks.push(c));
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} resolve(null); }, 20_000);
    p.on("close", () => { clearTimeout(t); const b = Buffer.concat(chunks); resolve(b.length > 100 ? `data:image/jpeg;base64,${b.toString("base64")}` : null); });
    p.on("error", () => { clearTimeout(t); resolve(null); });
  });
}
/** Histogram Y 16 bins của 1 khung (để so đầu–cuối). */
async function frameHist(file: string, sec: number): Promise<number[] | null> {
  const s = await stderrOf(["-ss", String(Math.max(0, sec)), "-i", file, "-frames:v", "1", "-vf", "scale=64:64,format=gray,signalstats,metadata=print", "-f", "null", "-"]);
  const m = s.match(/signalstats\.YAVG=([\d.]+)/); const lo = s.match(/signalstats\.YLOW=([\d.]+)/); const hi = s.match(/signalstats\.YHIGH=([\d.]+)/);
  return m ? [Number(m[1]), lo ? Number(lo[1]) : 0, hi ? Number(hi[1]) : 255] : null;
}

export async function measureVideo(file: string): Promise<StyleMeasure> {
  const m: StyleMeasure = { duration: null, width: null, height: null, aspect: null, fps: null, cuts: [], cutsPerMin: null, medianShotLen: null, shotLenP10: null, shotLenP90: null, cutsIn3s: null,
    loudness: { integratedLufs: null, first3sLufs: null }, silenceStart: null, color: null, loopLikely: null, frames: [] };
  const info = await rawStderr(["-i", file]);
  m.duration = parseDurationLine(info); const si = parseStreamInfo(info);
  if (si) { m.width = si.width; m.height = si.height; m.fps = si.fps; m.aspect = aspectOf(si.width, si.height); }
  const dur = m.duration || 0;
  // Cut
  try {
    const s = await stderrOf(["-i", file, "-vf", `select='gt(scene,${STYLE.sceneThreshold})',showinfo`, "-an", "-f", "null", "-"], 120_000);
    m.cuts = parseShowinfoTimes(s).map((t) => Math.round(t * 100) / 100);
    if (dur > 0) Object.assign(m, cutStats(m.cuts, dur));
  } catch { /* giữ null */ }
  // Loudness cả video + 3 s đầu + im lặng đầu
  try { m.loudness.integratedLufs = parseEbur128(await stderrOf(["-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"])); } catch {}
  try { m.loudness.first3sLufs = parseEbur128(await stderrOf(["-t", "3", "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"])); } catch {}
  try { m.silenceStart = parseSilenceStart(await stderrOf(["-t", "5", "-i", file, "-vn", "-af", `silencedetect=n=${STYLE.silenceDb}dB:d=0.3`, "-f", "null", "-"])); } catch {}
  // Màu: 8 khung lấy đều
  try {
    const step = dur > 0 ? dur / 9 : 1;
    const s = await stderrOf(["-i", file, "-vf", `fps=1/${step.toFixed(3)},scale=160:-2,signalstats,metadata=print`, "-frames:v", "8", "-an", "-f", "null", "-"], 120_000);
    const rows = parseSignalstats(s);
    if (rows.length) {
      const avg = (k: "y" | "u" | "v" | "sat") => rows.reduce((a, r) => a + r[k], 0) / rows.length;
      const ys = rows.map((r) => r.y); const contrast = Math.max(...ys) - Math.min(...ys);
      const c = { y: avg("y"), u: avg("u"), v: avg("v"), saturation: avg("sat"), contrast };
      m.color = { ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * 10) / 10])) as typeof c, ...colorLabels(c) };
    }
  } catch {}
  // Loop: so khung đầu–cuối
  try { const a = await frameHist(file, 0.1); const b = await frameHist(file, Math.max(0, dur - 0.2)); m.loopLikely = !!(a && b) && Math.abs(a[0] - b[0]) < 6 && Math.abs(a[2] - b[2]) < 12; } catch {}
  // Frames: 0 s, 1.5 s, 3 mốc cut giữa (đều), cuối
  const mid = m.cuts.length ? [0.25, 0.5, 0.75].map((p) => m.cuts[Math.min(m.cuts.length - 1, Math.floor(p * m.cuts.length))] + 0.05) : [dur * 0.3, dur * 0.5, dur * 0.7];
  const at = [0.05, Math.min(1.5, dur * 0.2), ...mid, Math.max(0, dur - 0.3)].slice(0, STYLE.frameCount);
  for (const t of at) { const f = await grabFrame(file, t); if (f) m.frames.push(f); }
  return m;
}
```

- [ ] **Step 4: Chạy test, phải PASS**

```bash
npm test -- 2>&1 | grep -E "measure|^# (pass|fail)"
```
Nếu test tích hợp ra `cuts.length` ≠ 1: in `m.cuts` và điều chỉnh `-t 6`/`concat` — KHÔNG hạ ngưỡng 0,35 (ngưỡng là quyết định spec).

- [ ] **Step 5: Commit**

```bash
git add server/style/measure.ts server/style/measure.test.ts
git commit -m "feat(style): measureVideo — cut/loudness/màu/loop/frames bằng ffmpeg, parser có test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Validator phiếu style — `validate.ts`

**Files:**
- Create: `server/style/validate.ts`, `server/style/validate.test.ts`

**Interfaces:**
- Consumes: enum + `StyleAnalysis`, `StyleTimelineShot` từ `types.ts`.
- Produces: `validateStyle(raw: any): StyleAnalysis` (không throw; `warnings[]`), `validateTimeline(raw: any, cuts: number[], duration: number): StyleTimelineShot[]`, `emptyStyle(): StyleAnalysis`.

- [ ] **Step 1: Viết test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStyle, validateTimeline } from "./validate.js";

test("enum sai → mặc định + warning; đúng → giữ", () => {
  const a = validateStyle({ structure: { hookType: "text-big", layout: "bogus", transitions: [{ at: 1.2, type: "zoom" }, { at: "x", type: "??" }], cutSync: "beat" }, text: { captionStyle: "word-pop", font: { weight: "bold", sizeRel: "huge" } } });
  assert.equal(a.structure.hookType, "text-big");
  assert.equal(a.structure.layout, "other");
  assert.equal(a.structure.transitions.length, 1, "bỏ transition không có at số");
  assert.equal(a.text.font.sizeRel, "med");
  assert.ok(a.warnings.some((w) => /layout/.test(w)), `warnings=${a.warnings}`);
  assert.ok(a.warnings.some((w) => /sizeRel/.test(w)), "phải cảnh báo sizeRel");
});
test("thiếu lớp → lớp rỗng + warning, không throw; ratio kẹp 0–1; mảng enum lọc giá trị lạ", () => {
  const a = validateStyle({ visual: { talkingHeadRatio: 3, angles: ["eye", "weird"], shotSizes: [] } });
  assert.equal(a.visual.talkingHeadRatio, 1);
  assert.deepEqual(a.visual.angles, ["eye"]);
  assert.ok(a.warnings.some((w) => /audio/.test(w)), "thiếu lớp audio phải cảnh báo");
  assert.equal(a.estimated, false);
});
test("estimated giữ theo input", () => { assert.equal(validateStyle({ estimated: true }).estimated, true); });
test("validateTimeline ghép đúng theo cuts, bỏ shot thừa, điền shot thiếu", () => {
  const t = validateTimeline({ timeline: [{ shot: "CU tay", textOnScreen: "HOT", textAnim: "pop", sfx: "whoosh", music: "trap", voice: "mở đầu" }] }, [2, 5], 8);
  assert.equal(t.length, 3);
  assert.deepEqual([t[0].from, t[0].to, t[1].from, t[1].to, t[2].from, t[2].to], [0, 2, 2, 5, 5, 8]);
  assert.equal(t[0].shot, "CU tay"); assert.equal(t[2].shot, ""); assert.equal(t[2].textAnim, "none");
});
```

- [ ] **Step 2: Chạy test, phải FAIL**

- [ ] **Step 3: Viết `server/style/validate.ts`**

```ts
/** server/style/validate.ts — ép phiếu Gemini về đúng enum (spec §5). Không throw; ghi warnings. */
import * as T from "./types.js";
import type { StyleAnalysis, StyleTimelineShot } from "./types.js";

type RO = readonly string[];
export function emptyStyle(): StyleAnalysis {
  return {
    structure: { hookType: "other", hookText: "", hookVisual: "", layout: "other", hasLoop: false, transitions: [], cutSync: "none" },
    visual: { shooting: "mixed", angles: [], shotSizes: [], talkingHeadRatio: 0, brollRatio: 0, punchIn: false, frame: "none", grade: { tone: "neutral", saturation: "mid", contrast: "mid", preset: "" }, quality: "clean" },
    text: { captionStyle: "none", font: { family: "", weight: "bold", sizeRel: "med" }, color: "", stroke: false, shadow: false, box: false, position: "varies", highlight: "none", stickers: [], animIn: "none", animOut: "none" },
    audio: { music: { genre: "", source: "none", levelVsVoice: "under" }, voice: { mode: "none", gender: "mixed", pace: "normal" }, sfx: [], sfxDensity: "none", beatSync: false },
    content: { genre: "other", persona: "other", openingFormula: "", closingFormula: "", cta: "", productPresentation: [] },
    brand: { watermark: { has: false, position: "none" }, intro: false, outro: false, mainColors: [], recurringOpeningFrame: false },
    notes: { oddities: [] }, estimated: false, warnings: [],
  };
}
export function validateStyle(raw: any): StyleAnalysis {
  const out = emptyStyle(); const w = out.warnings; const r = raw || {};
  const en = <L extends RO>(list: L, v: any, d: L[number], name: string): L[number] => { if (v === undefined || v === null || v === "") return d; const s = String(v); if ((list as RO).includes(s)) return s as L[number]; w.push(`${name}: "${s}" không hợp lệ → ${d}`); return d; };
  const ens = <L extends RO>(list: L, v: any, name: string): L[number][] => { const arr = Array.isArray(v) ? v.map(String) : []; const ok = arr.filter((x) => (list as RO).includes(x)); if (ok.length !== arr.length) w.push(`${name}: bỏ ${arr.length - ok.length} giá trị lạ`); return [...new Set(ok)] as L[number][]; };
  const bool = (v: any) => v === true || v === "true" || v === 1;
  const str = (v: any, max = 300) => String(v ?? "").trim().slice(0, max);
  const strs = (v: any) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, 12) : []);
  const ratio = (v: any) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
  const timed = <L extends RO>(list: L, v: any, name: string) => (Array.isArray(v) ? v : []).filter((x) => Number.isFinite(Number(x?.at))).map((x) => ({ at: Math.round(Number(x.at) * 100) / 100, type: en(list, x?.type, "other" as L[number], name) }));
  for (const layer of ["structure", "visual", "text", "audio", "content", "brand"] as const) if (!r[layer] || typeof r[layer] !== "object") w.push(`thiếu lớp ${layer}`);
  const s = r.structure || {}, v = r.visual || {}, t = r.text || {}, a = r.audio || {}, c = r.content || {}, b = r.brand || {};
  out.structure = { hookType: en(T.HOOK_TYPES, s.hookType, "other", "structure.hookType"), hookText: str(s.hookText), hookVisual: str(s.hookVisual), layout: en(T.LAYOUTS, s.layout, "other", "structure.layout"), hasLoop: bool(s.hasLoop), transitions: timed(T.TRANSITIONS, s.transitions, "structure.transitions"), cutSync: en(T.CUT_SYNCS, s.cutSync, "none", "structure.cutSync") };
  const g = v.grade || {};
  out.visual = { shooting: en(T.SHOOTINGS, v.shooting, "mixed", "visual.shooting"), angles: ens(T.ANGLES, v.angles, "visual.angles"), shotSizes: ens(T.SHOT_SIZES, v.shotSizes, "visual.shotSizes"), talkingHeadRatio: ratio(v.talkingHeadRatio), brollRatio: ratio(v.brollRatio), punchIn: bool(v.punchIn), frame: en(T.FRAMES, v.frame, "none", "visual.frame"),
    grade: { tone: en(T.TONES, g.tone, "neutral", "visual.grade.tone"), saturation: en(T.LEVELS, g.saturation, "mid", "visual.grade.saturation"), contrast: en(T.LEVELS, g.contrast, "mid", "visual.grade.contrast"), preset: str(g.preset, 60) }, quality: en(T.QUALITIES, v.quality, "clean", "visual.quality") };
  const f = t.font || {};
  out.text = { captionStyle: en(T.CAPTION_STYLES, t.captionStyle, "none", "text.captionStyle"), font: { family: str(f.family, 60), weight: en(T.WEIGHTS, f.weight, "bold", "text.font.weight"), sizeRel: en(T.SIZE_RELS, f.sizeRel, "med", "text.font.sizeRel") }, color: str(t.color, 60), stroke: bool(t.stroke), shadow: bool(t.shadow), box: bool(t.box),
    position: en(T.POSITIONS, t.position, "varies", "text.position"), highlight: en(T.HIGHLIGHTS, t.highlight, "none", "text.highlight"), stickers: ens(T.STICKERS, t.stickers, "text.stickers"), animIn: en(T.ANIMS, t.animIn, "none", "text.animIn"), animOut: en(T.ANIMS, t.animOut, "none", "text.animOut") };
  const mu = a.music || {}, vo = a.voice || {};
  out.audio = { music: { genre: str(mu.genre, 60), source: en(T.MUSIC_SOURCES, mu.source, "none", "audio.music.source"), levelVsVoice: en(T.LEVEL_VS, mu.levelVsVoice, "under", "audio.music.levelVsVoice") }, voice: { mode: en(T.VOICE_MODES, vo.mode, "none", "audio.voice.mode"), gender: en(T.GENDERS, vo.gender, "mixed", "audio.voice.gender"), pace: en(T.PACES, vo.pace, "normal", "audio.voice.pace") },
    sfx: timed(T.SFX_TYPES, a.sfx, "audio.sfx"), sfxDensity: en(T.DENSITIES, a.sfxDensity, "none", "audio.sfxDensity"), beatSync: bool(a.beatSync) };
  out.content = { genre: en(T.GENRES, c.genre, "other", "content.genre"), persona: en(T.PERSONAS, c.persona, "other", "content.persona"), openingFormula: str(c.openingFormula), closingFormula: str(c.closingFormula), cta: str(c.cta), productPresentation: ens(T.PRESENTATIONS, c.productPresentation, "content.productPresentation") };
  const wm = b.watermark || {};
  out.brand = { watermark: { has: bool(wm.has), position: en(T.WATERMARK_POS, wm.position, "none", "brand.watermark.position") }, intro: bool(b.intro), outro: bool(b.outro), mainColors: strs(b.mainColors), recurringOpeningFrame: bool(b.recurringOpeningFrame) };
  out.notes = { oddities: strs(r.notes?.oddities) };
  out.estimated = bool(r.estimated);
  return out;
}
/** Ghép timeline theo cuts đã đo: model chỉ điền nội dung, code quyết from/to (spec §5). */
export function validateTimeline(raw: any, cuts: number[], duration: number): StyleTimelineShot[] {
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < duration), duration];
  const items: any[] = Array.isArray(raw?.timeline) ? raw.timeline : Array.isArray(raw) ? raw : [];
  const str = (v: any) => String(v ?? "").trim().slice(0, 200);
  return bounds.slice(1).map((to, i) => { const it = items[i] || {}; return { from: bounds[i], to, shot: str(it.shot), textOnScreen: str(it.textOnScreen), textAnim: (T.ANIMS as readonly string[]).includes(String(it.textAnim)) ? it.textAnim : "none", sfx: str(it.sfx), music: str(it.music), voice: str(it.voice) }; });
}
```

- [ ] **Step 4: Chạy test, phải PASS**

- [ ] **Step 5: Commit**

```bash
git add server/style/validate.ts server/style/validate.test.ts
git commit -m "feat(style): validateStyle/validateTimeline — ép enum, không throw, ghi warnings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Engine phân tích — `analyze.ts` (Gemini thật + fake), prompt có số đo

**Files:**
- Create: `server/style/analyze.ts`, `server/style/analyze.test.ts`

**Interfaces:**
- Consumes: `StyleMeasure`, `validateStyle`, `validateTimeline`, `extractJSON` (`server/gemini.ts`), `STYLE.model/fps*`.
- Produces:
  ```ts
  interface StyleEngine {
    name: string;
    analyze(a: { videoPath: string; mimeType: string; measure: StyleMeasure | null; meta: { title: string; platform: string; nickname: string } }): Promise<StyleAnalysis>;
    timeline(a: { videoPath: string; mimeType: string; cuts: number[]; duration: number }): Promise<StyleTimelineShot[]>;
    cluster(a: { kind: "opening" | "closing" | "cta"; texts: string[] }): Promise<Formula[]>;
    narrate(a: { profile: StyleProfile }): Promise<{ overview: string; persona: string; howTo: string }>;
  }
  makeStyleEngine(apiKey: string): StyleEngine   // theo STYLE.engine
  buildStylePrompt(measure, meta): string          // export để test
  ```

- [ ] **Step 1: Viết test `server/style/analyze.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStylePrompt, fakeStyleEngine, pickFps } from "./analyze.js";
import type { StyleMeasure } from "./types.js";

const M: StyleMeasure = { duration: 32.4, width: 1080, height: 1920, aspect: "9:16", fps: 30, cuts: [1.5, 3.2, 6.8], cutsPerMin: 5.56, medianShotLen: 1.7, shotLenP10: 1.5, shotLenP90: 25.6, cutsIn3s: 1,
  loudness: { integratedLufs: -14.2, first3sLufs: -12.1 }, silenceStart: null, color: { y: 120, u: 118, v: 140, saturation: 45, contrast: 50, tone: "warm", saturationLevel: "mid", contrastLevel: "mid" }, loopLikely: false, frames: [] };

test("prompt chứa số đo thật và mốc cut để model không đoán", () => {
  const p = buildStylePrompt(M, { title: "Khẩu trang", platform: "TikTok", nickname: "A" });
  for (const s of ["32.4", "1.5, 3.2, 6.8", "5.56", "-14.2", "warm", "9:16"]) assert.ok(p.includes(s), `prompt thiếu ${s}`);
  assert.ok(/KHÔNG.*(đoán|ước lượng)/i.test(p), "prompt phải cấm đoán số đã đo");
  assert.ok(p.includes('"hookType"') && p.includes('"captionStyle"') && p.includes('"watermark"'), "prompt phải có schema 6 lớp");
});
test("prompt khi measure=null yêu cầu estimated=true", () => {
  const p = buildStylePrompt(null, { title: "x", platform: "TikTok", nickname: "A" });
  assert.ok(p.includes('"estimated": true'), "phải bắt estimated true");
});
test("pickFps: ngắn 3, dài 2", () => { assert.equal(pickFps(30), 3); assert.equal(pickFps(61), 2); assert.equal(pickFps(null), 3); });

test("fake engine trả phiếu hợp lệ, timeline khớp cuts, cluster gom trùng, narrate 3 đoạn", async () => {
  const e = fakeStyleEngine();
  const a = await e.analyze({ videoPath: "/x.mp4", mimeType: "video/mp4", measure: M, meta: { title: "t", platform: "TikTok", nickname: "A" } });
  assert.equal(a.text.captionStyle, "sentence"); assert.equal(a.warnings.length, 0);
  const t = await e.timeline({ videoPath: "/x.mp4", mimeType: "video/mp4", cuts: [2, 4], duration: 6 });
  assert.equal(t.length, 3); assert.equal(t[2].to, 6);
  const c = await e.cluster({ kind: "opening", texts: ["Chào mọi người", "chào mọi người ", "Hôm nay"] });
  assert.equal(c[0].count, 2); assert.equal(c.length, 2);
  const n = await e.narrate({ profile: {} as any });
  assert.ok(n.overview && n.persona && n.howTo, "narrate phải đủ 3 đoạn");
});
```

- [ ] **Step 2: Chạy test, phải FAIL**

- [ ] **Step 3: Viết `server/style/analyze.ts`**

```ts
/**
 * server/style/analyze.ts — engine phân tích style: Gemini xem video ở fps cao hơn mặc định + nhận sẵn số đo ffmpeg (spec §5).
 * Engine fake trả phiếu cố định để test pipeline không tốn tiền (spec §13).
 */
import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import { extractJSON } from "../gemini.js";
import { STYLE } from "./config.js";
import { validateStyle, validateTimeline, emptyStyle } from "./validate.js";
import * as T from "./types.js";
import type { StyleMeasure, StyleAnalysis, StyleTimelineShot, StyleProfile, Formula } from "./types.js";

export interface StyleEngine {
  name: string;
  analyze(a: { videoPath: string; mimeType: string; measure: StyleMeasure | null; meta: { title: string; platform: string; nickname: string } }): Promise<StyleAnalysis>;
  timeline(a: { videoPath: string; mimeType: string; cuts: number[]; duration: number }): Promise<StyleTimelineShot[]>;
  cluster(a: { kind: "opening" | "closing" | "cta"; texts: string[] }): Promise<Formula[]>;
  narrate(a: { profile: StyleProfile }): Promise<{ overview: string; persona: string; howTo: string }>;
}

export const pickFps = (duration: number | null) => (duration !== null && duration > STYLE.longVideoSec ? STYLE.fpsLong : STYLE.fpsShort);
const list = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join("|");

export function buildStylePrompt(m: StyleMeasure | null, meta: { title: string; platform: string; nickname: string }): string {
  const measured = m
    ? `SỐ ĐO ĐÃ ĐO BẰNG FFMPEG (chính xác — dùng nguyên, KHÔNG đoán lại, KHÔNG ước lượng khác):
- Thời lượng: ${m.duration ?? "?"} s · khung ${m.width}x${m.height} (${m.aspect}) · ${m.fps} fps
- Mốc đổi cảnh (giây): [${m.cuts.join(", ")}] → ${m.cutsPerMin ?? "?"} cut/phút, shot trung vị ${m.medianShotLen ?? "?"} s, ${m.cutsIn3s ?? 0} cut trong 3 s đầu
- Âm lượng tích hợp: ${m.loudness.integratedLufs ?? "?"} LUFS (3 s đầu: ${m.loudness.first3sLufs ?? "?"}); im lặng đầu: ${m.silenceStart ?? "không"}
- Màu trung bình: tone ${m.color?.tone ?? "?"}, bão hoà ${m.color?.saturationLevel ?? "?"}, contrast ${m.color?.contrastLevel ?? "?"}
- Khung đầu ≈ khung cuối (loop): ${m.loopLikely ?? "?"}
Với "transitions": mô tả KIỂU chuyển cảnh tại ĐÚNG các mốc trên (at = mốc đã cho). Với "grade": dùng tone/saturation/contrast đã đo.`
    : `KHÔNG có số đo ffmpeg cho video này. Bạn tự ước lượng các số (cut, thời lượng) và ĐẶT "estimated": true.`;
  return `Bạn là editor video ngắn chuyên nghiệp. Hãy xem video (kênh "${meta.nickname}", ${meta.platform}, tiêu đề: "${meta.title}") và mô tả PHONG CÁCH DỰNG theo 6 lớp, bằng số đo và giá trị liệt kê — không dùng tính từ mơ hồ.

${measured}

Quy tắc:
- Chỉ dùng giá trị trong danh sách cho các trường liệt kê. Không chắc → "other"/"none"/"varies".
- "font.family": ghi phỏng đoán dạng "Montserrat-like", không khẳng định.
- "hookText": chép nguyên văn chữ/lời 3 giây đầu (tiếng Việt; tiếng nước ngoài thì dịch).
- "openingFormula"/"closingFormula"/"cta": chép nguyên văn câu mở, câu chốt, lời kêu gọi.
- "oddities": điểm KHÁC THƯỜNG của video này so với một video "chuẩn" của kênh (để loại nhiễu).

Trả về DUY NHẤT một JSON hợp lệ theo schema:
{
 "structure": { "hookType": ${list(T.HOOK_TYPES)}, "hookText": "", "hookVisual": "", "layout": ${list(T.LAYOUTS)}, "hasLoop": false,
   "transitions": [{ "at": 1.5, "type": ${list(T.TRANSITIONS)} }], "cutSync": ${list(T.CUT_SYNCS)} },
 "visual": { "shooting": ${list(T.SHOOTINGS)}, "angles": [${list(T.ANGLES)}], "shotSizes": [${list(T.SHOT_SIZES)}], "talkingHeadRatio": 0.0, "brollRatio": 0.0,
   "punchIn": false, "frame": ${list(T.FRAMES)}, "grade": { "tone": ${list(T.TONES)}, "saturation": ${list(T.LEVELS)}, "contrast": ${list(T.LEVELS)}, "preset": "" }, "quality": ${list(T.QUALITIES)} },
 "text": { "captionStyle": ${list(T.CAPTION_STYLES)}, "font": { "family": "", "weight": ${list(T.WEIGHTS)}, "sizeRel": ${list(T.SIZE_RELS)} }, "color": "", "stroke": false, "shadow": false, "box": false,
   "position": ${list(T.POSITIONS)}, "highlight": ${list(T.HIGHLIGHTS)}, "stickers": [${list(T.STICKERS)}], "animIn": ${list(T.ANIMS)}, "animOut": ${list(T.ANIMS)} },
 "audio": { "music": { "genre": "", "source": ${list(T.MUSIC_SOURCES)}, "levelVsVoice": ${list(T.LEVEL_VS)} }, "voice": { "mode": ${list(T.VOICE_MODES)}, "gender": ${list(T.GENDERS)}, "pace": ${list(T.PACES)} },
   "sfx": [{ "at": 0.0, "type": ${list(T.SFX_TYPES)} }], "sfxDensity": ${list(T.DENSITIES)}, "beatSync": false },
 "content": { "genre": ${list(T.GENRES)}, "persona": ${list(T.PERSONAS)}, "openingFormula": "", "closingFormula": "", "cta": "", "productPresentation": [${list(T.PRESENTATIONS)}] },
 "brand": { "watermark": { "has": false, "position": ${list(T.WATERMARK_POS)} }, "intro": false, "outro": false, "mainColors": ["#hex hoặc tên màu"], "recurringOpeningFrame": false },
 "notes": { "oddities": [""] },
 "estimated": ${m ? "false" : "true"}
}`;
}

export function buildTimelinePrompt(cuts: number[], duration: number): string {
  const bounds = [0, ...cuts, duration];
  const segs = bounds.slice(1).map((to, i) => `${i + 1}. ${bounds[i]}s–${to}s`).join("\n");
  return `Xem video và tách TIMELINE theo đúng ${bounds.length - 1} đoạn đã cắt sẵn (mốc từ ffmpeg, không đổi):
${segs}
Với MỖI đoạn, theo đúng thứ tự, ghi: "shot" (cỡ cảnh + chủ thể + chuyển động máy, 1 câu), "textOnScreen" (chữ hiện trên màn, nguyên văn, '' nếu không), "textAnim" (${list(T.ANIMS)}), "sfx" (tên hiệu ứng âm, '' nếu không), "music" (nhạc: thể loại/đoạn drop/im), "voice" (lời nói trong đoạn, tiếng Việt, '' nếu không).
Trả về DUY NHẤT JSON: { "timeline": [ { "shot": "", "textOnScreen": "", "textAnim": "none", "sfx": "", "music": "", "voice": "" } ] } — đúng ${bounds.length - 1} phần tử.`;
}

function buildClusterPrompt(kind: string, texts: string[]): string {
  return `Dưới đây là ${texts.length} câu "${kind}" trích từ các video cùng một kênh. Gom thành 3–5 CÔNG THỨC lặp lại (cùng cấu trúc câu/ý dù khác chữ). Với mỗi công thức: "text" = mẫu câu khái quát (giữ cụm từ lặp), "count" = số câu thuộc nhóm, "examples" = tối đa 3 câu nguyên văn.
Câu:
${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}
Trả về DUY NHẤT JSON: { "formulas": [ { "text": "", "count": 0, "examples": [""] } ] } — xếp count giảm dần.`;
}
function buildNarratePrompt(p: StyleProfile): string {
  const slim = { channel: p.channel, metrics: p.metrics, rules: p.rules, formulas: p.formulas, layers: p.layers };
  return `Bạn viết hướng dẫn cho một AI editor. Dựa HOÀN TOÀN vào dữ liệu JSON sau (không thêm số liệu mới, không suy diễn ngoài dữ liệu), viết 3 đoạn tiếng Việt, mỗi đoạn 80–150 từ:
1. "overview": phong cách kênh nhìn tổng thể — thể loại, nhịp, hình ảnh, chữ, âm thanh.
2. "persona": giọng điệu, nhân vật, cách nói với người xem, công thức mở/chốt.
3. "howTo": các bước dựng MỘT clip mới đúng phong cách này, nhắc lại số đo quan trọng và điều KHÔNG BAO GIỜ làm.
Dữ liệu:
${JSON.stringify(slim, null, 1)}
Trả về DUY NHẤT JSON: { "overview": "", "persona": "", "howTo": "" }`;
}

const isTransient = (e: any) => /\b503\b|\b429\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|temporarily/i.test(String(e?.message || e));
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  const backoff = [2000, 5000, 12000, 20000]; let last: any;
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; if (!isTransient(e) || i === tries - 1) throw e; await new Promise((r) => setTimeout(r, backoff[i])); } }
  throw last;
}

export function geminiStyleEngine(apiKey: string, model = STYLE.model): StyleEngine {
  const ai = new GoogleGenAI({ apiKey });
  const upload = async (videoPath: string, mimeType: string) => {
    let file = await ai.files.upload({ file: videoPath, config: { mimeType } });
    const t0 = Date.now();
    while (String((file as any)?.state?.name ?? (file as any)?.state ?? "").toUpperCase() === "PROCESSING") {
      if (Date.now() - t0 > 180_000) throw new Error("Gemini xử lý video quá lâu (>180s).");
      await new Promise((r) => setTimeout(r, 4000)); file = await ai.files.get({ name: file.name as string });
    }
    return file;
  };
  const askVideo = async (videoPath: string, mimeType: string, prompt: string, fps: number) => {
    const file = await upload(videoPath, mimeType);
    const part: any = createPartFromUri(file.uri as string, file.mimeType as string);
    part.videoMetadata = { fps };
    const resp = await withRetry(() => ai.models.generateContent({ model, contents: createUserContent([part, prompt]), config: { responseMimeType: "application/json", temperature: 0.3 } }));
    const json = extractJSON((resp.text ?? "").trim());
    if (!json) throw new Error("Gemini trả về JSON không hợp lệ.");
    return json;
  };
  const askText = async (prompt: string) => {
    const resp = await withRetry(() => ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: "application/json", temperature: 0.4 } }));
    const json = extractJSON((resp.text ?? "").trim());
    if (!json) throw new Error("Gemini trả về JSON không hợp lệ.");
    return json;
  };
  return {
    name: "gemini",
    async analyze(a) {
      const json = await askVideo(a.videoPath, a.mimeType, buildStylePrompt(a.measure, a.meta), pickFps(a.measure?.duration ?? null));
      const out = validateStyle(json); if (!a.measure) out.estimated = true; return out;
    },
    async timeline(a) { return validateTimeline(await askVideo(a.videoPath, a.mimeType, buildTimelinePrompt(a.cuts, a.duration), STYLE.fpsTimeline), a.cuts, a.duration); },
    async cluster(a) {
      if (a.texts.length < 2) return a.texts.map((t) => ({ text: t, count: 1, examples: [t] }));
      const json = await askText(buildClusterPrompt(a.kind, a.texts));
      return (Array.isArray(json?.formulas) ? json.formulas : []).map((f: any) => ({ text: String(f?.text || "").slice(0, 200), count: Math.max(1, Number(f?.count) || 1), examples: (Array.isArray(f?.examples) ? f.examples : []).map(String).slice(0, 3) })).filter((f: Formula) => f.text).slice(0, 5);
    },
    async narrate(a) { const j = await askText(buildNarratePrompt(a.profile)); const s = (v: any) => String(v || "").trim(); return { overview: s(j.overview), persona: s(j.persona), howTo: s(j.howTo) }; },
  };
}

/** Engine giả: phiếu cố định (caption "sentence", hook text-big) — 0 đồng, dùng cho test và STYLE_ENGINE=fake. */
export function fakeStyleEngine(): StyleEngine {
  return {
    name: "fake",
    async analyze(a) {
      const s = emptyStyle();
      s.structure = { ...s.structure, hookType: "text-big", hookText: `Hook ${a.meta.title}`, layout: "hook-problem-content-cta", transitions: (a.measure?.cuts || []).map((at) => ({ at, type: "hard" as const })), cutSync: "speech" };
      s.visual = { ...s.visual, shooting: "handheld", angles: ["eye"], shotSizes: ["CU", "MS"], talkingHeadRatio: 0.6, brollRatio: 0.4, grade: { tone: a.measure?.color?.tone || "neutral", saturation: "mid", contrast: "mid", preset: "" } };
      s.text = { ...s.text, captionStyle: "sentence", font: { family: "Montserrat-like", weight: "bold", sizeRel: "large" }, color: "trắng", stroke: true, position: "top-third" };
      s.audio = { ...s.audio, music: { genre: "lofi", source: "trending", levelVsVoice: "under" }, voice: { mode: "direct", gender: "female", pace: "fast" }, sfxDensity: "sparse" };
      s.content = { ...s.content, genre: "review", persona: "friendly", openingFormula: "Chào mọi người", closingFormula: "Mua ở giỏ hàng nhé", cta: "Ấn giỏ hàng", productPresentation: ["handheld"] };
      s.brand = { ...s.brand, watermark: { has: true, position: "top-right" }, mainColors: ["#ffffff", "#000000"] };
      s.estimated = !a.measure; return s;
    },
    async timeline(a) { return validateTimeline({ timeline: a.cuts.concat([a.duration]).map((_, i) => ({ shot: `Shot ${i + 1}`, textOnScreen: i === 0 ? "HOOK" : "", textAnim: "pop", sfx: i === 0 ? "whoosh" : "", music: "lofi", voice: `lời ${i + 1}` })) }, a.cuts, a.duration); },
    async cluster(a) { const m = new Map<string, string[]>(); for (const t of a.texts) { const k = t.trim().toLowerCase(); if (!k) continue; m.set(k, [...(m.get(k) || []), t]); } return [...m.entries()].map(([k, ex]) => ({ text: ex[0].trim(), count: ex.length, examples: ex.slice(0, 3) })).sort((x, y) => y.count - x.count).slice(0, 5); },
    async narrate() { return { overview: "Tổng quan (fake).", persona: "Persona (fake).", howTo: "Cách dựng (fake)." }; },
  };
}

export function makeStyleEngine(apiKey: string): StyleEngine { return STYLE.engine === "fake" ? fakeStyleEngine() : geminiStyleEngine(apiKey); }
```

- [ ] **Step 4: Chạy test, phải PASS**

- [ ] **Step 5: Commit**

```bash
git add server/style/analyze.ts server/style/analyze.test.ts
git commit -m "feat(style): StyleEngine gemini/fake — prompt 6 lớp kèm số đo ffmpeg, timeline theo cut, cluster, narrate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Tổng hợp — `aggregate.ts`

**Files:**
- Create: `server/style/aggregate.ts`, `server/style/aggregate.test.ts`

**Interfaces:**
- Consumes: `StyleAnalysis`, `StyleMeasure`, `STYLE.hardShare/softShare/recentDays/oldWeight/outlierLayers/neverFields`.
- Produces:
  ```ts
  interface AggInput { videoId: string; link: string; views: number; createTime: number; measure: StyleMeasure | null; analysis: StyleAnalysis; timeline: StyleTimelineShot[] | null; isExemplar: boolean }
  aggregateProfile(inputs: AggInput[], nowSec: number, channel, model): Omit<StyleProfile, "formulas"> & { formulas: { opening: string[]; closing: string[]; cta: string[] } }
  // formulas ở đây là DANH SÁCH CÂU THÔ; pipeline gọi engine.cluster để đổi thành Formula[] (Task 9).
  stat(xs: number[]): Stat
  ```

- [ ] **Step 1: Viết test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateProfile, stat, type AggInput } from "./aggregate.js";
import { emptyStyle } from "./validate.js";
import type { StyleAnalysis, StyleMeasure } from "./types.js";

const NOW = 1_800_000_000; const DAY = 86400;
const CH = { platform: "tiktok", handle: "a", nickname: "A", avatar: "" };
const meas = (cpm: number, dur = 30): StyleMeasure => ({ duration: dur, width: 1080, height: 1920, aspect: "9:16", fps: 30, cuts: [], cutsPerMin: cpm, medianShotLen: 60 / cpm, shotLenP10: 1, shotLenP90: 3, cutsIn3s: 1, loudness: { integratedLufs: -14, first3sLufs: -13 }, silenceStart: null, color: null, loopLikely: false, frames: ["data:image/jpeg;base64,AAAA"] });
function vid(i: number, patch: (s: StyleAnalysis) => void, opts: { daysAgo?: number; cpm?: number } = {}): AggInput {
  const s = emptyStyle(); s.text.captionStyle = "sentence"; s.content.persona = "friendly"; s.structure.hookType = "text-big"; s.content.openingFormula = "Chào mọi người"; patch(s);
  return { videoId: `v${i}`, link: `l${i}`, views: 1000 - i, createTime: NOW - (opts.daysAgo ?? 10) * DAY, measure: meas(opts.cpm ?? 30), analysis: s, timeline: null, isExemplar: i < 2 };
}

test("stat: trung vị và P25/P75", () => { assert.deepEqual(stat([1, 2, 3, 4, 5, 6, 7, 8]), { median: 4.5, p25: 2.75, p75: 6.25, n: 8 }); assert.equal(stat([]).n, 0); });

test("≥70% → hard, 40–69% → soft, 0% ở trường phủ định → never", () => {
  const vids = Array.from({ length: 10 }, (_, i) => vid(i, (s) => { if (i < 5) s.visual.shooting = "handheld"; else s.visual.shooting = "static"; }));
  const p = aggregateProfile(vids, NOW, CH, "m");
  assert.equal(p.layers.text.captionStyle.rule, "hard"); assert.equal(p.layers.text.captionStyle.share, 1);
  assert.equal(p.layers.visual.shooting.rule, "soft"); assert.equal(p.layers.visual.shooting.value, "handheld");
  assert.ok(p.rules.hard.some((r) => /caption.*sentence|sentence/.test(r)), `hard=${p.rules.hard}`);
  assert.ok(p.rules.never.some((r) => /word-pop/.test(r)), `never=${p.rules.never}`);
  assert.ok(p.rules.never.some((r) => /intro/.test(r)), "không có intro → never");
  assert.ok(p.rules.hard.some((r) => /cut/.test(r) && /30/.test(r)), `hard phải có câu số đo cut: ${p.rules.hard}`);
});

test("trọng số thời gian: 6 video cũ style X vs 4 video mới style Y → Y thắng", () => {
  const vids = [...Array.from({ length: 6 }, (_, i) => vid(i, (s) => { s.content.genre = "story"; }, { daysAgo: 200 })), ...Array.from({ length: 4 }, (_, i) => vid(10 + i, (s) => { s.content.genre = "review"; }))];
  const p = aggregateProfile(vids, NOW, CH, "m");
  assert.equal(p.layers.content.genre.value, "review");
});

test("outlier: lệch ≥3 lớp bị loại và ghi lý do; formulas gom câu thô", () => {
  const vids = Array.from({ length: 9 }, (_, i) => vid(i, () => {}));
  vids.push(vid(99, (s) => { s.text.captionStyle = "word-pop"; s.content.persona = "sassy"; s.structure.hookType = "question"; }, { cpm: 150 }));
  const p = aggregateProfile(vids, NOW, CH, "m");
  assert.equal(p.videos.used, 9); assert.equal(p.videos.outliers.length, 1);
  assert.equal(p.videos.outliers[0].videoId, "v99"); assert.ok(p.videos.outliers[0].reasons.length >= 3, `reasons=${p.videos.outliers[0].reasons}`);
  assert.equal(p.metrics.cutsPerMin.median, 30, "outlier không được kéo số đo");
  assert.equal(p.formulas.opening.length, 9);
  assert.equal(p.exemplars.length, 2);
  assert.ok(Object.keys(p.evidence).length > 0, "phải có ảnh bằng chứng");
});
```

- [ ] **Step 2: Chạy test, phải FAIL**

- [ ] **Step 3: Viết `server/style/aggregate.ts`**

```ts
/**
 * server/style/aggregate.ts — tổng hợp N phiếu style thành Style Profile (spec §6). Thuần code, chạy lại được.
 * Enum: tần suất có trọng số → hard ≥70 % · soft 40–69 % · never = 0 % ở trường phủ định.
 * Số: trung vị + P25–P75. Outlier: lệch ≥ STYLE.outlierLayers lớp so với mode → loại khỏi thống kê.
 */
import { STYLE } from "./config.js";
import type { StyleAnalysis, StyleMeasure, StyleTimelineShot, StyleProfile, Stat, LayerField } from "./types.js";

export interface AggInput { videoId: string; link: string; views: number; createTime: number; measure: StyleMeasure | null; analysis: StyleAnalysis; timeline: StyleTimelineShot[] | null; isExemplar: boolean }
type Layer = keyof StyleProfile["layers"];
const LAYERS: Layer[] = ["structure", "visual", "text", "audio", "content", "brand"];

const r2 = (n: number) => Math.round(n * 100) / 100;
const qtl = (s: number[], p: number) => { if (!s.length) return 0; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export function stat(xs: number[]): Stat { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return { median: r2(qtl(s, 0.5)), p25: r2(qtl(s, 0.25)), p75: r2(qtl(s, 0.75)), n: s.length }; }

/** Trường liệt kê theo lớp: tên → hàm lấy giá trị (string | string[] | boolean). */
const FIELDS: Record<Layer, Record<string, (a: StyleAnalysis) => string | string[] | boolean>> = {
  structure: { hookType: (a) => a.structure.hookType, layout: (a) => a.structure.layout, hasLoop: (a) => a.structure.hasLoop, transitions: (a) => [...new Set(a.structure.transitions.map((t) => t.type))], cutSync: (a) => a.structure.cutSync },
  visual: { shooting: (a) => a.visual.shooting, angles: (a) => a.visual.angles, shotSizes: (a) => a.visual.shotSizes, punchIn: (a) => a.visual.punchIn, frame: (a) => a.visual.frame, "grade.tone": (a) => a.visual.grade.tone, "grade.saturation": (a) => a.visual.grade.saturation, "grade.contrast": (a) => a.visual.grade.contrast, quality: (a) => a.visual.quality },
  text: { captionStyle: (a) => a.text.captionStyle, "font.weight": (a) => a.text.font.weight, "font.sizeRel": (a) => a.text.font.sizeRel, stroke: (a) => a.text.stroke, shadow: (a) => a.text.shadow, box: (a) => a.text.box, position: (a) => a.text.position, highlight: (a) => a.text.highlight, stickers: (a) => a.text.stickers, animIn: (a) => a.text.animIn, animOut: (a) => a.text.animOut, "font.family": (a) => a.text.font.family || "?", color: (a) => a.text.color || "?" },
  audio: { "music.source": (a) => a.audio.music.source, "music.levelVsVoice": (a) => a.audio.music.levelVsVoice, "music.genre": (a) => a.audio.music.genre || "?", "voice.mode": (a) => a.audio.voice.mode, "voice.gender": (a) => a.audio.voice.gender, "voice.pace": (a) => a.audio.voice.pace, sfxDensity: (a) => a.audio.sfxDensity, sfxTypes: (a) => [...new Set(a.audio.sfx.map((s) => s.type))], beatSync: (a) => a.audio.beatSync },
  content: { genre: (a) => a.content.genre, persona: (a) => a.content.persona, productPresentation: (a) => a.content.productPresentation },
  brand: { "watermark.has": (a) => a.brand.watermark.has, "watermark.position": (a) => a.brand.watermark.position, intro: (a) => a.brand.intro, outro: (a) => a.brand.outro, recurringOpeningFrame: (a) => a.brand.recurringOpeningFrame },
};
/** Câu tiếng Việt cho từng trường (dùng khi viết rules). */
const LABEL: Record<string, string> = {
  "structure.hookType": "Kiểu hook 3 s đầu", "structure.layout": "Bố cục", "structure.hasLoop": "Loop cuối", "structure.transitions": "Kiểu chuyển cảnh", "structure.cutSync": "Cắt theo",
  "visual.shooting": "Cách quay", "visual.angles": "Tầm máy", "visual.shotSizes": "Cỡ cảnh", "visual.punchIn": "Punch-in khi nhấn ý", "visual.frame": "Khung/split/PIP", "visual.grade.tone": "Tone màu", "visual.grade.saturation": "Bão hoà", "visual.grade.contrast": "Contrast", "visual.quality": "Chất hình",
  "text.captionStyle": "Kiểu caption", "text.font.weight": "Độ đậm chữ", "text.font.sizeRel": "Cỡ chữ", "text.stroke": "Viền chữ", "text.shadow": "Bóng chữ", "text.box": "Nền hộp chữ", "text.position": "Vị trí chữ", "text.highlight": "Nhấn từ khoá", "text.stickers": "Sticker/đồ hoạ", "text.animIn": "Chữ vào", "text.animOut": "Chữ ra", "text.font.family": "Font (phỏng đoán)", "text.color": "Màu chữ",
  "audio.music.source": "Nguồn nhạc", "audio.music.levelVsVoice": "Nhạc so với giọng", "audio.music.genre": "Thể loại nhạc", "audio.voice.mode": "Kiểu giọng", "audio.voice.gender": "Giới tính giọng", "audio.voice.pace": "Tốc độ nói", "audio.sfxDensity": "Mật độ SFX", "audio.sfxTypes": "Loại SFX", "audio.beatSync": "Beat sync",
  "content.genre": "Thể loại", "content.persona": "Persona", "content.productPresentation": "Cách trình bày sản phẩm",
  "brand.watermark.has": "Có watermark", "brand.watermark.position": "Vị trí watermark", "brand.intro": "Có intro", "brand.outro": "Có outro", "brand.recurringOpeningFrame": "Khung mở đầu lặp lại",
};
const norm = (v: string | string[] | boolean): string[] => (Array.isArray(v) ? (v.length ? v.map(String) : ["(không)"]) : [String(v)]);
const weightOf = (createTime: number, nowSec: number) => (nowSec - createTime <= STYLE.recentDays * 86400 ? 1 : STYLE.oldWeight);

function shares(inputs: AggInput[], nowSec: number, get: (a: StyleAnalysis) => string | string[] | boolean): Map<string, number> {
  const m = new Map<string, number>(); let total = 0;
  for (const v of inputs) { const w = weightOf(v.createTime, nowSec); total += w; for (const x of norm(get(v.analysis))) m.set(x, (m.get(x) || 0) + w); }
  for (const [k, n] of m) m.set(k, total ? n / total : 0);
  return m;
}
const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] || ["?", 0];

/** Số lớp video này lệch so với mode của tập (dùng captionStyle, persona, hookType, genre, voice.mode + cutsPerMin ngoài P10–P90). */
function deviations(v: AggInput, modes: Record<string, string>, cpmRange: [number, number]): string[] {
  const r: string[] = []; const a = v.analysis;
  const chk = (k: string, val: string, label: string) => { if (modes[k] && modes[k] !== val) r.push(`${label}: ${val} (kênh: ${modes[k]})`); };
  chk("text.captionStyle", a.text.captionStyle, "caption"); chk("content.persona", a.content.persona, "persona"); chk("structure.hookType", a.structure.hookType, "hook"); chk("content.genre", a.content.genre, "thể loại"); chk("audio.voice.mode", a.audio.voice.mode, "giọng");
  const cpm = v.measure?.cutsPerMin; if (cpm !== null && cpm !== undefined && (cpm < cpmRange[0] || cpm > cpmRange[1])) r.push(`nhịp cắt ${cpm}/phút ngoài P10–P90 [${cpmRange[0]}–${cpmRange[1]}]`);
  return r;
}

export function aggregateProfile(all: AggInput[], nowSec: number, channel: StyleProfile["channel"], model: string) {
  // 1. Mode sơ bộ trên toàn tập để phát hiện outlier
  const modeKeys = ["text.captionStyle", "content.persona", "structure.hookType", "content.genre", "audio.voice.mode"];
  const modes: Record<string, string> = {};
  for (const k of modeKeys) { const [layer, ...rest] = k.split("."); modes[k] = top(shares(all, nowSec, FIELDS[layer as Layer][rest.join(".")]))[0]; }
  const cpms = all.map((v) => v.measure?.cutsPerMin).filter((x): x is number => x !== null && x !== undefined).sort((a, b) => a - b);
  const cpmRange: [number, number] = [qtl(cpms, 0.1), qtl(cpms, 0.9)];
  const outliers: { videoId: string; reasons: string[] }[] = [];
  const used = all.filter((v) => { const d = deviations(v, modes, cpmRange); if (d.length >= STYLE.outlierLayers) { outliers.push({ videoId: v.videoId, reasons: d }); return false; } return true; });
  const base = used.length ? used : all;

  // 2. Số đo
  const num = (f: (v: AggInput) => number | null | undefined) => stat(base.map(f).filter((x): x is number => x !== null && x !== undefined));
  const metrics = { duration: num((v) => v.measure?.duration), cutsPerMin: num((v) => v.measure?.cutsPerMin), shotLen: num((v) => v.measure?.medianShotLen), loudness: num((v) => v.measure?.loudness.integratedLufs), talkingHeadRatio: num((v) => v.analysis.visual.talkingHeadRatio), brollRatio: num((v) => v.analysis.visual.brollRatio) };

  // 3. Enum theo lớp → hard/soft/never
  const layers = {} as StyleProfile["layers"]; const hard: string[] = [], soft: string[] = [], never: string[] = []; const evidence: Record<string, string[]> = {};
  const fmtShare = (s: number) => `${Math.round(s * 100)} %`;
  for (const layer of LAYERS) {
    layers[layer] = {};
    for (const [field, get] of Object.entries(FIELDS[layer])) {
      const key = `${layer}.${field}`; const sh = shares(base, nowSec, get); const [value, share] = top(sh);
      const rule: LayerField["rule"] = share >= STYLE.hardShare ? "hard" : share >= STYLE.softShare ? "soft" : "none";
      layers[layer][field] = { value, share: r2(share), rule };
      const label = LABEL[key] || key;
      if (rule === "hard" && value !== "?" && value !== "(không)") { hard.push(`${label}: ${value} (${fmtShare(share)} video).`); evidence[key] = base.filter((v) => norm(get(v.analysis)).includes(value)).slice(0, 3).map((v) => v.measure?.frames?.[1] || v.measure?.frames?.[0] || "").filter(Boolean); }
      else if (rule === "soft" && value !== "?" && value !== "(không)") soft.push(`${label}: thường ${value} (${fmtShare(share)} video).`);
      const neverVals = STYLE.neverFields[key]; if (neverVals) for (const nv of neverVals) if (!sh.has(nv)) never.push(`${label} = ${nv}: KHÔNG BAO GIỜ (0/${base.length} video).`);
    }
  }
  // 4. Câu số đo (đứng đầu quy tắc cứng)
  const m = metrics; const rng = (s: Stat, unit: string) => `${s.p25}–${s.p75} ${unit} (trung vị ${s.median})`;
  if (m.duration.n) hard.unshift(`Độ dài video: ${rng(m.duration, "s")}.`);
  if (m.cutsPerMin.n) hard.unshift(`Nhịp cắt: ${rng(m.cutsPerMin, "cut/phút")}; mỗi shot ${rng(m.shotLen, "s")}.`);
  if (m.loudness.n) soft.push(`Âm lượng tích hợp: ${rng(m.loudness, "LUFS")}.`);
  if (m.talkingHeadRatio.n) soft.push(`Tỉ lệ talking-head ${Math.round(m.talkingHeadRatio.median * 100)} % · b-roll ${Math.round(m.brollRatio.median * 100)} %.`);

  // 5. Câu thô cho công thức (pipeline sẽ gom bằng engine.cluster)
  const texts = (f: (a: StyleAnalysis) => string) => base.map((v) => f(v.analysis).trim()).filter(Boolean);
  const formulas = { opening: texts((a) => a.content.openingFormula || a.structure.hookText), closing: texts((a) => a.content.closingFormula), cta: texts((a) => a.content.cta) };

  const exemplars = all.filter((v) => v.isExemplar).map((v) => ({ videoId: v.videoId, link: v.link, views: v.views, duration: v.measure?.duration ?? null, timeline: v.timeline || [] }));
  return { channel, analyzedAt: new Date(nowSec * 1000).toISOString(), model, videos: { total: all.length, used: base.length, failed: 0, outliers }, metrics, layers, rules: { hard, soft, never }, formulas, exemplars, evidence };
}
```

- [ ] **Step 4: Chạy test, phải PASS**

- [ ] **Step 5: Commit**

```bash
git add server/style/aggregate.ts server/style/aggregate.test.ts
git commit -m "feat(style): aggregateProfile — hard/soft/never theo tần suất có trọng số, outlier ≥3 lớp, số đo P25–P75

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
---

### Task 7: Sinh skill — `skill.ts`

**Files:**
- Create: `server/style/skill.ts`, `server/style/skill.test.ts`

**Interfaces:**
- Consumes: `StyleProfile` (đã có `formulas: Formula[]`), `{overview, persona, howTo}` từ `engine.narrate`.
- Produces: `slugOf(handle): string`, `buildSkillMd(p, narr): string`, `buildTimelinesMd(p): string`, `buildFormulasMd(p): string`, `skillDescription(p): string`.

- [ ] **Step 1: Viết test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSkillMd, buildTimelinesMd, buildFormulasMd, skillDescription, slugOf } from "./skill.js";
import type { StyleProfile } from "./types.js";

const P: StyleProfile = {
  channel: { platform: "tiktok", handle: "Nerman.Official", nickname: "Nerman", avatar: "" }, analyzedAt: "2026-09-25T00:00:00.000Z", model: "gemini-2.5-flash",
  videos: { total: 30, used: 28, failed: 1, outliers: [{ videoId: "v9", reasons: ["caption: word-pop (kênh: sentence)"] }] },
  metrics: { duration: { median: 31.2, p25: 24.1, p75: 38.7, n: 28 }, cutsPerMin: { median: 35.3, p25: 30.1, p75: 41.9, n: 28 }, shotLen: { median: 1.7, p25: 1.4, p75: 2, n: 28 }, loudness: { median: -14.1, p25: -15, p75: -13, n: 28 }, talkingHeadRatio: { median: 0.6, p25: 0.5, p75: 0.7, n: 28 }, brollRatio: { median: 0.4, p25: 0.3, p75: 0.5, n: 28 } },
  layers: { structure: {}, visual: {}, text: { captionStyle: { value: "sentence", share: 0.93, rule: "hard" } }, audio: {}, content: { genre: { value: "review", share: 0.8, rule: "hard" } }, brand: {} },
  rules: { hard: ["Nhịp cắt: 30.1–41.9 cut/phút; mỗi shot 1.4–2 s (trung vị 1.7).", "Kiểu caption: sentence (93 % video)."], soft: ["Cách quay: thường handheld (55 % video)."], never: ["Có intro = true: KHÔNG BAO GIỜ (0/28 video)."] },
  formulas: { opening: [{ text: "Chào mọi người, hôm nay …", count: 12, examples: ["Chào mọi người, hôm nay mình review"] }], closing: [], cta: [{ text: "Ấn giỏ hàng", count: 20, examples: ["Ấn vào giỏ hàng nhé"] }] },
  exemplars: [{ videoId: "v1", link: "https://www.tiktok.com/@a/video/1", views: 1_200_000, duration: 30, timeline: [{ from: 0, to: 1.5, shot: "CU tay cầm hộp", textOnScreen: "HOT", textAnim: "pop", sfx: "whoosh", music: "drop", voice: "Mở đầu" }] }],
  evidence: {},
};
const N = { overview: "Tổng quan.", persona: "Persona.", howTo: "Cách dựng." };

test("slug + description theo mẫu", () => {
  assert.equal(slugOf("Nerman.Official"), "nerman-official");
  assert.match(skillDescription(P), /@Nerman\.Official.*review.*1\.7 s.*sentence/);
});
test("SKILL.md: frontmatter hợp lệ, mọi câu rules xuất hiện nguyên văn, 3 đoạn narrate, không TBD", () => {
  const md = buildSkillMd(P, N);
  assert.ok(md.startsWith("---\nname: style-nerman-official\ndescription: "), md.slice(0, 80));
  for (const r of [...P.rules.hard, ...P.rules.soft, ...P.rules.never]) assert.ok(md.includes(r), `thiếu quy tắc: ${r}`);
  for (const s of ["Tổng quan.", "Persona.", "Cách dựng.", "KHÔNG BAO GIỜ", "28/30", "Chào mọi người, hôm nay …", "12 lần"]) assert.ok(md.includes(s), `thiếu ${s}`);
  assert.ok(!/TBD|TODO|undefined|null/.test(md), "không được có placeholder");
});
test("timelines.md và formulas.md có bảng", () => {
  const t = buildTimelinesMd(P); assert.ok(t.includes("| 0–1.5 |") && t.includes("CU tay cầm hộp") && t.includes("1.200.000"), t.slice(0, 300));
  const f = buildFormulasMd(P); assert.ok(f.includes("Ấn giỏ hàng") && f.includes("20 lần"), f);
});
```

- [ ] **Step 2: Chạy test, phải FAIL**

- [ ] **Step 3: Viết `server/style/skill.ts`**

```ts
/**
 * server/style/skill.ts — dựng SKILL.md + references từ Style Profile (spec §7).
 * Khung và mọi con số do CODE viết từ JSON; Gemini chỉ góp 3 đoạn văn (overview/persona/howTo).
 */
import type { StyleProfile, Formula } from "./types.js";

export const slugOf = (s: string) => String(s || "kenh").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "kenh";
const vn = (n: number) => Math.round(n).toLocaleString("vi-VN");
const esc = (s: string) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const layerName: Record<string, string> = { structure: "Cấu trúc & nhịp", visual: "Hình ảnh & khung", text: "Text & đồ hoạ", audio: "Âm thanh", content: "Nội dung & giọng điệu", brand: "Nhận diện thương hiệu" };

export function skillDescription(p: StyleProfile): string {
  const genre = p.layers.content?.genre?.value || "video ngắn"; const cap = p.layers.text?.captionStyle?.value || "?";
  return `Dựng/biên tập video theo phong cách kênh @${p.channel.handle} (${p.channel.platform}): ${genre}, mỗi shot ~${p.metrics.shotLen.median} s, caption ${cap}. Dùng khi cần làm clip giống kênh này.`;
}
const fList = (fs: Formula[]) => (fs.length ? fs.map((f) => `- **${esc(f.text)}** — ${f.count} lần${f.examples.length ? ` · vd: "${esc(f.examples[0])}"` : ""}`).join("\n") : "- (không rút được công thức lặp lại)");
const bullets = (xs: string[], empty: string) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : `- ${empty}`);

export function buildSkillMd(p: StyleProfile, n: { overview: string; persona: string; howTo: string }): string {
  const m = p.metrics;
  const layerTables = (Object.keys(p.layers) as (keyof StyleProfile["layers"])[]).map((L) => {
    const rows = Object.entries(p.layers[L]).filter(([, f]) => f.rule !== "none").map(([k, f]) => `| ${k} | ${esc(f.value)} | ${Math.round(f.share * 100)} % | ${f.rule === "hard" ? "cứng" : "mềm"} |`);
    return `### ${layerName[L]}\n\n${rows.length ? `| Trường | Giá trị | Tỉ lệ video | Quy tắc |\n|---|---|---|---|\n${rows.join("\n")}` : "_Không có trường nào đạt ngưỡng._"}`;
  }).join("\n\n");
  return `---
name: style-${slugOf(p.channel.handle)}
description: ${skillDescription(p)}
---

# Phong cách kênh @${p.channel.handle} (${p.channel.nickname})

Phân tích ${p.videos.used}/${p.videos.total} video (${p.videos.outliers.length} video lệch style bị loại, ${p.videos.failed} lỗi) · ${p.analyzedAt.slice(0, 10)} · model ${p.model}.
Số đo bằng ffmpeg trên video thật; mô tả định tính bằng AI xem video. **Ưu tiên quy tắc cứng → mềm; tuyệt đối tôn trọng mục KHÔNG BAO GIỜ.**

## Khi nào dùng skill này
Khi cần viết kịch bản, dựng, hoặc chỉ đạo dựng một clip mới cho kênh này (hoặc cố ý bắt chước phong cách kênh). Đọc \`references/profile.json\` nếu cần tham số máy đọc; \`references/timelines.md\` để xem 5 video mẫu chuẩn từng shot.

## Tổng quan phong cách
${n.overview}

## Số đo cốt lõi
| Chỉ số | Trung vị | P25–P75 | n |
|---|---|---|---|
| Độ dài video (s) | ${m.duration.median} | ${m.duration.p25}–${m.duration.p75} | ${m.duration.n} |
| Nhịp cắt (cut/phút) | ${m.cutsPerMin.median} | ${m.cutsPerMin.p25}–${m.cutsPerMin.p75} | ${m.cutsPerMin.n} |
| Độ dài shot (s) | ${m.shotLen.median} | ${m.shotLen.p25}–${m.shotLen.p75} | ${m.shotLen.n} |
| Âm lượng (LUFS) | ${m.loudness.median} | ${m.loudness.p25}–${m.loudness.p75} | ${m.loudness.n} |
| Talking-head / b-roll | ${Math.round(m.talkingHeadRatio.median * 100)} % / ${Math.round(m.brollRatio.median * 100)} % | — | ${m.talkingHeadRatio.n} |

## Quy tắc CỨNG (≥ 70 % video)
${bullets(p.rules.hard, "chưa đủ dữ liệu")}

## Quy tắc MỀM (40–69 % video)
${bullets(p.rules.soft, "không có")}

## KHÔNG BAO GIỜ (0 % video — AI không được tự thêm)
${bullets(p.rules.never, "không phát hiện điều cấm rõ ràng")}

## Persona & giọng điệu
${n.persona}

### Công thức lặp lại
**Mở đầu**
${fList(p.formulas.opening)}

**Chốt**
${fList(p.formulas.closing)}

**CTA**
${fList(p.formulas.cta)}

## 6 lớp chi tiết
${layerTables}

## Cách dựng một clip mới theo kênh này
${n.howTo}

## Video mẫu chuẩn
${p.exemplars.map((e, i) => `${i + 1}. ${e.link} — ${vn(e.views)} view${e.duration ? `, ${e.duration} s` : ""}`).join("\n") || "- (không có)"}
Timeline từng shot: xem \`references/timelines.md\`.

## Video bị loại khi tổng hợp (lệch style)
${p.videos.outliers.map((o) => `- ${o.videoId}: ${o.reasons.join("; ")}`).join("\n") || "- không có"}
`;
}

export function buildTimelinesMd(p: StyleProfile): string {
  return `# Timeline 5 video mẫu chuẩn — @${p.channel.handle}\n\nMốc cắt đo bằng ffmpeg; nội dung từng đoạn do AI xem video điền.\n\n` + p.exemplars.map((e, i) =>
    `## ${i + 1}. ${e.link} — ${vn(e.views)} view${e.duration ? `, ${e.duration} s` : ""}\n\n| Từ–đến (s) | Shot | Chữ trên màn | Anim | SFX | Nhạc | Lời |\n|---|---|---|---|---|---|---|\n` +
    (e.timeline.length ? e.timeline.map((t) => `| ${t.from}–${t.to} | ${esc(t.shot)} | ${esc(t.textOnScreen)} | ${t.textAnim} | ${esc(t.sfx)} | ${esc(t.music)} | ${esc(t.voice)} |`).join("\n") : "| — | (chưa có timeline) | | | | | |")
  ).join("\n\n");
}
export function buildFormulasMd(p: StyleProfile): string {
  const sec = (title: string, fs: Formula[]) => `## ${title}\n\n${fs.length ? fs.map((f) => `### ${esc(f.text)} — ${f.count} lần\n${f.examples.map((x) => `- "${esc(x)}"`).join("\n")}`).join("\n\n") : "_không có_"}`;
  return `# Công thức lặp lại — @${p.channel.handle}\n\n${sec("Mở đầu", p.formulas.opening)}\n\n${sec("Chốt", p.formulas.closing)}\n\n${sec("CTA", p.formulas.cta)}\n`;
}
```

- [ ] **Step 4: Chạy test, phải PASS**

- [ ] **Step 5: Commit**

```bash
git add server/style/skill.ts server/style/skill.test.ts
git commit -m "feat(style): buildSkillMd/timelines/formulas — SKILL.md sinh từ JSON, số không qua AI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Đóng gói zip — `zip.ts`

**Files:**
- Create: `server/style/zip.ts`, `server/style/zip.test.ts`

**Interfaces:**
- Consumes: `fflate` (`zipSync`, `strToU8`), `buildSkillMd/buildTimelinesMd/buildFormulasMd`, `slugOf`.
- Produces: `buildSkillZip(p: StyleProfile, skillMd: string): { name: string; buffer: Buffer }` — `name = style-<slug>.zip`; bên trong thư mục `style-<slug>/` với `SKILL.md`, `references/profile.json`, `references/timelines.md`, `references/formulas.md`, `references/evidence/<ruleKey>-<i>.jpg` (giải mã từ data-URL; bỏ trường `evidence` và `measure.frames` khỏi `profile.json` để file nhẹ).

- [ ] **Step 1: Viết test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { buildSkillZip } from "./zip.js";
import type { StyleProfile } from "./types.js";

const px = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const P = { channel: { platform: "tiktok", handle: "Abc", nickname: "A", avatar: "" }, analyzedAt: "2026-09-25T00:00:00.000Z", model: "m", videos: { total: 1, used: 1, failed: 0, outliers: [] },
  metrics: { duration: { median: 1, p25: 1, p75: 1, n: 1 }, cutsPerMin: { median: 1, p25: 1, p75: 1, n: 1 }, shotLen: { median: 1, p25: 1, p75: 1, n: 1 }, loudness: { median: 1, p25: 1, p75: 1, n: 1 }, talkingHeadRatio: { median: 1, p25: 1, p75: 1, n: 1 }, brollRatio: { median: 1, p25: 1, p75: 1, n: 1 } },
  layers: { structure: {}, visual: {}, text: {}, audio: {}, content: {}, brand: {} }, rules: { hard: [], soft: [], never: [] }, formulas: { opening: [], closing: [], cta: [] }, exemplars: [], evidence: { "text.captionStyle": [px, px] } } as StyleProfile;

test("zip có đủ 4 loại file + ảnh evidence; profile.json không mang evidence", () => {
  const { name, buffer } = buildSkillZip(P, "---\nname: style-abc\n---\n# x");
  assert.equal(name, "style-abc.zip");
  const files = unzipSync(new Uint8Array(buffer));
  const keys = Object.keys(files);
  for (const k of ["style-abc/SKILL.md", "style-abc/references/profile.json", "style-abc/references/timelines.md", "style-abc/references/formulas.md", "style-abc/references/evidence/text-captionStyle-1.jpg", "style-abc/references/evidence/text-captionStyle-2.jpg"]) assert.ok(keys.includes(k), `thiếu ${k} trong ${keys}`);
  const prof = JSON.parse(strFromU8(files["style-abc/references/profile.json"]));
  assert.equal(prof.evidence, undefined); assert.equal(prof.channel.handle, "Abc");
  assert.equal(files["style-abc/references/evidence/text-captionStyle-1.jpg"].length, 4);
});
```

- [ ] **Step 2: Chạy test, phải FAIL**

- [ ] **Step 3: Viết `server/style/zip.ts`**

```ts
/** server/style/zip.ts — đóng gói skill thành zip trong bộ nhớ bằng fflate (thuần JS, không native — build alpine an toàn). */
import { zipSync, strToU8 } from "fflate";
import { buildTimelinesMd, buildFormulasMd, slugOf } from "./skill.js";
import type { StyleProfile } from "./types.js";

const dataUrlToBytes = (u: string): Uint8Array | null => { const m = String(u || "").match(/^data:image\/\w+;base64,(.+)$/); return m ? new Uint8Array(Buffer.from(m[1], "base64")) : null; };

export function buildSkillZip(p: StyleProfile, skillMd: string): { name: string; buffer: Buffer } {
  const root = `style-${slugOf(p.channel.handle)}`;
  const { evidence, ...slim } = p;
  const files: Record<string, Uint8Array> = {
    [`${root}/SKILL.md`]: strToU8(skillMd),
    [`${root}/references/profile.json`]: strToU8(JSON.stringify(slim, null, 1)),
    [`${root}/references/timelines.md`]: strToU8(buildTimelinesMd(p)),
    [`${root}/references/formulas.md`]: strToU8(buildFormulasMd(p)),
  };
  for (const [key, urls] of Object.entries(evidence || {})) urls.forEach((u, i) => { const b = dataUrlToBytes(u); if (b) files[`${root}/references/evidence/${key.replace(/[^a-zA-Z0-9]+/g, "-")}-${i + 1}.jpg`] = b; });
  const out = zipSync(files, { level: 6 });
  return { name: `${root}.zip`, buffer: Buffer.from(out) };
}
```

- [ ] **Step 4: Chạy test, phải PASS**

- [ ] **Step 5: Commit**

```bash
git add server/style/zip.ts server/style/zip.test.ts
git commit -m "feat(style): buildSkillZip — zip skill trong bộ nhớ bằng fflate, ảnh evidence tách file

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
---

### Task 9: Store + pipeline — `store.ts`, `pipeline.ts`

**Files:**
- Create: `server/style/store.ts`, `server/style/pipeline.ts`, `server/style/pipeline.test.ts`

**Interfaces:**
- Consumes: `runQuery/getQuery/allQuery` (`server/db.ts`), `runQueryChanges` (`server/studio/store.ts`), `measureVideo`, `StyleEngine`, `aggregateProfile`, `buildSkillMd`, `downloadTikTok/downloadDouyin`, `resolveTokapiKey/resolveDouyinKey`.
- Produces:
  ```ts
  // store.ts
  newId(prefix): string
  createProfile(a: { owner; platform; handle; nickname; avatar; videos: PickedVideo[]; exemplarIds: string[] }): Promise<ProfileRow>
  getProfile(id): Promise<ProfileRow|undefined>; listProfiles(owner: string|null): Promise<(ProfileRow & {done:number; failed:number; total:number})[]>
  updateProfile(id, patch: Partial<ProfileRow>): Promise<void>; deleteProfile(id): Promise<void>
  listVideos(profileId): Promise<VideoRow[]>; getVideo(id): Promise<VideoRow|undefined>; updateVideo(id, patch: Partial<VideoRow>): Promise<void>
  findReusable(owner, link): Promise<VideoRow|undefined>   // phiếu done cùng link, profile cùng owner
  // pipeline.ts
  interface StyleDeps { engine: StyleEngine; measure: (path: string) => Promise<StyleMeasure>; download: (link: string, platform: string, dir: string) => Promise<{ path: string }> }
  makeStyleDeps(apiKey: string): StyleDeps                       // thật
  runStyleVideo(v: VideoRow, deps: StyleDeps): Promise<{ ok: boolean; kind?: "billing" }>
  finalizeProfileIfDone(profileId: string, deps: StyleDeps): Promise<boolean>
  aggregateNow(profileId: string, deps: StyleDeps): Promise<void>  // tổng hợp lại từ phiếu có sẵn
  recoverStyleInterrupted(): Promise<void>
  ```

- [ ] **Step 1: Viết `server/style/store.ts`**

```ts
/** server/style/store.ts — CRUD style_profiles / style_videos. Không logic nghiệp vụ. */
import { runQuery, getQuery, allQuery } from "../db.js";
import { runQueryChanges } from "../studio/store.js";
import type { ProfileRow, VideoRow, PickedVideo } from "./types.js";

export const newId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 10);
const NOW = () => new Date().toISOString();
const PROFILE_COLS = ["status", "profile", "skill_md", "message", "picked_ids", "exemplar_ids", "nickname", "avatar"];
const VIDEO_COLS = ["status", "measure", "analysis", "timeline", "frames", "warnings", "error", "cover", "title"];

async function patchRow(table: string, cols: string[], id: string, patch: Record<string, any>, tsCol: string) {
  const keys = Object.keys(patch).filter((k) => cols.includes(k));
  if (!keys.length) return;
  await runQuery(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, ${tsCol} = ? WHERE id = ?`, [...keys.map((k) => patch[k]), NOW(), id]);
}

export async function createProfile(a: { owner: string; platform: string; handle: string; nickname: string; avatar: string; videos: PickedVideo[]; exemplarIds: string[] }): Promise<ProfileRow> {
  const id = newId("sp"); const now = NOW();
  await runQuery("INSERT INTO style_profiles (id, owner, platform, handle, nickname, avatar, status, picked_ids, exemplar_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,'running',?,?,?,?)",
    [id, a.owner, a.platform, a.handle, a.nickname, a.avatar, JSON.stringify(a.videos.map((v) => v.awemeId)), JSON.stringify(a.exemplarIds), now, now]);
  const ex = new Set(a.exemplarIds);
  for (const v of a.videos) await runQuery("INSERT INTO style_videos (id, profile_id, aweme_id, link, title, cover, views, likes, create_time, is_exemplar, status, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)",
    [newId("sv"), id, v.awemeId, v.link, v.title, v.cover, v.views, v.likes, v.createTime, ex.has(v.awemeId) ? 1 : 0, now]);
  return (await getProfile(id))!;
}
export const getProfile = (id: string) => getQuery<ProfileRow>("SELECT * FROM style_profiles WHERE id = ?", [id]);
export function listProfiles(owner: string | null) {
  const sql = `SELECT p.*, SUM(v.status='done') AS done, SUM(v.status='failed') AS failed, COUNT(v.id) AS total FROM style_profiles p LEFT JOIN style_videos v ON v.profile_id = p.id ${owner ? "WHERE p.owner = ?" : ""} GROUP BY p.id ORDER BY p.created_at DESC`;
  return allQuery<ProfileRow & { done: number; failed: number; total: number }>(sql, owner ? [owner] : []);
}
export const updateProfile = (id: string, patch: Partial<ProfileRow>) => patchRow("style_profiles", PROFILE_COLS, id, patch, "updated_at");
export async function deleteProfile(id: string) { await runQuery("DELETE FROM style_videos WHERE profile_id = ?", [id]); await runQuery("DELETE FROM style_profiles WHERE id = ?", [id]); }
export const listVideos = (profileId: string) => allQuery<VideoRow>("SELECT * FROM style_videos WHERE profile_id = ? ORDER BY views DESC", [profileId]);
export const getVideo = (id: string) => getQuery<VideoRow>("SELECT * FROM style_videos WHERE id = ?", [id]);
export const updateVideo = (id: string, patch: Partial<VideoRow>) => patchRow("style_videos", VIDEO_COLS, id, patch, "updated_at");
export const findReusable = (owner: string, link: string) => getQuery<VideoRow>("SELECT v.* FROM style_videos v JOIN style_profiles p ON p.id = v.profile_id WHERE v.link = ? AND v.status = 'done' AND p.owner = ? ORDER BY v.updated_at DESC LIMIT 1", [link, owner]);
/** Claim nguyên tử: pending → processing. Trả VideoRow hoặc null nếu có worker khác đã lấy. */
export async function claimVideo(): Promise<VideoRow | null> {
  const row = await getQuery<VideoRow>("SELECT * FROM style_videos WHERE status = 'pending' ORDER BY is_exemplar DESC, views DESC LIMIT 1");
  if (!row) return null;
  const n = await runQueryChanges("UPDATE style_videos SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'", [NOW(), row.id]);
  return n === 1 ? (await getVideo(row.id)) || null : null;
}
```

- [ ] **Step 2: Viết test `server/style/pipeline.test.ts`**

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectDB } from "../db.js";
import { runFfmpeg } from "../studio/ffmpeg.js";
import { initStyleTables } from "./db.js";
import { createProfile, listVideos, getProfile, claimVideo, updateVideo } from "./store.js";
import { runStyleVideo, finalizeProfileIfDone, aggregateNow, recoverStyleInterrupted, type StyleDeps } from "./pipeline.js";
import { fakeStyleEngine } from "./analyze.js";
import { measureVideo } from "./measure.js";
import { STYLE } from "./config.js";

let sample = "";
before(async () => {
  process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); await initStyleTables();
  sample = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sp-")), "s.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=90x160:d=2:r=24", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", sample], { nice: false });
});
const deps = (): StyleDeps => ({ engine: fakeStyleEngine(), measure: measureVideo, download: async (_l, _p, dir) => { const d = path.join(dir, `dl_${Math.random().toString(36).slice(2)}.mp4`); fs.copyFileSync(sample, d); return { path: d }; } });
const vids = (n: number) => Array.from({ length: n }, (_, i) => ({ awemeId: `a${i}`, link: `https://www.tiktok.com/@x/video/a${i}`, title: `t${i}`, cover: "", views: 100 - i, likes: 1, createTime: Math.floor(Date.now() / 1000) - 86400, isExemplar: i < 2 }));

test("runStyleVideo: đo + phân tích + timeline cho mẫu chuẩn, xoá file tạm, đủ video → finalize done", { timeout: 120_000 }, async () => {
  (STYLE as any).minVideos = 2;
  const p = await createProfile({ owner: "k@nerman.asia", platform: "tiktok", handle: "x", nickname: "X", avatar: "", videos: vids(3), exemplarIds: ["a0", "a1"] });
  const d = deps();
  for (let i = 0; i < 3; i++) { const v = await claimVideo(); assert.ok(v, `claim lần ${i}`); const r = await runStyleVideo(v!, d); assert.ok(r.ok, `video ${i} lỗi`); }
  const rows = await listVideos(p.id);
  assert.equal(rows.filter((r) => r.status === "done").length, 3);
  const ex = rows.find((r) => r.is_exemplar === 1)!; assert.ok(ex.timeline && JSON.parse(ex.timeline).length >= 1, "mẫu chuẩn phải có timeline");
  const other = rows.find((r) => r.is_exemplar === 0)!; assert.equal(other.timeline, null);
  assert.ok(JSON.parse(rows[0].measure!).duration > 1.5, "measure phải có duration");
  assert.ok(JSON.parse(rows[0].analysis!).text.captionStyle === "sentence", "analysis từ fake engine");
  assert.equal(fs.readdirSync(STYLE.tmpDir).filter((f) => f.startsWith("dl_")).length, 0, "file tạm phải bị xoá");
  const prof = (await getProfile(p.id))!;
  assert.equal(prof.status, "done", prof.message || "");
  const profile = JSON.parse(prof.profile!);
  assert.equal(profile.videos.used, 3); assert.equal(profile.exemplars.length, 2);
  assert.ok(profile.formulas.opening[0].count >= 1 && typeof profile.formulas.opening[0].text === "string", "formulas phải qua cluster");
  assert.ok(prof.skill_md!.startsWith("---\nname: style-x"), prof.skill_md!.slice(0, 40));
});

test("tái dùng phiếu: link đã done ở profile khác cùng owner → không tải, không gọi engine", async () => {
  const p2 = await createProfile({ owner: "k@nerman.asia", platform: "tiktok", handle: "x", nickname: "X", avatar: "", videos: vids(1), exemplarIds: [] });
  let downloads = 0; const d = deps(); const dl = d.download; d.download = (...a) => { downloads++; return dl(...a); };
  const v = (await claimVideo())!; assert.equal(v.profile_id, p2.id);
  const r = await runStyleVideo(v, d); assert.ok(r.ok, "phải ok");
  assert.equal(downloads, 0);
  assert.equal((await listVideos(p2.id))[0].status, "done");
});

test("video lỗi tải → failed + error; dưới ngưỡng minVideos → profile failed có message", { timeout: 60_000 }, async () => {
  (STYLE as any).minVideos = 15;
  const p = await createProfile({ owner: "b@nerman.asia", platform: "tiktok", handle: "y", nickname: "Y", avatar: "", videos: [{ ...vids(1)[0], awemeId: "zz", link: "https://www.tiktok.com/@y/video/zz" }], exemplarIds: [] });
  const d = deps(); d.download = async () => { throw new Error("Video riêng tư"); };
  const v = (await claimVideo())!; const r = await runStyleVideo(v, d); assert.equal(r.ok, false);
  const row = (await listVideos(p.id))[0]; assert.equal(row.status, "failed"); assert.match(row.error || "", /riêng tư/);
  const prof = (await getProfile(p.id))!; assert.equal(prof.status, "failed"); assert.match(prof.message || "", /0\/1/);
});

test("recoverStyleInterrupted đưa processing → pending", async () => {
  const p = await createProfile({ owner: "c@nerman.asia", platform: "tiktok", handle: "z", nickname: "Z", avatar: "", videos: vids(1), exemplarIds: [] });
  const v = (await listVideos(p.id))[0]; await updateVideo(v.id, { status: "processing" });
  await recoverStyleInterrupted();
  assert.equal((await listVideos(p.id))[0].status, "pending");
});

test("aggregateNow chạy lại trên phiếu có sẵn, không đụng video", { timeout: 60_000 }, async () => {
  (STYLE as any).minVideos = 1;
  const p = await createProfile({ owner: "d@nerman.asia", platform: "tiktok", handle: "w", nickname: "W", avatar: "", videos: vids(1), exemplarIds: ["a0"] });
  const d = deps(); await runStyleVideo((await claimVideo())!, d);
  const before = (await getProfile(p.id))!.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  await aggregateNow(p.id, d);
  const after = (await getProfile(p.id))!; assert.equal(after.status, "done"); assert.notEqual(after.updated_at, before);
});
```

- [ ] **Step 3: Chạy test, phải FAIL (pipeline.js chưa có)**

- [ ] **Step 4: Viết `server/style/pipeline.ts`**

```ts
/**
 * server/style/pipeline.ts — việc nền của Style kênh (spec §3 bước 3–4, §11).
 * runStyleVideo: tải → đo → phân tích → (mẫu chuẩn) timeline → lưu → xoá tạm → finalize nếu đủ.
 * finalizeProfileIfDone: khi hết pending/processing → aggregate → cluster → narrate → SKILL.md → done/failed.
 */
import fs from "node:fs";
import { STYLE } from "./config.js";
import { measureVideo } from "./measure.js";
import { makeStyleEngine, type StyleEngine } from "./analyze.js";
import { aggregateProfile, type AggInput } from "./aggregate.js";
import { buildSkillMd } from "./skill.js";
import { getProfile, listVideos, updateProfile, updateVideo, findReusable } from "./store.js";
import { downloadTikTok, resolveTokapiKey } from "../tiktok.js";
import { downloadDouyin, resolveDouyinKey } from "../douyin.js";
import { runQuery } from "../db.js";
import type { StyleMeasure, StyleAnalysis, StyleTimelineShot, StyleProfile, VideoRow } from "./types.js";

export interface StyleDeps { engine: StyleEngine; measure: (path: string) => Promise<StyleMeasure>; download: (link: string, platform: string, dir: string) => Promise<{ path: string }> }

export function makeStyleDeps(apiKey: string): StyleDeps {
  return {
    engine: makeStyleEngine(apiKey), measure: measureVideo,
    download: async (link, platform, dir) => {
      if (platform === "douyin") { const k = resolveDouyinKey(undefined); if (!k) throw new Error("Chưa cấu hình DOUYIN_RAPIDAPI_KEY/TOKAPI_RAPIDAPI_KEY."); return downloadDouyin(link, k, dir); }
      const k = resolveTokapiKey(undefined); if (!k) throw new Error("Chưa cấu hình TOKAPI_RAPIDAPI_KEY."); return downloadTikTok(link, k, dir);
    },
  };
}
const isBilling = (e: any) => /api[_ ]?key|PERMISSION_DENIED|\b401\b|\b403\b|quota|RESOURCE_EXHAUSTED|billing/i.test(String(e?.message || e));
const parse = <T>(s: string | null, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export async function runStyleVideo(v: VideoRow, deps: StyleDeps): Promise<{ ok: boolean; kind?: "billing" }> {
  const profile = await getProfile(v.profile_id);
  if (!profile) { await updateVideo(v.id, { status: "failed", error: "Profile không còn tồn tại." }); return { ok: false }; }
  // Tái dùng phiếu cùng link của cùng owner (spec §3 bước 3)
  const prior = await findReusable(profile.owner, v.link);
  if (prior && prior.id !== v.id && prior.analysis) {
    await updateVideo(v.id, { status: "done", measure: prior.measure, analysis: prior.analysis, timeline: v.is_exemplar ? prior.timeline : null, frames: prior.frames, warnings: prior.warnings, error: null });
    console.log(`[style] Tái dùng phiếu style cho link trùng: ${v.link}`);
    await finalizeProfileIfDone(v.profile_id, deps).catch((e) => console.error("[style] finalize (reuse):", e));
    return { ok: true };
  }
  fs.mkdirSync(STYLE.tmpDir, { recursive: true });
  let file: string | null = null;
  try {
    file = (await deps.download(v.link, profile.platform, STYLE.tmpDir)).path;
    let measure: StyleMeasure | null = null;
    try { measure = await deps.measure(file); } catch (e) { console.warn(`[style] ffmpeg lỗi (${v.link}), Gemini tự ước lượng:`, String((e as any)?.message || e)); }
    const analysis: StyleAnalysis = await deps.engine.analyze({ videoPath: file, mimeType: "video/mp4", measure, meta: { title: v.title, platform: profile.platform === "douyin" ? "Douyin" : "TikTok", nickname: profile.nickname } });
    let timeline: StyleTimelineShot[] | null = null;
    if (v.is_exemplar) {
      try { timeline = await deps.engine.timeline({ videoPath: file, mimeType: "video/mp4", cuts: measure?.cuts || [], duration: measure?.duration || 0 }); }
      catch (e) { analysis.warnings.push(`timeline lỗi: ${String((e as any)?.message || e)}`); }
    }
    const frames = measure?.frames || []; if (measure) measure = { ...measure, frames: [] }; // frames lưu cột riêng
    await updateVideo(v.id, { status: "done", measure: JSON.stringify(measure), analysis: JSON.stringify(analysis), timeline: timeline ? JSON.stringify(timeline) : null, frames: JSON.stringify(frames), warnings: JSON.stringify(analysis.warnings), error: null });
    console.log(`[style] Xong phiếu style: ${v.title || v.link}`);
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500);
    await updateVideo(v.id, { status: "failed", error: msg });
    console.error(`[style] Lỗi video ${v.link}: ${msg}`);
    await finalizeProfileIfDone(v.profile_id, deps).catch(() => {});
    return { ok: false, kind: isBilling(e) ? "billing" : undefined };
  } finally {
    if (file) fs.promises.unlink(file).catch(() => {});
  }
  await finalizeProfileIfDone(v.profile_id, deps).catch((e) => console.error("[style] finalize:", e));
  return { ok: true };
}

function toAggInputs(rows: VideoRow[]): AggInput[] {
  return rows.filter((r) => r.status === "done" && r.analysis).map((r) => {
    const measure = parse<StyleMeasure | null>(r.measure, null); const frames = parse<string[]>(r.frames, []);
    return { videoId: r.aweme_id, link: r.link, views: r.views || 0, createTime: r.create_time || 0, measure: measure ? { ...measure, frames } : null, analysis: parse<StyleAnalysis>(r.analysis, null as any), timeline: parse<StyleTimelineShot[] | null>(r.timeline, null), isExemplar: r.is_exemplar === 1 };
  });
}

async function buildAndSave(profileId: string, deps: StyleDeps): Promise<void> {
  const p = (await getProfile(profileId))!; const rows = await listVideos(profileId);
  const inputs = toAggInputs(rows); const failed = rows.filter((r) => r.status === "failed").length;
  if (inputs.length < STYLE.minVideos) { await updateProfile(profileId, { status: "failed", message: `Chỉ ${inputs.length}/${rows.length} video phân tích được (cần ≥ ${STYLE.minVideos}). Bấm "Chạy lại video lỗi" hoặc hạ STYLE_MIN_VIDEOS.` }); return; }
  await updateProfile(profileId, { status: "aggregating", message: null });
  const agg = aggregateProfile(inputs, Math.floor(Date.now() / 1000), { platform: p.platform, handle: p.handle, nickname: p.nickname, avatar: p.avatar }, deps.engine.name === "fake" ? "fake" : STYLE.model);
  agg.videos.failed = failed;
  const cluster = async (kind: "opening" | "closing" | "cta") => { try { return await deps.engine.cluster({ kind, texts: agg.formulas[kind] }); } catch { return agg.formulas[kind].slice(0, 5).map((t) => ({ text: t, count: 1, examples: [t] })); } };
  const profile: StyleProfile = { ...agg, formulas: { opening: await cluster("opening"), closing: await cluster("closing"), cta: await cluster("cta") } };
  let narr = { overview: "", persona: "", howTo: "" };
  try { narr = await deps.engine.narrate({ profile }); } catch (e) { console.warn("[style] narrate lỗi, SKILL.md không có đoạn văn:", String((e as any)?.message || e)); }
  const fallback = "(AI chưa viết được đoạn này — xem số đo và quy tắc bên dưới.)";
  const skillMd = buildSkillMd(profile, { overview: narr.overview || fallback, persona: narr.persona || fallback, howTo: narr.howTo || fallback });
  await updateProfile(profileId, { status: "done", profile: JSON.stringify(profile), skill_md: skillMd, message: `Tổng hợp từ ${profile.videos.used}/${rows.length} video.` });
  console.log(`[style] Profile ${profileId} (${p.handle}) hoàn tất: ${profile.videos.used} video, ${profile.rules.hard.length} quy tắc cứng.`);
}

/** Gọi sau mỗi video. Chỉ tổng hợp khi không còn pending/processing. */
export async function finalizeProfileIfDone(profileId: string, deps: StyleDeps): Promise<boolean> {
  const p = await getProfile(profileId); if (!p || p.status === "done" || p.status === "aggregating") return false;
  const rows = await listVideos(profileId);
  if (rows.some((r) => r.status === "pending" || r.status === "processing")) return false;
  await buildAndSave(profileId, deps); return true;
}
/** Tổng hợp lại theo yêu cầu người dùng (từ phiếu đã có). */
export async function aggregateNow(profileId: string, deps: StyleDeps): Promise<void> { await buildAndSave(profileId, deps); }
/** Khi khởi động: video kẹt processing → pending; profile aggregating → running (finalize sẽ chạy lại khi có video kế tiếp hoặc người dùng bấm tổng hợp). */
export async function recoverStyleInterrupted(): Promise<void> {
  await runQuery("UPDATE style_videos SET status = 'pending' WHERE status = 'processing'");
  await runQuery("UPDATE style_profiles SET status = 'running' WHERE status = 'aggregating'");
}
```

- [ ] **Step 5: Chạy test, phải PASS**

```bash
npm test -- 2>&1 | grep -E "pipeline|^# (pass|fail)"
```

- [ ] **Step 6: Commit**

```bash
git add server/style/store.ts server/style/pipeline.ts server/style/pipeline.test.ts
git commit -m "feat(style): store + pipeline — tải/đo/phân tích/timeline, tái dùng phiếu, finalize → profile + SKILL.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Hàng đợi riêng — `queue.ts`

**Files:**
- Create: `server/style/queue.ts`, `server/style/queue.test.ts`

**Interfaces:**
- Consumes: `claimVideo` (store), `runStyleVideo`, `recoverStyleInterrupted`, `StyleDeps`, `STYLE.concurrency`.
- Produces: `startStyleQueue(deps, opts?: {intervalMs?})`, `stopStyleQueue()`, `bootStyleQueue(deps)`, `styleQueueStatus(): {active, pausedUntil, pauseReason, concurrency}`, `pauseStyleQueue(ms, reason)`.

- [ ] **Step 1: Viết test**

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connectDB } from "../db.js";
import { initStyleTables } from "./db.js";
import { createProfile, listVideos } from "./store.js";
import { startStyleQueue, stopStyleQueue, styleQueueStatus } from "./queue.js";
import type { StyleDeps } from "./pipeline.js";
import { fakeStyleEngine } from "./analyze.js";
import { STYLE } from "./config.js";

before(async () => { process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); await initStyleTables(); });
after(() => stopStyleQueue());

test("hàng đợi nhận việc pending, chạy song song ≤ concurrency, xong hết → profile done", { timeout: 30_000 }, async () => {
  (STYLE as any).minVideos = 1; (STYLE as any).concurrency = 2;
  let peak = 0, running = 0;
  const deps: StyleDeps = { engine: fakeStyleEngine(), measure: async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 150)); running--; return { duration: 5, width: 90, height: 160, aspect: "9:16", fps: 24, cuts: [2], cutsPerMin: 12, medianShotLen: 2.5, shotLenP10: 2, shotLenP90: 3, cutsIn3s: 1, loudness: { integratedLufs: -14, first3sLufs: -13 }, silenceStart: null, color: null, loopLikely: false, frames: [] }; }, download: async () => ({ path: "/dev/null" }) };
  const vids = Array.from({ length: 5 }, (_, i) => ({ awemeId: `q${i}`, link: `https://www.tiktok.com/@q/video/q${i}`, title: "", cover: "", views: 10 - i, likes: 0, createTime: 1, isExemplar: false }));
  const p = await createProfile({ owner: "q@nerman.asia", platform: "tiktok", handle: "q", nickname: "Q", avatar: "", videos: vids, exemplarIds: [] });
  startStyleQueue(deps, { intervalMs: 50 });
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000) { const rows = await listVideos(p.id); if (rows.every((r) => r.status === "done")) break; await new Promise((r) => setTimeout(r, 100)); }
  stopStyleQueue();
  assert.equal((await listVideos(p.id)).filter((r) => r.status === "done").length, 5);
  assert.ok(peak <= 2, `peak=${peak}`); assert.ok(peak >= 2, "phải chạy song song");
  assert.equal(styleQueueStatus().concurrency, 2);
});
```

- [ ] **Step 2: Chạy test, phải FAIL**

- [ ] **Step 3: Viết `server/style/queue.ts`**

```ts
/**
 * server/style/queue.ts — hàng đợi RIÊNG của Style kênh (khuôn studio/queue.ts): poll 3 s, claim nguyên tử, giới hạn song song,
 * tạm dừng 30 phút khi lỗi key/billing. Không dùng queue.ts của mổ xẻ (bảng khác).
 */
import { STYLE } from "./config.js";
import { claimVideo } from "./store.js";
import { runStyleVideo, recoverStyleInterrupted, type StyleDeps } from "./pipeline.js";

let active = 0, claiming = false, pausedUntil = 0, pauseReason = "";
let timer: ReturnType<typeof setInterval> | null = null;

export const styleQueueStatus = () => ({ active, pausedUntil, pauseReason, concurrency: STYLE.concurrency });
export function pauseStyleQueue(ms: number, reason: string) { pausedUntil = Date.now() + ms; pauseReason = reason; console.warn(`[style] Tạm dừng hàng đợi ${Math.round(ms / 60000)} phút: ${reason}`); }
export function stopStyleQueue() { if (timer) clearInterval(timer); timer = null; }

export function startStyleQueue(deps: StyleDeps, opts: { intervalMs?: number } = {}) {
  stopStyleQueue();
  console.log(`[style] Hàng đợi Style kênh: ${STYLE.concurrency} video song song, engine ${deps.engine.name}, model ${STYLE.model}.`);
  timer = setInterval(async () => {
    if (claiming || Date.now() < pausedUntil) return;
    claiming = true;
    try {
      while (active < STYLE.concurrency) {
        const v = await claimVideo(); if (!v) break;
        active++;
        runStyleVideo(v, deps)
          .then((r) => { if (r.kind === "billing") pauseStyleQueue(30 * 60_000, "lỗi key/quota Gemini"); })
          .catch((e) => console.error("[style] lỗi job:", e))
          .finally(() => { active--; });
      }
    } catch (e) { console.error("[style] vòng lặp hàng đợi:", e); }
    finally { claiming = false; }
  }, opts.intervalMs ?? 3000);
}
/** Gọi lúc khởi động server. */
export async function bootStyleQueue(deps: StyleDeps) { await recoverStyleInterrupted(); startStyleQueue(deps); }
```

- [ ] **Step 4: Chạy test, phải PASS**

- [ ] **Step 5: Commit**

```bash
git add server/style/queue.ts server/style/queue.test.ts
git commit -m "feat(style): hàng đợi riêng Style kênh — claim nguyên tử, song song có trần, pause khi lỗi billing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
---

### Task 11: API — `routes.ts`

**Files:**
- Create: `server/style/routes.ts`, `server/style/routes.test.ts`

**Interfaces:**
- Consumes: `requireEditor` (`server/auth.ts`), store, `pickStyleVideos`, `resolveAccount/normalizeAccountInput/fetchAccountVideos` (`server/account.ts`), `aggregateNow`, `buildSkillZip`, `StyleDeps`.
- Produces:
  ```ts
  interface RouterDeps { style: StyleDeps; resolveAccount: (input: string, key: string) => Promise<Account>; fetchAccountVideos: (account: Account, opts: {count: number; key: string}) => Promise<AccountVideo[]>; rapidKey: (platform: "tiktok"|"douyin") => string | null }
  makeStyleRouter(deps: RouterDeps): Router   // mount tại /api/style
  ```
  Route: `POST /pick`, `POST /create`, `GET /profiles`, `GET /profile/:id`, `POST /profile/:id/aggregate`, `POST /profile/:id/retry-failed`, `GET /profile/:id/skill.zip`, `DELETE /profile/:id` (spec §9).

- [ ] **Step 1: Viết test `server/style/routes.test.ts`**

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { connectDB, runQuery } from "../db.js";
import { signToken } from "../auth.js";
import { initStyleTables } from "./db.js";
import { makeStyleRouter } from "./routes.js";
import { fakeStyleEngine } from "./analyze.js";
import { listVideos, updateVideo } from "./store.js";
import { STYLE } from "./config.js";
import type { StyleDeps } from "./pipeline.js";

let base = "", server: any, admin = "", editor = "", guest = "";
const NOW = Math.floor(Date.now() / 1000);
const vids = Array.from({ length: 40 }, (_, i) => ({ awemeId: `r${i}`, desc: `d${i}`, author: "h", nickname: "H", link: `https://www.tiktok.com/@h/video/r${i}`, createTime: NOW - (i + 1) * 86400, stats: { source: "TikTok" as const, views: 5000 - i * 10, likes: 1, comments: 0, shares: 0, saves: 0 } }));
before(async () => {
  process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); await initStyleTables();
  await runQuery("INSERT OR IGNORE INTO users (email,password,salt,name,role,count,active,perms) VALUES ('e@nerman.asia','x','y','E','Biên tập',0,1,'{}')");
  await runQuery("INSERT OR IGNORE INTO users (email,password,salt,name,role,count,active,perms) VALUES ('g@nerman.asia','x','y','G','Khách',0,1,'{}')");
  admin = signToken({ email: "k@nerman.asia", role: "Quản trị" }); editor = signToken({ email: "e@nerman.asia", role: "Biên tập" }); guest = signToken({ email: "g@nerman.asia", role: "Khách" });
  const style: StyleDeps = { engine: fakeStyleEngine(), measure: async () => ({ duration: 5, width: 90, height: 160, aspect: "9:16", fps: 24, cuts: [], cutsPerMin: 0, medianShotLen: 5, shotLenP10: 5, shotLenP90: 5, cutsIn3s: 0, loudness: { integratedLufs: null, first3sLufs: null }, silenceStart: null, color: null, loopLikely: null, frames: [] }), download: async () => ({ path: "/dev/null" }) };
  const app = express(); app.use(express.json());
  app.use("/api/style", makeStyleRouter({ style, resolveAccount: async () => ({ platform: "tiktok", secId: "s", handle: "h", nickname: "H", avatar: "" }), fetchAccountVideos: async () => vids, rapidKey: () => "k" }));
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());
const H = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const j = (r: Response) => r.json() as Promise<any>;

test("Khách bị 403; Biên tập được", async () => {
  assert.equal((await fetch(`${base}/api/style/profiles`, { headers: H(guest) })).status, 403);
  assert.equal((await fetch(`${base}/api/style/profiles`, { headers: H(editor) })).status, 200);
});
test("pick → 30 video + 5 mẫu chuẩn; link sai → 400", async () => {
  const r = await j(await fetch(`${base}/api/style/pick`, { method: "POST", headers: H(editor), body: JSON.stringify({ url: "https://www.tiktok.com/@h" }) }));
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.videos.length, 30); assert.equal(r.exemplarIds.length, 5); assert.equal(r.account.handle, "h"); assert.equal(r.windowDays, 90);
  assert.equal((await fetch(`${base}/api/style/pick`, { method: "POST", headers: H(editor), body: JSON.stringify({ url: "!!!" }) })).status, 400);
});
test("create → profile running + videos pending; owner-scoping; aggregate; retry-failed; zip; delete", { timeout: 30_000 }, async () => {
  (STYLE as any).minVideos = 1;
  const pick = await j(await fetch(`${base}/api/style/pick`, { method: "POST", headers: H(editor), body: JSON.stringify({ url: "https://www.tiktok.com/@h", count: 3, exemplars: 1 }) }));
  const c = await j(await fetch(`${base}/api/style/create`, { method: "POST", headers: H(editor), body: JSON.stringify({ account: pick.account, videos: pick.videos, exemplarIds: pick.exemplarIds }) }));
  assert.ok(c.ok && c.profileId, JSON.stringify(c));
  const g = await j(await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(editor) }));
  assert.equal(g.profile.status, "running"); assert.equal(g.videos.length, 3); assert.equal(g.videos.filter((v: any) => v.status === "pending").length, 3);
  // người khác (không admin) không thấy; admin thấy
  const other = signToken({ email: "e2@nerman.asia", role: "Biên tập" }); await runQuery("INSERT OR IGNORE INTO users (email,password,salt,name,role,count,active,perms) VALUES ('e2@nerman.asia','x','y','E2','Biên tập',0,1,'{}')");
  assert.equal((await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(other) })).status, 404);
  assert.equal((await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(admin) })).status, 200);
  // giả lập worker: 2 done (analysis fake), 1 failed
  const rows = await listVideos(c.profileId); const { fakeStyleEngine: F } = await import("./analyze.js"); const a = await F().analyze({ videoPath: "", mimeType: "", measure: null, meta: { title: "", platform: "TikTok", nickname: "" } });
  for (const r of rows.slice(0, 2)) await updateVideo(r.id, { status: "done", analysis: JSON.stringify(a), measure: null, frames: "[]" });
  await updateVideo(rows[2].id, { status: "failed", error: "x" });
  const ag = await j(await fetch(`${base}/api/style/profile/${c.profileId}/aggregate`, { method: "POST", headers: H(editor) }));
  assert.ok(ag.ok, JSON.stringify(ag));
  const g2 = await j(await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(editor) }));
  assert.equal(g2.profile.status, "done"); assert.equal(g2.profile.profile.videos.used, 2);
  const rt = await j(await fetch(`${base}/api/style/profile/${c.profileId}/retry-failed`, { method: "POST", headers: H(editor) }));
  assert.equal(rt.requeued, 1);
  assert.equal((await listVideos(c.profileId)).filter((r) => r.status === "pending").length, 1);
  const z = await fetch(`${base}/api/style/profile/${c.profileId}/skill.zip?t=${editor}`);
  assert.equal(z.status, 200); assert.match(z.headers.get("content-disposition") || "", /style-h\.zip/); assert.ok((await z.arrayBuffer()).byteLength > 200, "zip phải có nội dung");
  assert.equal((await fetch(`${base}/api/style/profile/${c.profileId}`, { method: "DELETE", headers: H(other) })).status, 404);
  assert.equal((await j(await fetch(`${base}/api/style/profile/${c.profileId}`, { method: "DELETE", headers: H(editor) }))).ok, true);
  assert.equal((await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(editor) })).status, 404);
});
```

- [ ] **Step 2: Chạy test, phải FAIL**

- [ ] **Step 3: Viết `server/style/routes.ts`**

```ts
/**
 * server/style/routes.ts — API Style kênh (spec §9). Mỏng: kiểm đầu vào, quyền sở hữu, gọi store/pipeline.
 * Phụ thuộc ngoài (RapidAPI, engine) tiêm qua deps để test hermetic.
 */
import { Router, type Request, type Response } from "express";
import { requireEditor, verifyToken } from "../auth.js";
import { normalizeAccountInput, type Account, type AccountVideo } from "../account.js";
import { STYLE } from "./config.js";
import { pickStyleVideos } from "./pick.js";
import { createProfile, getProfile, listProfiles, listVideos, updateVideo, deleteProfile } from "./store.js";
import { aggregateNow, type StyleDeps } from "./pipeline.js";
import { buildSkillZip } from "./zip.js";
import { styleQueueStatus } from "./queue.js";
import type { ProfileRow, PickedVideo, StyleProfile } from "./types.js";

export interface RouterDeps {
  style: StyleDeps;
  resolveAccount: (input: string, key: string) => Promise<Account>;
  fetchAccountVideos: (account: Account, opts: { count: number; key: string }) => Promise<AccountVideo[]>;
  rapidKey: (platform: "tiktok" | "douyin") => string | null;
}
const ownerEmail = (req: any) => String(req?.user?.email || "").toLowerCase().trim();
const isAdmin = (req: any) => req?.user?.role === "Quản trị";
const parse = <T>(s: string | null, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export function makeStyleRouter(deps: RouterDeps): Router {
  const r = Router();
  async function owned(req: Request, res: Response, id: string): Promise<ProfileRow | null> {
    const p = await getProfile(id);
    if (!p || (!isAdmin(req) && p.owner !== ownerEmail(req))) { res.status(404).json({ ok: false, message: "Không tìm thấy profile." }); return null; }
    return p;
  }
  /** Ảnh/zip mở bằng <a href> không gửi header → chấp nhận token trên query `t`. */
  const authQuery = (req: Request, res: Response, next: () => void) => { const t = String(req.query.t || ""); const p = t ? verifyToken(t) : null; if (!p) return res.status(401).json({ ok: false }); (req as any).user = p; next(); };

  r.get("/health", requireEditor, (_req, res) => res.json({ ok: true, engine: STYLE.engine, model: STYLE.model, queue: styleQueueStatus(), minVideos: STYLE.minVideos }));

  r.post("/pick", requireEditor, async (req, res) => {
    try {
      const url = String(req.body?.url || "").trim();
      const norm = normalizeAccountInput(url);
      if (!norm) return res.status(400).json({ ok: false, message: "Link kênh không hợp lệ (tiktok.com/@ten hoặc douyin.com/user/...)." });
      const key = deps.rapidKey(norm.platform);
      if (!key) return res.status(400).json({ ok: false, message: "Chưa cấu hình RapidAPI key (TOKAPI_RAPIDAPI_KEY)." });
      let account: Account;
      try { account = await deps.resolveAccount(url, key); } catch (e: any) { return res.status(400).json({ ok: false, message: e?.message || "Không resolve được kênh." }); }
      const all = await deps.fetchAccountVideos(account, { count: 100, key });
      if (!all.length) return res.status(400).json({ ok: false, message: "Kênh không có video công khai (riêng tư hoặc bị chặn)." });
      const count = Math.min(Math.max(1, Number(req.body?.count) || STYLE.pickCount), 100);
      const exemplars = Math.min(Math.max(1, Number(req.body?.exemplars) || STYLE.exemplarCount), count);
      const picked = pickStyleVideos(all, Math.floor(Date.now() / 1000), { count, exemplars });
      res.json({ ok: true, account, ...picked, fetched: all.length });
    } catch (e: any) { console.error("[style] pick:", e); res.status(500).json({ ok: false, message: "Lỗi hệ thống khi lấy video kênh." }); }
  });

  r.post("/create", requireEditor, async (req, res) => {
    try {
      const account = req.body?.account; const incoming: any[] = Array.isArray(req.body?.videos) ? req.body.videos : []; const exemplarIds: string[] = Array.isArray(req.body?.exemplarIds) ? req.body.exemplarIds.map(String) : [];
      if (!account?.platform || !account?.handle) return res.status(400).json({ ok: false, message: "Thiếu thông tin kênh." });
      const videos: PickedVideo[] = incoming.filter((v) => v && v.awemeId && v.link).slice(0, 100).map((v) => ({ awemeId: String(v.awemeId), link: String(v.link), title: String(v.title || "").slice(0, 120), cover: String(v.cover || ""), views: Number(v.views) || 0, likes: Number(v.likes) || 0, createTime: Number(v.createTime) || 0, isExemplar: exemplarIds.includes(String(v.awemeId)) }));
      if (!videos.length) return res.status(400).json({ ok: false, message: "Chưa chọn video nào." });
      const p = await createProfile({ owner: ownerEmail(req), platform: account.platform, handle: String(account.handle), nickname: String(account.nickname || account.handle), avatar: String(account.avatar || ""), videos, exemplarIds: exemplarIds.filter((id) => videos.some((v) => v.awemeId === id)) });
      res.json({ ok: true, profileId: p.id, count: videos.length });
    } catch (e: any) { console.error("[style] create:", e); res.status(500).json({ ok: false, message: "Lỗi hệ thống khi tạo profile." }); }
  });

  r.get("/profiles", requireEditor, async (req, res) => res.json({ ok: true, profiles: (await listProfiles(isAdmin(req) ? null : ownerEmail(req))).map((p) => ({ ...p, profile: undefined, skill_md: undefined, hasProfile: !!p.profile })) }));

  r.get("/profile/:id", requireEditor, async (req, res) => {
    const p = await owned(req, res, req.params.id); if (!p) return;
    const videos = (await listVideos(p.id)).map((v) => ({ ...v, measure: parse(v.measure, null), analysis: parse(v.analysis, null), timeline: parse(v.timeline, null), frames: parse<string[]>(v.frames, []).slice(0, 2), warnings: parse(v.warnings, []) }));
    res.json({ ok: true, profile: { ...p, profile: parse<StyleProfile | null>(p.profile, null) }, videos });
  });

  r.post("/profile/:id/aggregate", requireEditor, async (req, res) => {
    const p = await owned(req, res, req.params.id); if (!p) return;
    try { await aggregateNow(p.id, deps.style); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ ok: false, message: e?.message || "Tổng hợp lỗi." }); }
  });

  r.post("/profile/:id/retry-failed", requireEditor, async (req, res) => {
    const p = await owned(req, res, req.params.id); if (!p) return;
    const failed = (await listVideos(p.id)).filter((v) => v.status === "failed");
    for (const v of failed) await updateVideo(v.id, { status: "pending", error: null });
    if (failed.length) await (await import("./store.js")).updateProfile(p.id, { status: "running", message: null });
    res.json({ ok: true, requeued: failed.length });
  });

  r.get("/profile/:id/skill.zip", authQuery, async (req, res) => {
    const p = await owned(req, res, req.params.id); if (!p) return;
    const profile = parse<StyleProfile | null>(p.profile, null);
    if (!profile || !p.skill_md) return res.status(409).json({ ok: false, message: "Profile chưa tổng hợp xong." });
    const { name, buffer } = buildSkillZip(profile, p.skill_md);
    res.setHeader("Content-Type", "application/zip"); res.setHeader("Content-Disposition", `attachment; filename="${name}"`); res.send(buffer);
  });

  r.delete("/profile/:id", requireEditor, async (req, res) => { const p = await owned(req, res, req.params.id); if (!p) return; await deleteProfile(p.id); res.json({ ok: true }); });
  return r;
}
```

Lưu ý `verifyToken` đã export ở `server/auth.ts:50`; `requireEditor` kiểm role trong bảng `users` (test seed user Biên tập/Khách vì thế).

- [ ] **Step 4: Chạy test, phải PASS**

```bash
npm test -- 2>&1 | grep -E "routes|^# (pass|fail)"
```

- [ ] **Step 5: Commit**

```bash
git add server/style/routes.ts server/style/routes.test.ts
git commit -m "feat(style): API /api/style — pick/create/profiles/aggregate/retry/zip/delete, owner-scoping, deps tiêm được

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Nối vào server — `index.ts`, chạy toàn bộ test

**Files:**
- Modify: `server/index.ts:33-36` (import), `server/index.ts:51` (mount), `server/index.ts:1325-1329` (`startServer`)
- Modify: `.env.example` (thêm biến STYLE_*)

- [ ] **Step 1: Thêm import (sau dòng `import { makeEngines as makeStudioEngines } from "./studio/pipeline.js";`)**

```ts
import { makeStyleRouter } from "./style/routes.js";
import { initStyleTables } from "./style/db.js";
import { bootStyleQueue } from "./style/queue.js";
import { makeStyleDeps } from "./style/pipeline.js";
```

- [ ] **Step 2: Mount router (sau dòng `app.use("/api/studio", studioRouter);`)**

```ts
const styleDeps = makeStyleDeps((process.env.GEMINI_API_KEY || "").trim());
app.use("/api/style", makeStyleRouter({
  style: styleDeps,
  resolveAccount: (input, key) => resolveAccount(input, key),
  fetchAccountVideos: (account, opts) => fetchAccountVideos(account, { count: opts.count, key: opts.key }),
  rapidKey: (platform) => (platform === "douyin" ? resolveDouyinKey(undefined) : resolveTokapiKey(undefined)),
})); // Style kênh — phân tích phong cách dựng → skill
```

- [ ] **Step 3: Init bảng + boot queue trong `startServer()` (sau `await initStudioTables();`)**

```ts
  await initStyleTables();
  bootStyleQueue(styleDeps).catch((e) => console.error("[style] khởi động hàng đợi:", e));
```

- [ ] **Step 4: `.env.example` — thêm khối**

```
# ── Style kênh ──
# STYLE_MODEL=gemini-2.5-flash        # mặc định = GEMINI_MODEL
# STYLE_ENGINE=gemini                 # fake = không gọi AI (test)
# STYLE_TMP_DIR=./data/style-tmp      # prod: /app/data/style-tmp (mount từ /data)
# STYLE_CONCURRENCY=4
# STYLE_SCENE_THRESHOLD=0.35
# STYLE_MIN_VIDEOS=15
# STYLE_OUTLIER_LAYERS=3
```

- [ ] **Step 5: Chạy server local 10 giây để chắc boot không lỗi**

```bash
nvm use 22 && STYLE_ENGINE=fake DB_PATH=/tmp/style-boot.sqlite PORT=8799 timeout 12 npx tsx server/index.ts 2>&1 | grep -E "style|lỗi|Error" ; true
```
Expected: có dòng `[style] Hàng đợi Style kênh: 4 video song song, engine fake…`, không có `Error`. (macOS không có `timeout` → dùng `gtimeout` từ coreutils hoặc chạy nền rồi `kill`.)

- [ ] **Step 6: Toàn bộ test xanh + build frontend vẫn qua**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"; npm run build 2>&1 | tail -2
```
Expected: `# fail 0`; build OK (frontend chưa đổi).

- [ ] **Step 7: Commit**

```bash
git add server/index.ts .env.example
git commit -m "feat(style): nối Style kênh vào server — mount /api/style, init bảng, boot hàng đợi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
---

### Task 13: Giao diện — `src/style/*`, đăng ký tab trong `App.tsx`

**Files:**
- Create: `src/style/styleApi.ts`, `src/style/StyleView.tsx`, `src/style/PickForm.tsx`, `src/style/ProgressPanel.tsx`, `src/style/ProfileView.tsx`
- Modify: `src/App.tsx:11` (import), `:429-439` (navDef), `:440-452` (titles), `:835` + `:961` (gating), `:837-848` + `:963-971` (icon), `:932` (render)

**Interfaces:**
- Consumes: `authHeaders()` từ `src/lib/api.ts`; `css as c` từ `src/lib/csx`; API Task 11.
- Produces: `<StyleView isMobile integration showToast isAdmin />` cùng chữ ký props với `StudioView`.

Repo chưa có test UI; kiểm bằng `npm run build` (tsc + vite) và chạy tay với `STYLE_ENGINE=fake`.

- [ ] **Step 1: `src/style/styleApi.ts`**

```ts
/** src/style/styleApi.ts — client cho /api/style. Zip tải qua <a href> nên token gắn trên query `t`. */
import { authHeaders } from "../lib/api";
const jh = () => ({ ...authHeaders(), "Content-Type": "application/json" });
const parse = (r: Response) => r.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ từ server." }));

export const getStyleHealth = () => fetch("/api/style/health", { headers: authHeaders() }).then(parse);
export const pickStyle = (url: string, count = 30, exemplars = 5) => fetch("/api/style/pick", { method: "POST", headers: jh(), body: JSON.stringify({ url, count, exemplars }) }).then(parse);
export const createStyle = (body: { account: any; videos: any[]; exemplarIds: string[] }) => fetch("/api/style/create", { method: "POST", headers: jh(), body: JSON.stringify(body) }).then(parse);
export const listStyleProfiles = () => fetch("/api/style/profiles", { headers: authHeaders() }).then(parse);
export const getStyleProfile = (id: string) => fetch(`/api/style/profile/${id}`, { headers: authHeaders() }).then(parse);
export const aggregateStyle = (id: string) => fetch(`/api/style/profile/${id}/aggregate`, { method: "POST", headers: jh() }).then(parse);
export const retryStyleFailed = (id: string) => fetch(`/api/style/profile/${id}/retry-failed`, { method: "POST", headers: jh() }).then(parse);
export const deleteStyleProfile = (id: string) => fetch(`/api/style/profile/${id}`, { method: "DELETE", headers: authHeaders() }).then(parse);
export function styleZipUrl(id: string): string { let t = ""; try { t = localStorage.getItem("nonelab_token") || ""; } catch {} return `/api/style/profile/${id}/skill.zip?t=${encodeURIComponent(t)}`; }
export const fmtN = (n: number) => Math.round(n || 0).toLocaleString("vi-VN");
```

- [ ] **Step 2: `src/style/PickForm.tsx`**

```tsx
import { useState } from "react";
import { css as c } from "../lib/csx";
import { pickStyle, createStyle, fmtN } from "./styleApi";

export function PickForm({ showToast, onCreated, onCancel }: { showToast: (m: string) => void; onCreated: (id: string) => void; onCancel: () => void }) {
  const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null); const [off, setOff] = useState<Set<string>>(new Set()); const [ex, setEx] = useState<Set<string>>(new Set());
  const pick = async () => {
    if (!url.trim()) return showToast("Nhập link kênh trước.");
    setBusy(true); const r = await pickStyle(url.trim()); setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không lấy được video.");
    setRes(r); setOff(new Set()); setEx(new Set(r.exemplarIds));
  };
  const toggle = (s: Set<string>, id: string, set: (v: Set<string>) => void) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); set(n); };
  const create = async () => {
    const videos = res.videos.filter((v: any) => !off.has(v.awemeId)); const exemplarIds = [...ex].filter((id) => !off.has(id));
    if (videos.length < 5) return showToast("Cần ít nhất 5 video.");
    setBusy(true); const r = await createStyle({ account: res.account, videos, exemplarIds }); setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không tạo được."); showToast(`Đã xếp ${r.count} video vào hàng đợi.`); onCreated(r.profileId);
  };
  const box = c("background:#fff;border:1px solid #ece4d6;border-radius:16px;padding:18px;margin-bottom:14px");
  return (
    <div>
      <div style={box}>
        <div style={c("font-weight:600;margin-bottom:8px")}>Link kênh TikTok / Douyin</div>
        <div style={c("display:flex;gap:8px;flex-wrap:wrap")}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@kenh hoặc douyin.com/user/…" style={c("flex:1;min-width:240px;padding:10px 12px;border:1px solid #ddd3c2;border-radius:10px;font-size:14px")} />
          <button disabled={busy} onClick={pick} style={c("padding:10px 16px;border-radius:10px;border:0;background:#b06a16;color:#fff;font-weight:600;cursor:pointer")}>{busy ? "Đang lấy…" : "Lấy video"}</button>
          <button onClick={onCancel} style={c("padding:10px 14px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>Huỷ</button>
        </div>
        <div style={c("font-size:12px;color:#8a7c67;margin-top:8px")}>Hệ thống lấy 100 video gần nhất → chọn 30 view cao nhất trong 90 ngày (nới dần nếu thiếu) → 5 view cao nhất là mẫu chuẩn (được tách timeline từng cut). Bỏ tick video lạc style trước khi chạy.</div>
      </div>
      {res && (
        <div style={box}>
          <div style={c("display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px")}>
            <div><b>@{res.account.handle}</b> · {res.account.nickname} · {res.fetched} video lấy về · {res.note}</div>
            <button disabled={busy} onClick={create} style={c("padding:10px 16px;border-radius:10px;border:0;background:#3c7a5e;color:#fff;font-weight:600;cursor:pointer")}>Phân tích style ({res.videos.length - off.size} video)</button>
          </div>
          {res.windowDays > 90 && <div style={c("margin-top:8px;padding:8px 12px;background:#fff6e5;border-radius:10px;font-size:13px")}>⚠ Kênh không đủ 30 video trong 90 ngày — đã nới lên {res.windowDays} ngày; video cũ tính trọng số 0,5.</div>}
          <table style={c("width:100%;margin-top:12px;font-size:13px;border-collapse:collapse")}>
            <thead><tr style={c("text-align:left;color:#8a7c67")}><th>Dùng</th><th>Mẫu chuẩn</th><th>Video</th><th style={c("text-align:right")}>View</th><th>Ngày</th></tr></thead>
            <tbody>{res.videos.map((v: any) => (
              <tr key={v.awemeId} style={{ opacity: off.has(v.awemeId) ? 0.45 : 1, borderTop: "1px solid #f1eadf" }}>
                <td><input type="checkbox" checked={!off.has(v.awemeId)} onChange={() => toggle(off, v.awemeId, setOff)} /></td>
                <td><input type="checkbox" checked={ex.has(v.awemeId)} onChange={() => toggle(ex, v.awemeId, setEx)} /></td>
                <td><a href={v.link} target="_blank" rel="noreferrer" style={c("color:#574a3a")}>{v.title || v.link}</a></td>
                <td style={c("text-align:right")}>{fmtN(v.views)}</td>
                <td>{v.createTime ? new Date(v.createTime * 1000).toLocaleDateString("vi-VN") : ""}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `src/style/ProgressPanel.tsx`**

```tsx
import { css as c } from "../lib/csx";
import { retryStyleFailed, aggregateStyle } from "./styleApi";

export function ProgressPanel({ bundle, showToast, reload }: { bundle: any; showToast: (m: string) => void; reload: () => void }) {
  const vids: any[] = bundle.videos; const done = vids.filter((v) => v.status === "done").length; const failed = vids.filter((v) => v.status === "failed");
  const p = bundle.profile;
  return (
    <div style={c("background:#fff;border:1px solid #ece4d6;border-radius:16px;padding:18px;margin-bottom:14px")}>
      <div style={c("display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px")}>
        <div><b>{done}/{vids.length}</b> video đã phân tích · {failed.length} lỗi · trạng thái: <b>{p.status}</b>{p.message ? ` — ${p.message}` : ""}</div>
        <div style={c("display:flex;gap:8px")}>
          {failed.length > 0 && <button onClick={async () => { const r = await retryStyleFailed(p.id); showToast(r?.ok ? `Đã đẩy lại ${r.requeued} video.` : r?.message || "Lỗi"); reload(); }} style={c("padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>Chạy lại video lỗi</button>}
          {(p.status === "failed" || p.status === "done") && done > 0 && <button onClick={async () => { const r = await aggregateStyle(p.id); showToast(r?.ok ? "Đã tổng hợp lại." : r?.message || "Lỗi"); reload(); }} style={c("padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>Tổng hợp lại</button>}
        </div>
      </div>
      <div style={c("height:8px;background:#f1eadf;border-radius:6px;margin-top:10px;overflow:hidden")}><div style={{ ...c("height:100%;background:#3c7a5e"), width: `${vids.length ? (done / vids.length) * 100 : 0}%` }} /></div>
      {failed.length > 0 && <ul style={c("margin:10px 0 0;padding-left:18px;font-size:13px;color:#9e3a3a")}>{failed.map((v) => <li key={v.id}><a href={v.link} target="_blank" rel="noreferrer">{v.title || v.link}</a>: {v.error}</li>)}</ul>}
    </div>
  );
}
```

- [ ] **Step 4: `src/style/ProfileView.tsx`**

```tsx
import { css as c } from "../lib/csx";
import { styleZipUrl, fmtN } from "./styleApi";

const LAYER: Record<string, string> = { structure: "Cấu trúc & nhịp", visual: "Hình ảnh & khung", text: "Text & đồ hoạ", audio: "Âm thanh", content: "Nội dung & giọng điệu", brand: "Nhận diện thương hiệu" };
const card = c("background:#fff;border:1px solid #ece4d6;border-radius:16px;padding:18px;margin-bottom:14px");

export function ProfileView({ bundle, isMobile }: { bundle: any; isMobile: boolean }) {
  const p = bundle.profile; const sp = p.profile; if (!sp) return null;
  const m = sp.metrics; const row = (k: string, s: any, unit = "") => <tr key={k}><td>{k}</td><td style={c("text-align:right")}><b>{s.median}</b>{unit}</td><td style={c("text-align:right;color:#8a7c67")}>{s.p25}–{s.p75}</td><td style={c("text-align:right;color:#8a7c67")}>{s.n}</td></tr>;
  const list = (xs: string[], color: string) => (xs.length ? <ul style={c("margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.5")}>{xs.map((x, i) => <li key={i} style={{ color }}>{x}</li>)}</ul> : <div style={c("font-size:13px;color:#8a7c67")}>—</div>);
  return (
    <div>
      <div style={card}>
        <div style={c("display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px")}>
          <div><b>@{sp.channel.handle}</b> · {sp.channel.nickname} · tổng hợp từ {sp.videos.used}/{sp.videos.total} video ({sp.videos.outliers.length} lệch style bị loại) · {sp.analyzedAt.slice(0, 10)}</div>
          <a href={styleZipUrl(p.id)} style={c("padding:10px 16px;border-radius:10px;background:#b06a16;color:#fff;font-weight:600;text-decoration:none")}>⬇ Tải skill .zip</a>
        </div>
      </div>
      <div style={{ ...c("display:grid;gap:14px"), gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
        <div style={card}><div style={c("font-weight:600;margin-bottom:6px")}>Số đo cốt lõi</div>
          <table style={c("width:100%;font-size:13px;border-collapse:collapse")}><thead><tr style={c("color:#8a7c67;text-align:right")}><th style={c("text-align:left")}>Chỉ số</th><th>Trung vị</th><th>P25–P75</th><th>n</th></tr></thead>
            <tbody>{row("Độ dài video", m.duration, " s")}{row("Nhịp cắt", m.cutsPerMin, " cut/phút")}{row("Độ dài shot", m.shotLen, " s")}{row("Âm lượng", m.loudness, " LUFS")}{row("Talking-head", m.talkingHeadRatio)}{row("B-roll", m.brollRatio)}</tbody></table></div>
        <div style={card}><div style={c("font-weight:600")}>KHÔNG BAO GIỜ</div>{list(sp.rules.never, "#9e3a3a")}</div>
        <div style={card}><div style={c("font-weight:600")}>Quy tắc cứng (≥ 70 %)</div>{list(sp.rules.hard, "#2a5a44")}</div>
        <div style={card}><div style={c("font-weight:600")}>Quy tắc mềm (40–69 %)</div>{list(sp.rules.soft, "#574a3a")}</div>
      </div>
      <div style={{ ...c("display:grid;gap:14px"), gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr" }}>
        {Object.keys(LAYER).map((L) => (
          <div key={L} style={card}><div style={c("font-weight:600;margin-bottom:6px")}>{LAYER[L]}</div>
            <table style={c("width:100%;font-size:12px;border-collapse:collapse")}><tbody>{Object.entries(sp.layers[L] || {}).filter(([, f]: any) => f.rule !== "none").map(([k, f]: any) => (
              <tr key={k} style={c("border-top:1px solid #f1eadf")}><td style={c("color:#8a7c67")}>{k}</td><td><b>{f.value}</b></td><td style={c("text-align:right")}>{Math.round(f.share * 100)} %</td><td style={{ color: f.rule === "hard" ? "#2a5a44" : "#b06a16" }}>{f.rule === "hard" ? "cứng" : "mềm"}</td></tr>))}</tbody></table>
            {Object.entries(sp.evidence || {}).filter(([k]) => k.startsWith(L + ".")).slice(0, 2).map(([k, urls]: any) => <div key={k} style={c("display:flex;gap:6px;margin-top:8px")}>{urls.slice(0, 3).map((u: string, i: number) => <img key={i} src={u} alt={k} style={c("height:72px;border-radius:8px")} />)}</div>)}
          </div>))}
      </div>
      <div style={card}><div style={c("font-weight:600;margin-bottom:6px")}>Công thức lặp lại</div>
        {(["opening", "closing", "cta"] as const).map((k) => <div key={k} style={c("margin-bottom:8px")}><div style={c("font-size:12px;color:#8a7c67;text-transform:uppercase")}>{k === "opening" ? "Mở đầu" : k === "closing" ? "Chốt" : "CTA"}</div>{sp.formulas[k].length ? sp.formulas[k].map((f: any, i: number) => <div key={i} style={c("font-size:13px")}>• <b>{f.text}</b> — {f.count} lần{f.examples?.[0] ? ` · “${f.examples[0]}”` : ""}</div>) : <div style={c("font-size:13px;color:#8a7c67")}>—</div>}</div>)}
      </div>
      {sp.exemplars.map((e: any, i: number) => (
        <div key={e.videoId} style={card}><div style={c("font-weight:600;margin-bottom:6px")}>Mẫu chuẩn {i + 1} · <a href={e.link} target="_blank" rel="noreferrer">{e.link}</a> · {fmtN(e.views)} view{e.duration ? ` · ${e.duration} s` : ""}</div>
          <div style={c("overflow-x:auto")}><table style={c("width:100%;font-size:12px;border-collapse:collapse;min-width:640px")}><thead><tr style={c("color:#8a7c67;text-align:left")}><th>Từ–đến</th><th>Shot</th><th>Chữ</th><th>Anim</th><th>SFX</th><th>Nhạc</th><th>Lời</th></tr></thead>
            <tbody>{e.timeline.map((t: any, j: number) => <tr key={j} style={c("border-top:1px solid #f1eadf")}><td>{t.from}–{t.to}</td><td>{t.shot}</td><td>{t.textOnScreen}</td><td>{t.textAnim}</td><td>{t.sfx}</td><td>{t.music}</td><td>{t.voice}</td></tr>)}</tbody></table></div></div>))}
      {sp.videos.outliers.length > 0 && <div style={card}><div style={c("font-weight:600;margin-bottom:6px")}>Video bị loại khi tổng hợp (lệch style)</div><ul style={c("margin:0;padding-left:18px;font-size:13px")}>{sp.videos.outliers.map((o: any) => <li key={o.videoId}>{o.videoId}: {o.reasons.join("; ")}</li>)}</ul></div>}
    </div>
  );
}
```

- [ ] **Step 5: `src/style/StyleView.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { css as c } from "../lib/csx";
import { listStyleProfiles, getStyleProfile, deleteStyleProfile, fmtN } from "./styleApi";
import { PickForm } from "./PickForm";
import { ProgressPanel } from "./ProgressPanel";
import { ProfileView } from "./ProfileView";

export function StyleView({ isMobile, showToast }: { isMobile: boolean; integration: { key: string; model: string }; showToast: (m: string) => void; isAdmin?: boolean }) {
  const [mode, setMode] = useState<"list" | "new" | "profile">("list");
  const [profiles, setProfiles] = useState<any[]>([]); const [bundle, setBundle] = useState<any>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reloadList = async () => { const r = await listStyleProfiles(); if (r?.ok) setProfiles(r.profiles); };
  const load = async (id: string) => { const r = await getStyleProfile(id); if (r?.ok) setBundle(r); else showToast(r?.message || "Không tải được profile."); };
  useEffect(() => { reloadList(); }, []);
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (mode !== "profile" || !bundle) return;
    const busy = ["running", "aggregating"].includes(bundle.profile.status);
    if (!busy) return;
    timer.current = setInterval(() => load(bundle.profile.id), 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [mode, bundle?.profile?.id, bundle?.profile?.status]);
  const open = async (id: string) => { await load(id); setMode("profile"); };

  if (mode === "new") return <PickForm showToast={showToast} onCancel={() => setMode("list")} onCreated={(id) => { reloadList(); open(id); }} />;
  if (mode === "profile" && bundle) return (
    <div>
      <button onClick={() => { setMode("list"); reloadList(); }} style={c("margin-bottom:12px;padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>← Danh sách</button>
      <ProgressPanel bundle={bundle} showToast={showToast} reload={() => load(bundle.profile.id)} />
      {bundle.profile.status === "done" && <ProfileView bundle={bundle} isMobile={isMobile} />}
    </div>);
  return (
    <div>
      <div style={c("display:flex;justify-content:space-between;align-items:center;margin-bottom:12px")}>
        <div style={c("color:#8a7c67;font-size:13px")}>Mỗi kênh → 1 Style Profile → 1 skill .zip cho AI dựng clip cùng phong cách.</div>
        <button onClick={() => setMode("new")} style={c("padding:10px 16px;border-radius:10px;border:0;background:#b06a16;color:#fff;font-weight:600;cursor:pointer")}>＋ Phân tích kênh mới</button>
      </div>
      {profiles.length === 0 && <div style={c("background:#fff;border:1px dashed #ddd3c2;border-radius:16px;padding:28px;text-align:center;color:#8a7c67")}>Chưa có profile nào.</div>}
      {profiles.map((p) => (
        <div key={p.id} onClick={() => open(p.id)} style={c("background:#fff;border:1px solid #ece4d6;border-radius:14px;padding:14px 16px;margin-bottom:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap")}>
          <div><b>@{p.handle}</b> · {p.nickname} · {p.platform}<div style={c("font-size:12px;color:#8a7c67")}>{p.done}/{p.total} video · {p.failed} lỗi · {p.status} · {new Date(p.created_at).toLocaleString("vi-VN")}{p.owner ? ` · ${p.owner}` : ""}</div></div>
          <button onClick={async (e) => { e.stopPropagation(); if (!confirm(`Xoá profile @${p.handle}?`)) return; const r = await deleteStyleProfile(p.id); showToast(r?.ok ? "Đã xoá." : r?.message || "Lỗi"); reloadList(); }} style={c("padding:6px 10px;border-radius:8px;border:1px solid #ddd3c2;background:#fff;cursor:pointer;font-size:12px")}>Xoá</button>
        </div>))}
    </div>
  );
}
```

- [ ] **Step 6: Nối vào `src/App.tsx` (6 chỗ — cùng bài học Xưởng)**

1. Sau `import { StudioView } from "./studio/StudioView";` thêm `import { StyleView } from "./style/StyleView";`
2. `navDef`: sau dòng `studio` thêm `{ key: "style", label: "Style kênh", sub: "Phân tích phong cách dựng 30 video của một kênh → skill cho AI" },`
3. `titles`: thêm `style: ["Style kênh", "Phong cách dựng của kênh theo 6 lớp → Style Profile + skill tải về"],`
4. Gating desktop (dòng ~835): thêm `|| it.key === "style"` vào điều kiện `(it.key === "ads" || … || it.key === "studio")`.
5. Icon desktop + mobile: thêm `style: "🎬",` vào cả 2 object `icons`. Gating mobile (dòng ~961): `(it.key === "seedframe" || it.key === "studio" || it.key === "style")`.
6. Render (sau dòng `{screen === "studio" && …}`): `{screen === "style" && <StyleView isMobile={isMobile} integration={integration} showToast={showToast} isAdmin={user?.role === "Quản trị"} />}`
   Kiểu `Screen`: tìm `type Screen =` (grep, vì số dòng đổi) và thêm `| "style"`; nếu `navDef` khai báo `key: Screen | "account"` thì mở rộng thành `Screen | "account" | "style"` cho khớp.

- [ ] **Step 7: Build + chạy tay với engine fake**

```bash
nvm use 22 && npm run build 2>&1 | tail -3
STYLE_ENGINE=fake npm run dev
```
Mở http://localhost:5173 → tab **Style kênh** → dán `https://www.tiktok.com/@<kênh thật>` → Lấy video (RapidAPI thật) → Phân tích → xem tiến độ (engine fake trả phiếu ngay) → profile hiện 6 lớp → Tải skill .zip → giải nén kiểm `SKILL.md`.
Expected: build không lỗi TypeScript; zip mở được.

- [ ] **Step 8: Commit**

```bash
git add src/style src/App.tsx
git commit -m "feat(style): giao diện Style kênh — chọn video, tiến độ, profile 6 lớp, tải skill .zip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Deploy lên 163.44.193.87 (rsync) + chạy kênh thật

**Files:**
- Create: `scripts/deploy-videoana.sh`
- Modify: `docker-compose.yml` (mount `/data`)

Bối cảnh: `/var/www/videoana` trên server KHÔNG phải git (bản copy ~29/07, chưa có Xưởng); `.env` và `data/` giữ nguyên trên server; ổ `/` đã dọn còn 19 GB (25/09).

- [ ] **Step 1: `docker-compose.yml` — thêm mount tạm cho style**

Trong `environment` thêm `- STYLE_TMP_DIR=/app/data/style-tmp`; trong `volumes` thêm `- /data/videoana-style-tmp:/app/data/style-tmp`. Giữ nguyên các dòng Xưởng đã có.

- [ ] **Step 2: `scripts/deploy-videoana.sh`**

```bash
#!/usr/bin/env bash
# Deploy Nonelab Studio lên 163.44.193.87 bằng rsync (server không phải git). Giữ .env, data/, node_modules của server.
set -euo pipefail
HOST=root@163.44.193.87; DIR=/var/www/videoana
cd "$(dirname "$0")/.."
git diff --quiet || { echo "Còn thay đổi chưa commit — commit trước."; exit 1; }
ssh "$HOST" "mkdir -p /data/videoana-studio /data/videoana-style-tmp && cp $DIR/data/db.sqlite $DIR/data/db.sqlite.bak-\$(date +%Y%m%d-%H%M%S)"
rsync -az --delete --exclude .git --exclude node_modules --exclude dist --exclude data --exclude .env --exclude 'server/uploads/*' --exclude 'server/db.sqlite*' --exclude chats --exclude project ./ "$HOST:$DIR/"
ssh "$HOST" "cd $DIR && docker compose up -d --build 2>&1 | tail -3 && sleep 8 && curl -sf localhost:8787/api/health && echo && docker logs --tail 5 videoana-app 2>&1 | grep -E 'style|xuong|nonelab' "
curl -sf https://video.nonelab.net/api/health && echo
```

`chmod +x scripts/deploy-videoana.sh`.

- [ ] **Step 3: Kiểm `.env` server có đủ biến** (không in giá trị)

```bash
ssh root@163.44.193.87 "grep -oE '^(GEMINI_API_KEY|TOKAPI_RAPIDAPI_KEY|DOUYIN_RAPIDAPI_KEY|JWT_SECRET|GEMINI_MODEL)=' /var/www/videoana/.env"
```
Expected: 4–5 dòng. Thiếu `TOKAPI_RAPIDAPI_KEY` → Kevin bổ sung trước khi deploy.

- [ ] **Step 4: Deploy**

```bash
./scripts/deploy-videoana.sh
```
Expected: `{"ok":true,...}` từ localhost và từ `video.nonelab.net`; log có `[style] Hàng đợi Style kênh` và `[xuong] Hàng đợi Xưởng`.

- [ ] **Step 5: Kiểm bundle live có tab mới**

```bash
js=$(curl -s https://video.nonelab.net/ | grep -oE '/assets/[^"]+\.js' | head -1); curl -s "https://video.nonelab.net$js" | grep -c "Style kênh"
```
Expected: ≥ 1. Nếu 0 → Cloudflare cache; xem [[cloudflare-cache-static]] (purge hoặc đợi 4 h).

- [ ] **Step 6: Chạy kênh thật nhỏ (đo chi phí + thời gian)**

Đăng nhập Quản trị → Style kênh → dán một kênh Nerman → trong bảng bỏ tick còn **10 video**, 2 mẫu chuẩn → Phân tích. Theo dõi `docker logs -f videoana-app | grep style`. Ghi lại: thời gian tổng, số video failed, kích cỡ zip, và kiểm SKILL.md có đủ 3 đoạn văn + số đo khớp UI. Nếu ≥ 3/10 video failed vì Gemini JSON → tăng `temperature` xuống 0.2 và thử lại trước khi mở cho Biên tập. Với 10 video, `STYLE_MIN_VIDEOS=15` sẽ làm profile `failed` → tạm đặt `STYLE_MIN_VIDEOS=8` trong `.env` server cho lần thử này rồi trả về 15.

- [ ] **Step 7: Commit + push + cập nhật memory**

```bash
git add scripts/deploy-videoana.sh docker-compose.yml
git commit -m "chore(deploy): script rsync deploy videoana + mount /data cho Xưởng và Style kênh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```
Memory `videoana-deploy.md`: ghi "deploy bằng scripts/deploy-videoana.sh (rsync), Xưởng + Style kênh live ngày …, chi phí thật/kênh = …".

---

## Self-review (đã chạy khi viết plan)

**Spec coverage:** §2 quyết định → Task 1 (config), 2 (pick), 5 (engine/model), 11 (quyền) · §3 luồng → Task 9–12 · §4 đo → Task 3 · §5 phiếu + validator → Task 4–5 · §6 tổng hợp → Task 6 · §7 skill/zip → Task 7–8 · §8 bảng → Task 1 (+ đính chính hàng đợi riêng) · §9 route → Task 11 · §10 UI → Task 13 · §11 lỗi → Task 9 (failed riêng, minVideos, measure null → estimated, recover), Task 10 (billing pause), Task 11 (400 tiếng Việt) · §12 chi phí → đo thật ở Task 14 bước 6 · §13 test → mỗi task · §14 deploy → Task 14.
**Chưa có task riêng:** "retry 1 lần khi Gemini JSON không parse" (§11) — `withRetry` chỉ retry lỗi tạm; nếu bước 6 Task 14 thấy lỗi JSON đáng kể thì thêm 1 lần gọi lại trong `askVideo` (3 dòng) — ghi nhận, không chặn.
**Type consistency:** `StyleDeps`/`RouterDeps`/`StyleEngine` dùng nhất quán Task 5→9→10→11→12; `PickedVideo.isExemplar` (client) ↔ `style_videos.is_exemplar` (DB) qua `createProfile`; `Formula` dùng ở aggregate output sau cluster, skill, zip. `aggregateProfile` trả `formulas` dạng `string[]` — `pipeline.buildAndSave` đổi sang `Formula[]` trước khi thành `StyleProfile` (đã ghi rõ ở Task 6 Interfaces và Task 9 code).
