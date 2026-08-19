# Xưởng — Kế hoạch triển khai Bước 0 + Giai đoạn 1

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-19-xuong-san-xuat-video-affiliate-design.md` **Nhánh:** `feat/xuong-san-xuat`

**Goal:** Từ ảnh sản phẩm + ảnh bối cảnh, người dùng Nonelab Studio dựng kịch bản, sinh ảnh khoá, duyệt, render clip, và nhận về mp4 9:16 có giọng đọc tiếng Việt + phụ đề + nhạc nền + ảnh bìa + caption — kèm chi phí thật từng bước.

**Architecture:** Module `server/studio/` đứng riêng (Express router mount tại `/api/studio`, hàng đợi riêng poll bảng `studio_shots`), tái dùng `db.ts`/`auth.ts`/`ffmpeg` sẵn có. Ba lớp engine cắm-rút (ảnh/video/giọng) có bản `fake` chạy bằng ffmpeg lavfi để test không tốn tiền. Frontend là thư mục `src/studio/` với một màn `StudioView`, App.tsx chỉ thêm 4 chỗ.

**Tech Stack:** Node 22 · TypeScript · Express 4 · sqlite3 · `@google/genai` 1.52 (Nano Banana Pro `generateContent` + Veo `generateVideos`) · `msedge-tts` 2.0.7 · ffmpeg (ffmpeg-static dev / apk prod) · React 18 + Vite · `node:test` + tsx.

## Global Constraints
- **Enum trong DB tiếng Anh**, nhãn tiếng Việt chỉ ở frontend (`src/studio/studioLabels.ts`).
- **Không một byte nhị phân nào vào sqlite.** File nằm dưới `STUDIO_DATA_DIR` (mặc định `<repo>/data/studio`, prod `/app/data/studio` mount từ `/data/videoana-studio`). **Không dùng `server/uploads`.**
- **Không chạy ffmpeg / gọi model trong tiến trình xử lý request** — mọi việc nặng đi qua hàng đợi `server/studio/queue.ts`.
- Cổng chặn tiền: shot phải `approved = 1` mới được render clip. Shot đã có `clip_path` **không bao giờ** bị sinh lại khi phục hồi sau restart.
- Phân loại lỗi: `quota` (backoff, thử lại) · `blocked` (không thử lại) · `network` (tối đa 2 lần) · `billing` (tạm dừng cả hàng đợi 30 phút) · `other` (1 lần).
- Biến môi trường: `STUDIO_CONCURRENCY=3`, `STUDIO_FFMPEG_CONCURRENCY=2`, `STUDIO_DAILY_BUDGET_USD=20`, `STUDIO_MAX_DISK_GB=60`, `STUDIO_SUB_FONT="DejaVu Sans"`, `STUDIO_ENGINE_IMAGE|VIDEO|VOICE` (`fake` để test).
- Bảng giá **chỉ** nằm ở `server/studio/pricing.ts`. Mỗi lần gọi API ghi sổ cái `studio_costs` + cộng dồn `cost_usd` lên shot và project.
- Dùng lại `runQuery/allQuery/getQuery` từ `server/db.ts`, `requireEditor` + `verifyToken` từ `server/auth.ts`, cách đặt ID `"p" + Math.random().toString(36).slice(2, 10)`.
- Copy giao diện tiếng Việt, code comment tiếng Việt (theo nếp repo). Bảng màu: nền `#fffdf8`, chữ `#2a2016`, nhấn `#b06a16`, phụ `#8a7c67`, xanh `#3c7a5e`.
- Test: `npm test` = `cross-env DB_PATH=:memory: STUDIO_DATA_DIR=./data/test-studio STUDIO_ENGINE_IMAGE=fake STUDIO_ENGINE_VIDEO=fake STUDIO_ENGINE_VOICE=fake node --import tsx --test "server/studio/**/*.test.ts"`. Mỗi file test là một tiến trình riêng với DB `:memory:` riêng.

## Điều chỉnh so với spec (phát hiện khi đọc SDK — đã quyết)
1. **Veo: `image` (khung hình đầu) và `referenceImages` loại trừ nhau** (SDK: *"If referenceImages is provided … the image field is not supported"*). Chọn **khung hình đầu** — bảo đảm nhận diện mạnh hơn. Không dùng Ingredients ở chặng 4.
2. **Phụ đề nền hộp vuông** (ASS `BorderStyle=3`), chưa bo góc — libass không vẽ bo góc; để GĐ sau.
3. **`AlignEngine` GĐ 1 = tỉ lệ độ dài chữ** (`proportionalTimings`) khi engine giọng không trả timestamp (FPT.AI). Whisper forced-alignment đi cùng Kho giọng GĐ 1.5.
4. Thêm bảng sổ cái `studio_costs` và các cột `assemble_status`, `retry_after`, `clip_tier`, `disk_bytes` — chi tiết triển khai của mục 7–9 spec.
5. Nhạc nền **không đóng gói** trong repo (bản quyền): người vận hành thả file mp3 vào `<STUDIO_DATA_DIR>/_music/`, API liệt kê.
6. `ffmpeg-static` không có `ffprobe` → đo thời lượng bằng cách parse `Duration:` trong stderr của `ffmpeg -i`.

## Đính chính phát hiện khi thực thi (19/08/2026 — đã sửa trong code)

1. **`server/studio/script.ts` import sai tầng**: plan ghi `from "../errors.js"` → trỏ ra
   `server/errors.js` không tồn tại. Đúng là `"./errors.js"`. (`../db.js` và `../gemini.js`
   trong `db.ts`/`store.ts`/`script.ts` thì ĐÚNG — đó là module cấp app.)
2. **Task 13 sửa `src/App.tsx` 8 chỗ, không phải 4**: nav desktop và nav mobile mỗi bên có
   gating + map icon riêng. Xưởng được gate ở **cả hai** (plan chỉ nêu desktop) vì mỗi lệnh
   tiêu tiền thật. `CampaignView`/`SeedFrameView` định nghĩa ngay trong App.tsx nên chỉ
   `StudioView` cần dòng import.
3. **Số dòng tham chiếu đã cũ**: `extractJSON` ở `server/gemini.ts:141` (plan ghi 125);
   `server/index.ts` 1167 dòng (spec ghi 911); các mốc App.tsx lệch ~60 dòng. Tìm theo nội dung.
4. **`npm test` cần Node 22**: `node --test` chỉ nhận glob `"server/studio/**/*.test.ts"` từ
   v22 trở lên. Prod đã là `node:22-alpine`; máy lập trình phải `nvm use 22` (mặc định là 20).
   sqlite3 dùng N-API nên không cần build lại khi đổi phiên bản Node.
5. Task 1 Step 8 ghi kỳ vọng `# pass 11` — đúng là **10** (6 pricing + 4 errors, như chính chú
   thích của nó). Tổng cuối Giai đoạn 1: **58 test**.
6. Task 11 phần Interfaces thiếu `bootStudioQueue` — hàm này có thật và Task 12 dùng để mount.
7. `DEFAULT_MODEL` trong repo là `gemini-2.5-flash` (spec mục 13 đã cảnh báo lệch). Khâu sinh
   kịch bản phải *nhìn ảnh* nên cần đặt `STUDIO_SCRIPT_MODEL` tường minh trước khi dùng thật.

## Sơ đồ file

```
server/studio/
  config.ts          STUDIO (env, model ID, thư mục), projectDir(), frameSize()
  pricing.ts         PRICES, videoCost/imageCost/voiceCost, estimateProject
  errors.ts          StudioError, classifyError, retryDelayMs, humanKind
  text.ts            countSyllables, maxSyllablesFor
  ffmpeg.ts          FFMPEG, runFfmpeg, probeDuration
  db.ts              initStudioTables
  store.ts           CRUD typed: Project/Shot/Asset/RenderRow, recordCost, runQueryChanges
  subtitles.ts       proportionalTimings, groupCues, shiftCues, toAss, toSrt
  script.ts          validateScript, buildScriptPrompt, generateScriptAI
  assemble.ts        clipStarts, buildAssembleArgs, assembleVideo
  pipeline.ts        makeEngines, requestKeyframes/Clips/Assemble, runShotImage/Clip/Assemble, recoverInterrupted
  queue.ts           startStudioQueue, stopStudioQueue, queueStatus
  routes.ts          studioRouter (/api/studio/*)
  engines/types.ts   ImageEngine/VideoEngine/VoiceEngine + request/result types
  engines/image.ts   nanoImageEngine (Nano Banana Pro)
  engines/video.ts   veoVideoEngine (Veo 3.1)
  engines/voice.ts   edgeVoiceEngine (msedge-tts)
  engines/voiceFpt.ts fptVoiceEngine
  engines/align.ts   alignWords
  engines/fake.ts    fakeImageEngine/fakeVideoEngine/fakeVoiceEngine (ffmpeg lavfi)
scripts/studio-bench.ts   Bước 0
src/studio/
  studioApi.ts · studioLabels.ts · StudioView.tsx · NewProjectForm.tsx
  ScriptSheet.tsx · ReviewGrid.tsx · RenderPanel.tsx
Sửa: package.json · .env.example · server/index.ts (4 dòng) · server/gemini.ts (export extractJSON)
     src/types.ts (Screen) · src/App.tsx (4 chỗ) · Dockerfile · docker-compose.yml · README.md
```

## Giao diện chung (mọi task tham chiếu — tên phải khớp y hệt)

```ts
// server/studio/engines/types.ts
export interface FileRef { path: string; mimeType: string }
export interface WordTiming { text: string; startSec: number; endSec: number }
export type AspectRatio = "9:16" | "16:9" | "1:1";
export interface ImageRequest { prompt: string; refs: FileRef[]; aspectRatio: AspectRatio; size: "1K" | "2K"; outPath: string }
export interface ImageResult { path: string; mimeType: string; costUsd: number; model: string }
export interface ImageEngine { name: string; generate(req: ImageRequest): Promise<ImageResult> }
export interface VideoRequest { prompt: string; firstFrame: FileRef; durationSec: 4 | 6 | 8; aspectRatio: AspectRatio; tier: "draft" | "final"; motionLevel: "low" | "medium" | "high"; outPath: string }
export interface VideoResult { path: string; durationSec: number; costUsd: number; model: string }
export interface VideoEngine { name: string; generate(req: VideoRequest): Promise<VideoResult> }
export interface VoiceRequest { text: string; voice: string; rate: number; outPath: string }   // rate 1.0 = bình thường
export interface VoiceResult { path: string; durationSec: number; words: WordTiming[] | null; costUsd: number }
export interface VoiceEngine { name: string; voices(): { id: string; label: string }[]; synthesize(req: VoiceRequest): Promise<VoiceResult> }
export interface Engines { image: ImageEngine; video: VideoEngine; voice: VoiceEngine }
```

Trạng thái (chuỗi tiếng Anh trong DB):
- `studio_projects.stage`: `script | keyframe | review | clip | assemble | done | failed`
- `studio_projects.assemble_status`: `idle | pending | processing | done | failed`
- `studio_shots.image_status`, `clip_status`: `idle | pending | processing | done | failed`

---

## Bước 0

### Task 1: Khung module — config, bảng giá, phân loại lỗi, test runner

**Files:**
- Modify: `package.json` (scripts `test`, `studio:bench`; dependency `msedge-tts`)
- Modify: `.env.example` (khối STUDIO_*)
- Create: `server/studio/config.ts`
- Create: `server/studio/pricing.ts`, `server/studio/pricing.test.ts`
- Create: `server/studio/errors.ts`, `server/studio/errors.test.ts`

**Interfaces:**

-

Produces: `STUDIO`, `projectDir(id)`, `ensureProjectDirs(id)`, `frameSize(ratio)`, `musicDir()`, `incomingDir()`; `videoCost(model, sec)`, `imageCost(model, size)`, `voiceCost(engine, chars)`, `estimateProject(...)`, `round4`, `usdToVnd`; `StudioError`, `StudioErrorKind`, `classifyError(err)`, `retryDelayMs(kind, attempt)`, `humanKind(kind)`.

-

[ ]  **Step 1: Cài dependency và thêm script**

```bash
npm install msedge-tts@^2.0.7
```

Sửa `package.json` phần `scripts` — thêm hai dòng (giữ nguyên các dòng khác):

```json
"test": "cross-env DB_PATH=:memory: STUDIO_DATA_DIR=./data/test-studio STUDIO_ENGINE_IMAGE=fake STUDIO_ENGINE_VIDEO=fake STUDIO_ENGINE_VOICE=fake node --import tsx --test \"server/studio/**/*.test.ts\"",
"studio:bench": "tsx scripts/studio-bench.ts"
```

Thêm vào cuối `.env.example`:

```bash
# ── Xưởng (sản xuất video affiliate) ─────────────────────────────────────────
# Thư mục lưu ảnh/clip/mp4 (prod: /app/data/studio, mount từ /data/videoana-studio)
STUDIO_DATA_DIR=
# Model (đổi ở đây, không sửa code)
STUDIO_IMAGE_MODEL=gemini-3-pro-image
STUDIO_VIDEO_MODEL_DRAFT=veo-3.1-lite-generate-preview
STUDIO_VIDEO_MODEL_FINAL=veo-3.1-fast-generate-preview
STUDIO_SCRIPT_MODEL=
# Engine: nano|fake · veo|fake · edge|fpt|fake
STUDIO_ENGINE_IMAGE=nano
STUDIO_ENGINE_VIDEO=veo
STUDIO_ENGINE_VOICE=edge
FPT_TTS_API_KEY=
STUDIO_VOICE_DEFAULT=vi-VN-HoaiMyNeural
# Hàng đợi & chốt an toàn
STUDIO_CONCURRENCY=3
STUDIO_FFMPEG_CONCURRENCY=2
STUDIO_DAILY_BUDGET_USD=20
STUDIO_MAX_DISK_GB=60
STUDIO_SUB_FONT=DejaVu Sans
```
- [ ]  **Step 2: Viết `server/studio/config.ts`**

```ts
/**
 * server/studio/config.ts — cấu hình Xưởng, đọc từ biến môi trường một lần.
 * Mọi model ID, thư mục, ngưỡng an toàn nằm ở đây — không hard-code chỗ khác.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL } from "../nonelabPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const str = (v: string | undefined, d: string) => (v || "").trim() || d;

export type AspectRatio = "9:16" | "16:9" | "1:1";

export const STUDIO = {
  dataDir: str(process.env.STUDIO_DATA_DIR, path.join(__dirname, "..", "..", "data", "studio")),
  imageModel: str(process.env.STUDIO_IMAGE_MODEL, "gemini-3-pro-image"),
  videoModelDraft: str(process.env.STUDIO_VIDEO_MODEL_DRAFT, "veo-3.1-lite-generate-preview"),
  videoModelFinal: str(process.env.STUDIO_VIDEO_MODEL_FINAL, "veo-3.1-fast-generate-preview"),
  scriptModel: str(process.env.STUDIO_SCRIPT_MODEL, DEFAULT_MODEL),
  voiceDefault: str(process.env.STUDIO_VOICE_DEFAULT, "vi-VN-HoaiMyNeural"),
  concurrency: Math.max(1, num(process.env.STUDIO_CONCURRENCY, 3)),
  ffmpegConcurrency: Math.max(1, num(process.env.STUDIO_FFMPEG_CONCURRENCY, 2)),
  dailyBudgetUsd: num(process.env.STUDIO_DAILY_BUDGET_USD, 20),
  maxDiskGb: num(process.env.STUDIO_MAX_DISK_GB, 60),
  subFont: str(process.env.STUDIO_SUB_FONT, "DejaVu Sans"),
  engines: {
    image: str(process.env.STUDIO_ENGINE_IMAGE, "nano") as "nano" | "fake",
    video: str(process.env.STUDIO_ENGINE_VIDEO, "veo") as "veo" | "fake",
    voice: str(process.env.STUDIO_ENGINE_VOICE, "edge") as "edge" | "fpt" | "fake",
  },
  transitionSec: 0.5,
  musicVolume: 0.12,
};

/** Kích thước khung hình theo tỉ lệ. */
export function frameSize(ratio: AspectRatio): { width: number; height: number } {
  if (ratio === "16:9") return { width: 1920, height: 1080 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export function projectDir(projectId: string): string {
  return path.join(STUDIO.dataDir, projectId);
}

/** Tạo assets/ keyframes/ clips/ render/ cho một dự án; trả về thư mục gốc. */
export function ensureProjectDirs(projectId: string): string {
  const root = projectDir(projectId);
  for (const sub of ["assets", "keyframes", "clips", "render"]) fs.mkdirSync(path.join(root, sub), { recursive: true });
  return root;
}

export function musicDir(): string {
  const d = path.join(STUDIO.dataDir, "_music");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Thư mục multer nhận file tạm trước khi chuyển vào assets/ của dự án. */
export function incomingDir(): string {
  const d = path.join(STUDIO.dataDir, "_incoming");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
```
- [ ]  **Step 3: Viết test bảng giá `server/studio/pricing.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { videoCost, imageCost, voiceCost, estimateProject, usdToVnd } from "./pricing.js";

test("videoCost nhân đúng giá theo giây", () => {
  assert.equal(videoCost("veo-3.1-fast-generate-preview", 8), 1.2);
  assert.equal(videoCost("fake", 8), 0);
});

test("videoCost ném lỗi khi model chưa có giá (không được lặng lẽ trả 0)", () => {
  assert.throws(() => videoCost("model-la", 8), /Chưa có giá/);
});

test("imageCost phân biệt 2K và 4K", () => {
  assert.equal(imageCost("gemini-3-pro-image", "2K"), 0.134);
  assert.equal(imageCost("gemini-3-pro-image", "4K"), 0.24);
  assert.equal(imageCost("fake", "2K"), 0);
});

test("voiceCost theo 1000 ký tự", () => {
  assert.equal(voiceCost("edge", 5000), 0);
  assert.equal(voiceCost("fpt", 2000), 0.04);
});

test("estimateProject cộng đủ ba khoản", () => {
  const e = estimateProject({ shots: 3, clipLen: 8, videoModel: "veo-3.1-lite-generate-preview", imageModel: "gemini-3-pro-image", voiceEngine: "edge", dialogChars: 300 });
  assert.equal(e.imagesUsd, 0.402);
  assert.equal(e.clipsUsd, 1.2);
  assert.equal(e.voiceUsd, 0);
  assert.equal(e.totalUsd, 1.602);
});

test("usdToVnd làm tròn nghìn", () => {
  assert.equal(usdToVnd(1.602), 42000);
});
```
- [ ]  **Step 4: Chạy test — phải FAIL vì chưa có module**

Run: `npm test` Expected: FAIL `Cannot find module './pricing.js'`
- [ ]  **Step 5: Viết `server/studio/pricing.ts`**

```ts
/**
 * server/studio/pricing.ts — BẢNG GIÁ DUY NHẤT của Xưởng.
 * Số liệu 19/08/2026 (spec mục 9). Model chưa có giá → ném lỗi, không trả 0.
 */
export const PRICES = {
  videoPerSec: {
    "veo-3.1-lite-generate-preview": 0.05,
    "veo-3.1-fast-generate-preview": 0.15,
    "veo-3.1-generate-preview": 0.4,
    "kling-3.0-standard": 0.084,
    "kling-3.0-pro": 0.112,
    fake: 0,
  } as Record<string, number>,
  imagePerImage: {
    "gemini-3-pro-image": 0.134,
    "gemini-3-pro-image@4K": 0.24,
    fake: 0,
  } as Record<string, number>,
  voicePer1kChars: { edge: 0, fpt: 0.02, fake: 0 } as Record<string, number>,
  scriptPerCall: 0.01,
};

export const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function videoCost(model: string, seconds: number): number {
  const p = PRICES.videoPerSec[model];
  if (p === undefined) throw new Error(`Chưa có giá cho model video: ${model}`);
  return round4(p * seconds);
}

export function imageCost(model: string, size: "1K" | "2K" | "4K" = "2K"): number {
  const p = size === "4K" ? PRICES.imagePerImage[`${model}@4K`] ?? PRICES.imagePerImage[model] : PRICES.imagePerImage[model];
  if (p === undefined) throw new Error(`Chưa có giá cho model ảnh: ${model}`);
  return p;
}

export function voiceCost(engine: string, chars: number): number {
  const p = PRICES.voicePer1kChars[engine];
  if (p === undefined) throw new Error(`Chưa có giá cho engine giọng: ${engine}`);
  return round4((p * chars) / 1000);
}

export interface Estimate { imagesUsd: number; clipsUsd: number; voiceUsd: number; totalUsd: number }

export function estimateProject(a: { shots: number; clipLen: number; videoModel: string; imageModel: string; voiceEngine: string; dialogChars: number }): Estimate {
  const imagesUsd = round4(a.shots * imageCost(a.imageModel, "2K"));
  const clipsUsd = round4(a.shots * videoCost(a.videoModel, a.clipLen));
  const voiceUsd = voiceCost(a.voiceEngine, a.dialogChars);
  return { imagesUsd, clipsUsd, voiceUsd, totalUsd: round4(imagesUsd + clipsUsd + voiceUsd) };
}

/** Quy đổi tham khảo, làm tròn nghìn đồng. */
export function usdToVnd(usd: number, rate = 26000): number {
  return Math.round((usd * rate) / 1000) * 1000;
}
```
- [ ]  **Step 6: Viết test phân loại lỗi `server/studio/errors.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, retryDelayMs, StudioError, humanKind } from "./errors.js";

test("phân loại đúng 5 nhóm lỗi", () => {
  assert.equal(classifyError(new Error("429 RESOURCE_EXHAUSTED: quota exceeded")), "quota");
  assert.equal(classifyError(new Error("503 UNAVAILABLE model overloaded")), "quota");
  assert.equal(classifyError(new Error("Response blocked by SAFETY filters")), "blocked");
  assert.equal(classifyError(new Error("fetch failed ECONNRESET")), "network");
  assert.equal(classifyError(new Error("500 Internal error")), "network");
  assert.equal(classifyError(new Error("403 PERMISSION_DENIED: API key not valid")), "billing");
  assert.equal(classifyError(new Error("something odd")), "other");
});

test("StudioError giữ nguyên kind của nó", () => {
  assert.equal(classifyError(new StudioError("blocked", "x")), "blocked");
});

test("blocked/billing KHÔNG được thử lại; quota có backoff; network tối đa 2 lần", () => {
  assert.equal(retryDelayMs("blocked", 0), null);
  assert.equal(retryDelayMs("billing", 0), null);
  assert.ok((retryDelayMs("quota", 0) ?? 0) > 0);
  assert.ok((retryDelayMs("quota", 1) ?? 0) > (retryDelayMs("quota", 0) ?? 0));
  assert.equal(retryDelayMs("quota", 4), null);
  assert.ok((retryDelayMs("network", 1) ?? 0) > 0);
  assert.equal(retryDelayMs("network", 2), null);
  assert.ok((retryDelayMs("other", 0) ?? 0) > 0);
  assert.equal(retryDelayMs("other", 1), null);
});

test("humanKind có chữ tiếng Việt cho mọi kind", () => {
  for (const k of ["quota", "blocked", "network", "billing", "other"] as const) assert.ok(humanKind(k).length > 5);
});
```
- [ ]  **Step 7: Viết `server/studio/errors.ts`**

```ts
/**
 * server/studio/errors.ts — phân loại lỗi để quyết định thử lại hay dừng.
 * Phân loại "blocked" nhầm thành "network" = đốt tiền chắc chắn vô ích (spec mục 7).
 */
export type StudioErrorKind = "quota" | "blocked" | "network" | "billing" | "other";

export class StudioError extends Error {
  kind: StudioErrorKind;
  constructor(kind: StudioErrorKind, message: string) {
    super(message);
    this.name = "StudioError";
    this.kind = kind;
  }
}

export function classifyError(err: unknown): StudioErrorKind {
  if (err instanceof StudioError) return err.kind;
  const m = String((err as any)?.message || err || "");
  if (/billing|payment|insufficient (funds|credit)|API key not valid|PERMISSION_DENIED|\b401\b|\b403\b|suspended/i.test(m)) return "billing";
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate limit|too many requests|\b503\b|UNAVAILABLE|overloaded|high demand/i.test(m)) return "quota";
  if (/SAFETY|blocked|\bRAI\b|filtered|prohibited|content policy|violat|celebrit/i.test(m)) return "blocked";
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|socket hang up|\b50[0-9]\b|\b5[1-9][0-9]\b/i.test(m)) return "network";
  return "other";
}

/** Độ trễ (ms) trước lần thử lại thứ `attempt` (0-based); null = không thử lại. */
export function retryDelayMs(kind: StudioErrorKind, attempt: number): number | null {
  const table: Record<StudioErrorKind, number[]> = {
    quota: [5000, 15000, 40000, 90000],
    network: [2000, 6000],
    other: [3000],
    blocked: [],
    billing: [],
  };
  return table[kind][attempt] ?? null;
}

export function humanKind(kind: StudioErrorKind): string {
  return {
    quota: "Vượt hạn mức/nhịp gọi — hệ thống sẽ tự thử lại.",
    blocked: "Nội dung bị model từ chối — sửa lại prompt rồi sinh lại.",
    network: "Lỗi mạng hoặc máy chủ model — sẽ thử lại tối đa 2 lần.",
    billing: "Hết tiền hoặc key bị khoá — hàng đợi tạm dừng, cần quản trị xử lý.",
    other: "Lỗi không xác định.",
  }[kind];
}
```
- [ ]  **Step 8: Chạy test — phải PASS**

Run: `npm test` Expected: `# pass 11` (6 pricing + 4 errors… đếm theo số `test(`), `# fail 0`
- [ ]  **Step 9: Commit**

```bash
git add package.json package-lock.json .env.example server/studio/config.ts server/studio/pricing.ts server/studio/pricing.test.ts server/studio/errors.ts server/studio/errors.test.ts
git commit -m "feat(xuong): khung module — config, bảng giá, phân loại lỗi, test runner node:test"
```

---

### Task 2: Engine ảnh — Nano Banana Pro

**Files:**
- Create: `server/studio/engines/types.ts` (đúng khối "Giao diện chung" ở đầu tài liệu)
- Create: `server/studio/engines/image.ts`, `server/studio/engines/image.test.ts`

**Interfaces:**

-

Consumes: `STUDIO.imageModel`, `imageCost`, `StudioError`.

-

Produces: `nanoImageEngine(apiKey, model?) : ImageEngine`, `buildImageParts(req)`, `extractImage(resp)`.

-

[ ]  **Step 1: Viết `server/studio/engines/types.ts`** — copy nguyên khối "Giao diện chung" (từ `FileRef` tới `Engines`), thêm dòng đầu `// server/studio/engines/types.ts — hợp đồng cho 3 lớp engine cắm-rút.`

-

[ ]  **Step 2: Viết test `server/studio/engines/image.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildImageParts, extractImage } from "./image.js";
import { StudioError } from "../errors.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "img-"));
const ref = path.join(tmp, "a.png");
fs.writeFileSync(ref, Buffer.from("89504e470d0a1a0a", "hex"));

test("buildImageParts: ảnh tham chiếu đứng trước, prompt đứng cuối", () => {
  const parts = buildImageParts({ prompt: "P", refs: [{ path: ref, mimeType: "image/png" }], aspectRatio: "9:16", size: "2K", outPath: "" });
  assert.equal(parts.length, 2);
  assert.equal(parts[0].inlineData.mimeType, "image/png");
  assert.equal(parts[0].inlineData.data, Buffer.from("89504e470d0a1a0a", "hex").toString("base64"));
  assert.equal(parts[1], "P");
});

test("extractImage lấy inlineData đầu tiên", () => {
  const r = extractImage({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { data: "QUJD", mimeType: "image/jpeg" } }] } }] });
  assert.deepEqual(r, { data: "QUJD", mimeType: "image/jpeg" });
});

test("extractImage: bị chặn → StudioError kind blocked", () => {
  assert.throws(
    () => extractImage({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
    (e: any) => e instanceof StudioError && e.kind === "blocked"
  );
});

test("extractImage: không có ảnh → StudioError kind other", () => {
  assert.throws(() => extractImage({ candidates: [] }), (e: any) => e instanceof StudioError && e.kind === "other");
});
```

-

[ ]  **Step 3: Chạy test — FAIL** (`Cannot find module './image.js'`)

-

[ ]  **Step 4: Viết `server/studio/engines/image.ts`**

```ts
/**
 * server/studio/engines/image.ts — ảnh khoá bằng Nano Banana Pro (Gemini 3 Pro Image).
 * Ảnh sản phẩm + bối cảnh là tham chiếu cứng; prompt tiếng Anh; 9:16 2K.
 */
import fs from "node:fs";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { STUDIO } from "../config.js";
import { imageCost } from "../pricing.js";
import { StudioError } from "../errors.js";
import type { ImageEngine, ImageRequest } from "./types.js";

export function buildImageParts(req: ImageRequest): any[] {
  const parts: any[] = req.refs.map((r) => ({
    inlineData: { data: fs.readFileSync(r.path).toString("base64"), mimeType: r.mimeType },
  }));
  parts.push(req.prompt);
  return parts;
}

export function extractImage(resp: any): { data: string; mimeType: string } {
  const cand = resp?.candidates?.[0];
  const parts: any[] = cand?.content?.parts || [];
  const p = parts.find((x) => x?.inlineData?.data);
  if (p) return { data: p.inlineData.data, mimeType: p.inlineData.mimeType || "image/png" };
  const reason = String(cand?.finishReason || resp?.promptFeedback?.blockReason || "");
  if (/SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(reason)) throw new StudioError("blocked", `Ảnh bị model từ chối (${reason}).`);
  throw new StudioError("other", "Model không trả về ảnh.");
}

export function nanoImageEngine(apiKey: string, model = STUDIO.imageModel): ImageEngine {
  const ai = new GoogleGenAI({ apiKey });
  return {
    name: model,
    async generate(req) {
      const resp = await ai.models.generateContent({
        model,
        contents: createUserContent(buildImageParts(req)),
        config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: req.aspectRatio, imageSize: req.size } },
      });
      const img = extractImage(resp);
      fs.writeFileSync(req.outPath, Buffer.from(img.data, "base64"));
      return { path: req.outPath, mimeType: img.mimeType, costUsd: imageCost(model, req.size), model };
    },
  };
}
```
- [ ]  **Step 5: Chạy test — PASS.** Commit:

```bash
git add server/studio/engines/types.ts server/studio/engines/image.ts server/studio/engines/image.test.ts
git commit -m "feat(xuong): engine ảnh Nano Banana Pro + hợp đồng engine"
```

---

### Task 3: Engine video — Veo 3.1 (khung hình đầu)

**Files:**
- Create: `server/studio/engines/video.ts`, `server/studio/engines/video.test.ts`

**Interfaces:**

-

Produces: `veoVideoEngine(apiKey, models?, deps?) : VideoEngine`, `buildMotionPrompt(req)`, `pickVideo(op)`.

-

[ ]  **Step 1: Viết test `server/studio/engines/video.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMotionPrompt, pickVideo } from "./video.js";
import { StudioError } from "../errors.js";

const base = { prompt: "Hand picks up the jar", firstFrame: { path: "", mimeType: "image/png" }, durationSec: 8 as const, aspectRatio: "9:16" as const, tier: "draft" as const, outPath: "" };

test("motion low thêm câu giữ nhãn không méo; high không thêm", () => {
  assert.match(buildMotionPrompt({ ...base, motionLevel: "low" }), /label .*legible/i);
  assert.doesNotMatch(buildMotionPrompt({ ...base, motionLevel: "high" }), /legible/i);
  assert.match(buildMotionPrompt({ ...base, motionLevel: "high" }), /Hand picks up the jar/);
});

test("pickVideo trả video khi có", () => {
  const v = pickVideo({ done: true, response: { generatedVideos: [{ video: { uri: "u" } }] } });
  assert.deepEqual(v, { uri: "u" });
});

test("pickVideo: RAI lọc hết → blocked", () => {
  assert.throws(
    () => pickVideo({ done: true, response: { generatedVideos: [], raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["x"] } }),
    (e: any) => e instanceof StudioError && e.kind === "blocked"
  );
});

test("pickVideo: operation lỗi → other với message", () => {
  assert.throws(() => pickVideo({ done: true, error: { message: "boom" } }), /boom/);
});
```

-

[ ]  **Step 2: Chạy test — FAIL.**

-

[ ]  **Step 3: Viết `server/studio/engines/video.ts`**

```ts
/**
 * server/studio/engines/video.ts — ảnh khoá → clip bằng Veo 3.1 qua Gemini API.
 * Dùng KHUNG HÌNH ĐẦU (image) — SDK không cho dùng cùng lúc với referenceImages.
 * Poll operation mỗi 10s, tối đa 8 phút. RAI lọc hết → lỗi "blocked" (không thử lại).
 */
import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { STUDIO } from "../config.js";
import { videoCost } from "../pricing.js";
import { StudioError } from "../errors.js";
import type { VideoEngine, VideoRequest } from "./types.js";

const MOTION_HINT: Record<VideoRequest["motionLevel"], string> = {
  low: "Subtle, slow camera motion only; keep the product label perfectly legible and undistorted; no fast hand movement.",
  medium: "Natural handheld motion; keep the product recognizable throughout.",
  high: "",
};

export function buildMotionPrompt(req: Pick<VideoRequest, "prompt" | "motionLevel">): string {
  const hint = MOTION_HINT[req.motionLevel];
  return hint ? `${req.prompt.trim()} ${hint}` : req.prompt.trim();
}

export function pickVideo(op: any): any {
  if (op?.error) throw new StudioError("other", `Veo báo lỗi: ${op.error.message || JSON.stringify(op.error)}`);
  const vids: any[] = op?.response?.generatedVideos || [];
  const v = vids.find((g) => g?.video)?.video;
  if (v) return v;
  const filtered = Number(op?.response?.raiMediaFilteredCount || 0);
  if (filtered > 0) throw new StudioError("blocked", `Veo lọc nội dung: ${(op.response.raiMediaFilteredReasons || []).join("; ")}`);
  throw new StudioError("other", "Veo không trả về video.");
}

const sleepDefault = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function veoVideoEngine(
  apiKey: string,
  models: { draft: string; final: string } = { draft: STUDIO.videoModelDraft, final: STUDIO.videoModelFinal },
  deps: { sleep?: (ms: number) => Promise<unknown>; pollMs?: number; maxWaitMs?: number } = {}
): VideoEngine {
  const ai = new GoogleGenAI({ apiKey });
  const sleep = deps.sleep ?? sleepDefault;
  const pollMs = deps.pollMs ?? 10_000;
  const maxWaitMs = deps.maxWaitMs ?? 8 * 60_000;
  return {
    name: `veo:${models.draft}|${models.final}`,
    async generate(req) {
      const model = req.tier === "final" ? models.final : models.draft;
      let op: any = await ai.models.generateVideos({
        model,
        prompt: buildMotionPrompt(req),
        image: { imageBytes: fs.readFileSync(req.firstFrame.path).toString("base64"), mimeType: req.firstFrame.mimeType },
        config: { aspectRatio: req.aspectRatio, durationSeconds: req.durationSec, numberOfVideos: 1, generateAudio: false, resolution: "720p" },
      });
      const started = Date.now();
      while (!op.done) {
        if (Date.now() - started > maxWaitMs) throw new StudioError("network", "Veo quá 8 phút chưa xong.");
        await sleep(pollMs);
        op = await ai.operations.getVideosOperation({ operation: op });
      }
      const video = pickVideo(op);
      await ai.files.download({ file: video, downloadPath: req.outPath });
      return { path: req.outPath, durationSec: req.durationSec, costUsd: videoCost(model, req.durationSec), model };
    },
  };
}
```
- [ ]  **Step 4: Chạy test — PASS.** Commit:

```bash
git add server/studio/engines/video.ts server/studio/engines/video.test.ts
git commit -m "feat(xuong): engine video Veo 3.1 — khung hình đầu, poll, phân loại RAI"
```

---

### Task 4: Bước 0 — script bench 3 engine trên ảnh thật

**Files:**
- Create: `scripts/studio-bench.ts`
- Create: `docs/superpowers/bench/README.md` (phiếu chấm)

**Interfaces:**

-

Consumes: `nanoImageEngine`, `veoVideoEngine`, `videoCost`, `imageCost`.

-

[ ]  **Step 1: Viết `scripts/studio-bench.ts`**

```ts
/**
 * scripts/studio-bench.ts — Bước 0: bench Veo Lite / Veo Fast (Kling chấm tay trên kling.ai
 * bằng CÙNG ảnh khoá). Không đụng DB. Kết quả vào --out, kèm scores.md để chấm 4 tiêu chí.
 *
 *   npx tsx scripts/studio-bench.ts --product ga.jpg --background ban.jpg \
 *     --prompt "Close-up: a hand picks up one piece of fried chicken from the tray" \
 *     --models veo-3.1-lite-generate-preview,veo-3.1-fast-generate-preview --runs 2 --out ./data/bench
 *   Thêm --keyframe path.png để bỏ qua bước sinh ảnh; --dry để chỉ in kế hoạch.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { nanoImageEngine } from "../server/studio/engines/image.js";
import { veoVideoEngine } from "../server/studio/engines/video.js";
import { videoCost, imageCost, usdToVnd } from "../server/studio/pricing.js";
import { STUDIO } from "../server/studio/config.js";

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) out[k] = true; else { out[k] = v; i++; }
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const out = String(a.out || "./data/bench");
  const runs = Number(a.runs || 2);
  const models = String(a.models || `${STUDIO.videoModelDraft},${STUDIO.videoModelFinal}`).split(",").map((s) => s.trim()).filter(Boolean);
  const prompt = String(a.prompt || "");
  const dry = !!a.dry;
  if (!prompt) throw new Error("Thiếu --prompt");
  fs.mkdirSync(out, { recursive: true });

  const plan = [`Ảnh khoá: ${a.keyframe ? "dùng sẵn " + a.keyframe : "sinh bằng " + STUDIO.imageModel + " (~$" + imageCost(STUDIO.imageModel, "2K") + ")"}`];
  let est = a.keyframe ? 0 : imageCost(STUDIO.imageModel, "2K");
  for (const m of models) { plan.push(`${m} × ${runs} lượt × 8s = $${(videoCost(m, 8) * runs).toFixed(2)}`); est += videoCost(m, 8) * runs; }
  console.log(plan.join("\n") + `\nƯớc tính: $${est.toFixed(2)} ≈ ${usdToVnd(est).toLocaleString("vi-VN")} đ`);
  if (dry) return;

  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("Thiếu GEMINI_API_KEY trong .env");

  let keyframe = a.keyframe ? String(a.keyframe) : "";
  let spent = 0;
  if (!keyframe) {
    const refs = [String(a.product), String(a.background)].filter((p) => p && p !== "undefined").map((p) => ({ path: p, mimeType: p.endsWith(".png") ? "image/png" : "image/jpeg" }));
    keyframe = path.join(out, "keyframe.png");
    const r = await nanoImageEngine(key).generate({ prompt: `${prompt}. Photorealistic 9:16 vertical product shot, the exact product from the reference images placed in the reference background, hands only, no face.`, refs, aspectRatio: "9:16", size: "2K", outPath: keyframe });
    spent += r.costUsd;
    console.log(`Ảnh khoá → ${keyframe} ($${r.costUsd})`);
  }

  const rows: string[] = [];
  for (const m of models) {
    const eng = veoVideoEngine(key, { draft: m, final: m });
    for (let i = 1; i <= runs; i++) {
      const outPath = path.join(out, `${m}_run${i}.mp4`);
      const t0 = Date.now();
      try {
        const r = await eng.generate({ prompt, firstFrame: { path: keyframe, mimeType: "image/png" }, durationSec: 8, aspectRatio: "9:16", tier: "draft", motionLevel: "medium", outPath });
        spent += r.costUsd;
        rows.push(`| ${path.basename(outPath)} | ${m} | ${((Date.now() - t0) / 1000).toFixed(0)}s | $${r.costUsd} |  |  |  |  |`);
        console.log(`✓ ${outPath} (${((Date.now() - t0) / 1000).toFixed(0)}s, $${r.costUsd})`);
      } catch (e: any) {
        rows.push(`| (lỗi) | ${m} | — | — | — | — | — | — | ${e?.message || e} |`);
        console.error(`✗ ${m} lượt ${i}: ${e?.message || e}`);
      }
    }
  }
  for (let i = 1; i <= runs; i++) rows.push(`| kling-3.0-pro_run${i}.mp4 (tải tay từ kling.ai, cùng keyframe) | kling-3.0-pro | — | $${videoCost("kling-3.0-pro", 8)} |  |  |  |  |`);

  const md = [
    `# Bench Bước 0 — ${new Date().toISOString().slice(0, 10)}`, "",
    `Prompt: ${prompt}`, `Ảnh khoá: ${keyframe}`, `Đã tiêu (API): $${spent.toFixed(3)} ≈ ${usdToVnd(spent).toLocaleString("vi-VN")} đ`, "",
    "Chấm 1–5 mỗi cột. Điểm cao = tốt.", "",
    "| File | Model | Thời gian | Giá | Chữ bao bì không méo | Bàn tay không dị dạng | Chuyển động tự nhiên | Bám khung đầu | Ghi chú |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
  fs.writeFileSync(path.join(out, "scores.md"), md);
  console.log(`\nPhiếu chấm: ${path.join(out, "scores.md")}`);
}

if (process.argv[1] && process.argv[1].endsWith("studio-bench.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```
- [ ]  **Step 2: Chạy khô để kiểm tra script**

Run: `npx tsx scripts/studio-bench.ts --prompt "test" --dry` Expected: in kế hoạch 2 model × 2 lượt và dòng `Ước tính: $…` — không gọi API.
- [ ]  **Step 3: Viết `docs/superpowers/bench/README.md`**

```markdown
# Bước 0 — Bench engine video trên ảnh thật

Mục đích: quyết định engine mặc định (nháp/chốt) bằng ảnh sản phẩm THẬT của mình,
không dựa vào bảng xếp hạng trên mạng. Ngân sách ~$5.
1. Chuẩn bị 1 ảnh sản phẩm (gà rán / hũ mẹt đốt) + 1 ảnh bối cảnh, mặt trước, đủ sáng.
2. `npx tsx scripts/studio-bench.ts --product ga.jpg --background ban.jpg --prompt "<mô tả cảnh tay tương tác>" --runs 2 --out ./data/bench`
3. Mở kling.ai → Image to Video → tải `data/bench/keyframe.png`, dán CÙNG prompt, 8s, 9:16, chạy 2 lượt, lưu về `data/bench/kling-3.0-pro_runN.mp4`.
4. Chấm `data/bench/scores.md` (4 tiêu chí × 1–5).
5. Ghi kết luận vào cuối `scores.md`; nếu Kling thắng ở "chuyển động tự nhiên" ≥ 2 điểm và không thua ở "chữ bao bì", ghi phiếu bật adapter Kling (GĐ sau). Đặt `STUDIO_VIDEO_MODEL_DRAFT/FINAL` trong `.env` theo kết quả.
```
- [ ]  **Step 4: Commit**

```bash
git add scripts/studio-bench.ts docs/superpowers/bench/README.md
git commit -m "feat(xuong): script bench Bước 0 (Veo Lite/Fast + phiếu chấm Kling tay)"
```

**Cổng người:** chạy bench thật (mất ~$3–5), chấm phiếu, chốt model mặc định vào `.env` **trước** khi sang Giai đoạn 1. Nếu `veo-3.1-lite-generate-preview` trả 404, đổi `STUDIO_VIDEO_MODEL_DRAFT` sang `veo-3.1-fast-generate-preview` và ghi lại trong `scores.md`.

---

## Giai đoạn 1

### Task 5: Bảng dữ liệu + store

**Files:**
- Create: `server/studio/db.ts`
- Create: `server/studio/store.ts`, `server/studio/store.test.ts`

**Interfaces:**

-

Consumes: `runQuery/allQuery/getQuery/db` từ `server/db.ts`.

-

Produces: `initStudioTables()`; kiểu `Project`, `Shot`, `Asset`, `RenderRow`; `newId(prefix)`, `runQueryChanges(sql, params)`, `createProject`, `getProject`, `listProjects(owner|null)`, `updateProject(id, patch)`, `deleteProject(id)`, `addAsset`, `listAssets`, `replaceShots(projectId, inputs)`, `listShots(projectId)`, `getShot(id)`, `updateShot(id, patch)`, `recordCost({projectId, shotId?, kind, model, usd})`, `todaySpendUsd()`, `totalDiskBytes()`, `addDiskBytes(projectId, bytes)`, `saveRender(r)`, `getRender(projectId)`.

-

[ ]  **Step 1: Viết `server/studio/db.ts`**

```ts
/**
 * server/studio/db.ts — bảng của Xưởng. Không lưu nhị phân; chỉ đường dẫn file.
 * Gọi từ index.ts sau connectDB(). Migration cột thêm dùng addColumnIfMissing kiểu db.ts.
 */
import { runQuery } from "../db.js";

async function addColumnIfMissing(table: string, columnDef: string) {
  try { await runQuery(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`); } catch { /* đã có */ }
}

export async function initStudioTables() {
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_projects (
    id TEXT PRIMARY KEY, owner TEXT, name TEXT, industry TEXT,
    ratio TEXT DEFAULT '9:16', clip_len INTEGER DEFAULT 8, tier TEXT DEFAULT 'draft',
    script_source TEXT, autopsy_id TEXT, batch_id TEXT,
    stage TEXT DEFAULT 'script', assemble_status TEXT DEFAULT 'idle',
    voice TEXT, voice_rate REAL DEFAULT 1.0, music TEXT, transition TEXT DEFAULT 'fade',
    caption TEXT, hashtags TEXT, cover_idx INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0, disk_bytes INTEGER DEFAULT 0, message TEXT,
    created TEXT, updated TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_assets (
    id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, path TEXT, mime TEXT, created TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_shots (
    id TEXT PRIMARY KEY, project_id TEXT, idx INTEGER,
    purpose TEXT, camera TEXT, dialog TEXT, image_prompt TEXT, motion_prompt TEXT, motion_level TEXT DEFAULT 'medium',
    image_path TEXT, image_status TEXT DEFAULT 'idle', approved INTEGER DEFAULT 0,
    clip_path TEXT, clip_status TEXT DEFAULT 'idle', clip_tier TEXT, engine TEXT,
    attempts INTEGER DEFAULT 0, retry_after TEXT, cost_usd REAL DEFAULT 0, error TEXT, updated TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_renders (
    id TEXT PRIMARY KEY, project_id TEXT, mp4_path TEXT, cover_path TEXT, srt_path TEXT,
    caption TEXT, hashtags TEXT, voice TEXT, music TEXT, duration REAL, cost_usd REAL DEFAULT 0, created TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, shot_id TEXT, kind TEXT, model TEXT, usd REAL, created TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_batches (
    id TEXT PRIMARY KEY, owner TEXT, name TEXT, config TEXT, status TEXT, created TEXT)`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_studio_shots_project ON studio_shots(project_id, idx)`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_studio_costs_created ON studio_costs(created)`);
  // Migration về sau thêm ở đây, SAU CREATE TABLE (bài học commit d84e0e6).
  await addColumnIfMissing("studio_projects", "cover_idx INTEGER DEFAULT 0");
}
```
- [ ]  **Step 2: Viết test `server/studio/store.test.ts`**

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { initStudioTables } from "./db.js";
import { createProject, getProject, listProjects, updateProject, replaceShots, listShots, updateShot, recordCost, todaySpendUsd, addDiskBytes, totalDiskBytes, saveRender, getRender, runQueryChanges } from "./store.js";

before(async () => { await initStudioTables(); });

test("tạo/đọc/sửa project và cách ly theo owner", async () => {
  const p = await createProject({ owner: "a@x", name: "Gà rán", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "ai" });
  assert.match(p.id, /^p[a-z0-9]{8}$/);
  assert.equal((await getProject(p.id))?.stage, "script");
  await updateProject(p.id, { stage: "keyframe", caption: "Ngon" });
  assert.equal((await getProject(p.id))?.stage, "keyframe");
  assert.equal((await listProjects("a@x")).length, 1);
  assert.equal((await listProjects("b@x")).length, 0);
  assert.equal((await listProjects(null)).length, 1);
});

test("updateProject bỏ qua cột lạ (không SQL injection qua tên cột)", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  await updateProject(p.id, { "stage; DROP TABLE studio_projects": "x", stage: "review" } as any);
  assert.equal((await getProject(p.id))?.stage, "review");
});

test("replaceShots thay trọn bộ theo idx; updateShot sửa lẻ", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  const shots = await replaceShots(p.id, [
    { purpose: "hook", camera: "close", dialog: "Mở hộp", image_prompt: "a", motion_prompt: "b", motion_level: "low" },
    { purpose: "product", camera: "medium", dialog: "Giòn", image_prompt: "c", motion_prompt: "d", motion_level: "medium" },
  ]);
  assert.equal(shots.length, 2);
  assert.deepEqual(shots.map((s) => s.idx), [0, 1]);
  await updateShot(shots[1].id, { approved: 1, image_status: "done", image_path: "/tmp/x.png" });
  const again = await listShots(p.id);
  assert.equal(again[1].approved, 1);
  const only = await replaceShots(p.id, [{ purpose: "cta", camera: "wide", dialog: "Mua", image_prompt: "e", motion_prompt: "f", motion_level: "high" }]);
  assert.equal((await listShots(p.id)).length, 1);
  assert.equal(only[0].purpose, "cta");
});

test("recordCost ghi sổ cái + cộng dồn shot và project; todaySpendUsd gộp đúng", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  const [s] = await replaceShots(p.id, [{ purpose: "hook", camera: "close", dialog: "", image_prompt: "a", motion_prompt: "b", motion_level: "low" }]);
  const before = await todaySpendUsd();
  await recordCost({ projectId: p.id, shotId: s.id, kind: "image", model: "fake", usd: 0.134 });
  await recordCost({ projectId: p.id, shotId: s.id, kind: "video", model: "fake", usd: 0.4 });
  assert.equal((await getProject(p.id))?.cost_usd, 0.534);
  assert.equal((await listShots(p.id))[0].cost_usd, 0.534);
  assert.equal(Math.round(((await todaySpendUsd()) - before) * 1000), 534);
});

test("addDiskBytes / totalDiskBytes", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  const t0 = await totalDiskBytes();
  await addDiskBytes(p.id, 1000);
  await addDiskBytes(p.id, 500);
  assert.equal((await getProject(p.id))?.disk_bytes, 1500);
  assert.equal((await totalDiskBytes()) - t0, 1500);
});

test("saveRender/getRender", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  await saveRender({ project_id: p.id, mp4_path: "/r/a.mp4", cover_path: "/r/c.jpg", srt_path: "/r/s.srt", caption: "cap", hashtags: "#a #b", voice: "v", music: null, duration: 23.5, cost_usd: 0 });
  assert.equal((await getRender(p.id))?.duration, 23.5);
});

test("runQueryChanges trả số dòng ảnh hưởng (dùng để claim job)", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  const [s] = await replaceShots(p.id, [{ purpose: "hook", camera: "close", dialog: "", image_prompt: "a", motion_prompt: "b", motion_level: "low" }]);
  await updateShot(s.id, { image_status: "pending" });
  assert.equal(await runQueryChanges("UPDATE studio_shots SET image_status='processing' WHERE id=? AND image_status='pending'", [s.id]), 1);
  assert.equal(await runQueryChanges("UPDATE studio_shots SET image_status='processing' WHERE id=? AND image_status='pending'", [s.id]), 0);
});
```

-

[ ]  **Step 3: Chạy test — FAIL** (`Cannot find module './store.js'`)

-

[ ]  **Step 4: Viết `server/studio/store.ts`**

```ts
/**
 * server/studio/store.ts — CRUD có kiểu cho bảng studio_*. Trường giữ snake_case như cột.
 * updateX chỉ nhận cột trong whitelist — không bao giờ nội suy tên cột từ đầu vào.
 */
import { db, runQuery, allQuery, getQuery } from "../db.js";

export interface Project {
  id: string; owner: string; name: string; industry: string; ratio: "9:16" | "16:9" | "1:1"; clip_len: number;
  tier: "draft" | "final"; script_source: string; autopsy_id: string | null; batch_id: string | null;
  stage: "script" | "keyframe" | "review" | "clip" | "assemble" | "done" | "failed";
  assemble_status: "idle" | "pending" | "processing" | "done" | "failed";
  voice: string | null; voice_rate: number; music: string | null; transition: string;
  caption: string | null; hashtags: string | null; cover_idx: number;
  cost_usd: number; disk_bytes: number; message: string | null; created: string; updated: string;
}
export interface Asset { id: string; project_id: string; kind: "product" | "background" | "style"; path: string; mime: string; created: string }
export interface Shot {
  id: string; project_id: string; idx: number;
  purpose: string; camera: string; dialog: string; image_prompt: string; motion_prompt: string; motion_level: "low" | "medium" | "high";
  image_path: string | null; image_status: "idle" | "pending" | "processing" | "done" | "failed"; approved: number;
  clip_path: string | null; clip_status: "idle" | "pending" | "processing" | "done" | "failed"; clip_tier: string | null; engine: string | null;
  attempts: number; retry_after: string | null; cost_usd: number; error: string | null; updated: string;
}
export interface ShotInput { purpose: string; camera: string; dialog: string; image_prompt: string; motion_prompt: string; motion_level: "low" | "medium" | "high" }
export interface RenderRow {
  id?: string; project_id: string; mp4_path: string; cover_path: string | null; srt_path: string | null;
  caption: string | null; hashtags: string | null; voice: string | null; music: string | null; duration: number; cost_usd: number; created?: string;
}

export const newId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

export function runQueryChanges(sql: string, params: any[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (this: any, err: any) { if (err) reject(err); else resolve(this.changes || 0); });
  });
}

const PROJECT_COLS = ["name", "industry", "ratio", "clip_len", "tier", "script_source", "autopsy_id", "batch_id", "stage", "assemble_status", "voice", "voice_rate", "music", "transition", "caption", "hashtags", "cover_idx", "message"];
const SHOT_COLS = ["idx", "purpose", "camera", "dialog", "image_prompt", "motion_prompt", "motion_level", "image_path", "image_status", "approved", "clip_path", "clip_status", "clip_tier", "engine", "attempts", "retry_after", "error"];

async function patchRow(table: string, cols: string[], id: string, patch: Record<string, any>) {
  const keys = Object.keys(patch).filter((k) => cols.includes(k));
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  await runQuery(`UPDATE ${table} SET ${set}, updated = ? WHERE id = ?`, [...keys.map((k) => patch[k]), now(), id]);
}

export async function createProject(a: { owner: string; name: string; industry: string; ratio: Project["ratio"]; clipLen: number; tier: Project["tier"]; scriptSource: string }): Promise<Project> {
  const id = newId("p");
  const t = now();
  await runQuery(
    "INSERT INTO studio_projects (id, owner, name, industry, ratio, clip_len, tier, script_source, stage, assemble_status, created, updated) VALUES (?,?,?,?,?,?,?,?, 'script','idle', ?, ?)",
    [id, a.owner.toLowerCase().trim(), a.name, a.industry, a.ratio, a.clipLen, a.tier, a.scriptSource, t, t]
  );
  return (await getProject(id))!;
}
export const getProject = (id: string) => getQuery<Project>("SELECT * FROM studio_projects WHERE id = ?", [id]);
export function listProjects(owner: string | null): Promise<Project[]> {
  return owner === null
    ? allQuery<Project>("SELECT * FROM studio_projects ORDER BY created DESC")
    : allQuery<Project>("SELECT * FROM studio_projects WHERE owner = ? ORDER BY created DESC", [owner.toLowerCase().trim()]);
}
export const updateProject = (id: string, patch: Partial<Project>) => patchRow("studio_projects", PROJECT_COLS, id, patch);
export async function deleteProject(id: string) {
  for (const t of ["studio_shots", "studio_assets", "studio_renders", "studio_costs"]) await runQuery(`DELETE FROM ${t} WHERE project_id = ?`, [id]);
  await runQuery("DELETE FROM studio_projects WHERE id = ?", [id]);
}

export async function addAsset(projectId: string, kind: Asset["kind"], path: string, mime: string): Promise<Asset> {
  const id = newId("a");
  await runQuery("INSERT INTO studio_assets (id, project_id, kind, path, mime, created) VALUES (?,?,?,?,?,?)", [id, projectId, kind, path, mime, now()]);
  return (await getQuery<Asset>("SELECT * FROM studio_assets WHERE id = ?", [id]))!;
}
export const listAssets = (projectId: string) => allQuery<Asset>("SELECT * FROM studio_assets WHERE project_id = ? ORDER BY created ASC", [projectId]);

export async function replaceShots(projectId: string, inputs: ShotInput[]): Promise<Shot[]> {
  await runQuery("DELETE FROM studio_shots WHERE project_id = ?", [projectId]);
  const t = now();
  for (let i = 0; i < inputs.length; i++) {
    const s = inputs[i];
    await runQuery(
      "INSERT INTO studio_shots (id, project_id, idx, purpose, camera, dialog, image_prompt, motion_prompt, motion_level, updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [newId("s"), projectId, i, s.purpose, s.camera, s.dialog || "", s.image_prompt || "", s.motion_prompt || "", s.motion_level || "medium", t]
    );
  }
  return listShots(projectId);
}
export const listShots = (projectId: string) => allQuery<Shot>("SELECT * FROM studio_shots WHERE project_id = ? ORDER BY idx ASC", [projectId]);
export const getShot = (id: string) => getQuery<Shot>("SELECT * FROM studio_shots WHERE id = ?", [id]);
export const updateShot = (id: string, patch: Partial<Shot>) => patchRow("studio_shots", SHOT_COLS, id, patch);

export async function recordCost(a: { projectId: string; shotId?: string; kind: "image" | "video" | "voice" | "script"; model: string; usd: number }) {
  await runQuery("INSERT INTO studio_costs (project_id, shot_id, kind, model, usd, created) VALUES (?,?,?,?,?,?)", [a.projectId, a.shotId || null, a.kind, a.model, a.usd, now()]);
  await runQuery("UPDATE studio_projects SET cost_usd = ROUND(cost_usd + ?, 4) WHERE id = ?", [a.usd, a.projectId]);
  if (a.shotId) await runQuery("UPDATE studio_shots SET cost_usd = ROUND(cost_usd + ?, 4) WHERE id = ?", [a.usd, a.shotId]);
}
export async function todaySpendUsd(): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const r = await getQuery<{ s: number }>("SELECT COALESCE(SUM(usd),0) AS s FROM studio_costs WHERE created >= ?", [day]);
  return Number(r?.s || 0);
}
export async function totalDiskBytes(): Promise<number> {
  const r = await getQuery<{ s: number }>("SELECT COALESCE(SUM(disk_bytes),0) AS s FROM studio_projects");
  return Number(r?.s || 0);
}
export const addDiskBytes = (projectId: string, bytes: number) => runQuery("UPDATE studio_projects SET disk_bytes = disk_bytes + ? WHERE id = ?", [bytes, projectId]);

export async function saveRender(r: RenderRow): Promise<RenderRow> {
  await runQuery("DELETE FROM studio_renders WHERE project_id = ?", [r.project_id]);
  const id = newId("r");
  await runQuery(
    "INSERT INTO studio_renders (id, project_id, mp4_path, cover_path, srt_path, caption, hashtags, voice, music, duration, cost_usd, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, r.project_id, r.mp4_path, r.cover_path, r.srt_path, r.caption, r.hashtags, r.voice, r.music, r.duration, r.cost_usd, now()]
  );
  return (await getRender(r.project_id))!;
}
export const getRender = (projectId: string) => getQuery<RenderRow>("SELECT * FROM studio_renders WHERE project_id = ?", [projectId]);
```
- [ ]  **Step 5: Chạy test — PASS.** Commit:

```bash
git add server/studio/db.ts server/studio/store.ts server/studio/store.test.ts
git commit -m "feat(xuong): bảng studio_* + store có kiểu, sổ cái chi phí, cách ly owner"
```

---

### Task 6: ffmpeg helper, đếm âm tiết, engine giả

**Files:**
- Create: `server/studio/ffmpeg.ts`, `server/studio/ffmpeg.test.ts`
- Create: `server/studio/text.ts`, `server/studio/text.test.ts`
- Create: `server/studio/engines/fake.ts`, `server/studio/engines/fake.test.ts`

**Interfaces:**

-

Produces: `FFMPEG`, `runFfmpeg(args, opts?)`, `probeDuration(path)`; `countSyllables(text)`, `maxSyllablesFor(sps, clipLen)`; `fakeImageEngine()`, `fakeVideoEngine()`, `fakeVoiceEngine()`, `FAKE_SYLLABLES_PER_SEC = 4.5`.

-

[ ]  **Step 1: Test `server/studio/text.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { countSyllables, maxSyllablesFor } from "./text.js";

test("tiếng Việt đơn âm tiết: đếm âm tiết = đếm chữ, bỏ dấu câu rời", () => {
  assert.equal(countSyllables("Mở hộp ra là thơm nức mũi!"), 7);
  assert.equal(countSyllables("  Giòn   -   rụm...  "), 2);
  assert.equal(countSyllables(""), 0);
  assert.equal(countSyllables("100% thật"), 2);
});

test("maxSyllablesFor làm tròn xuống", () => {
  assert.equal(maxSyllablesFor(4.8, 8), 38);
  assert.equal(maxSyllablesFor(4.5, 4), 18);
});
```
- [ ]  **Step 2: Viết `server/studio/text.ts`**

```ts
/** server/studio/text.ts — tiện ích tiếng Việt: đơn âm tiết nên đếm âm tiết = đếm token có chữ/số. */
export function countSyllables(text: string): number {
  return String(text || "").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}
/** Số âm tiết tối đa cho một cảnh: nhịp (âm tiết/giây) × độ dài clip, làm tròn xuống. */
export function maxSyllablesFor(syllablesPerSec: number, clipLen: number): number {
  return Math.floor(syllablesPerSec * clipLen);
}
```
- [ ]  **Step 3: Test `server/studio/ffmpeg.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFfmpeg, probeDuration, parseDurationLine } from "./ffmpeg.js";

test("parseDurationLine đọc Duration của ffmpeg", () => {
  assert.equal(parseDurationLine("  Duration: 00:00:08.04, start: 0.000000, bitrate: 20 kb/s"), 8.04);
  assert.equal(parseDurationLine("no duration here"), null);
});

test("runFfmpeg sinh mp4 3s và probeDuration đo được", async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ff-")), "a.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=64x64:d=3:r=24", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", out]);
  assert.ok(fs.statSync(out).size > 0);
  const d = await probeDuration(out);
  assert.ok(Math.abs(d - 3) < 0.2, `duration=${d}`);
});

test("runFfmpeg ném lỗi kèm đuôi stderr khi lệnh sai", async () => {
  await assert.rejects(runFfmpeg(["-i", "/khong/ton/tai.mp4", "-f", "null", "-"]), /ffmpeg/);
});
```
- [ ]  **Step 4: Viết `server/studio/ffmpeg.ts`**

```ts
/**
 * server/studio/ffmpeg.ts — chạy ffmpeg (FFMPEG_PATH → ffmpeg-static → PATH), có timeout,
 * chạy `nice` khi có để không giành lõi với API. ffmpeg-static KHÔNG có ffprobe → đo thời lượng
 * bằng cách parse dòng "Duration:" trong stderr.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import ffmpegStatic from "ffmpeg-static";

export const FFMPEG = (process.env.FFMPEG_PATH || "").trim() || (ffmpegStatic as unknown as string) || "ffmpeg";
const HAS_NICE = process.platform !== "win32" && fs.existsSync("/usr/bin/nice");

export function runFfmpeg(args: string[], opts: { timeoutMs?: number; nice?: boolean } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const useNice = (opts.nice ?? true) && HAS_NICE;
  const cmd = useNice ? "/usr/bin/nice" : FFMPEG;
  const full = useNice ? ["-n", "10", FFMPEG, ...args] : args;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, full, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => { err += String(c); if (err.length > 20000) err = err.slice(-20000); });
    const guard = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} reject(new Error(`ffmpeg quá ${timeoutMs}ms`)); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(guard); reject(new Error(`ffmpeg không chạy được: ${e.message}`)); });
    p.on("close", (code) => {
      clearTimeout(guard);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg thoát mã ${code}: ${err.split("\n").slice(-6).join(" | ")}`));
    });
  });
}

export function parseDurationLine(text: string): number | null {
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Thời lượng (giây). ffmpeg -i không có output sẽ thoát mã 1 nhưng vẫn in Duration → bắt từ lỗi. */
export async function probeDuration(filePath: string): Promise<number> {
  let text = "";
  try { text = await runFfmpeg(["-i", filePath], { nice: false, timeoutMs: 30_000 }); }
  catch (e: any) { text = String(e?.message || ""); }
  const d = parseDurationLine(text);
  if (d === null) {
    // Lỗi gộp chỉ giữ 6 dòng cuối — chạy lại lấy nguyên stderr.
    const raw = await new Promise<string>((res) => {
      const p = spawn(FFMPEG, ["-i", filePath], { stdio: ["ignore", "ignore", "pipe"] });
      let s = ""; p.stderr.on("data", (c) => (s += String(c))); p.on("close", () => res(s)); p.on("error", () => res(s));
    });
    const d2 = parseDurationLine(raw);
    if (d2 === null) throw new Error(`Không đo được thời lượng: ${filePath}`);
    return d2;
  }
  return d;
}
```
- [ ]  **Step 5: Test `server/studio/engines/fake.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeImageEngine, fakeVideoEngine, fakeVoiceEngine } from "./fake.js";
import { probeDuration } from "../ffmpeg.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-"));

test("fake image sinh PNG 9:16, cost 0", async () => {
  const r = await fakeImageEngine().generate({ prompt: "x", refs: [], aspectRatio: "9:16", size: "2K", outPath: path.join(dir, "k.png") });
  assert.ok(fs.statSync(r.path).size > 100);
  assert.equal(r.costUsd, 0);
});

test("fake video sinh mp4 đúng thời lượng", async () => {
  const r = await fakeVideoEngine().generate({ prompt: "x", firstFrame: { path: path.join(dir, "k.png"), mimeType: "image/png" }, durationSec: 4, aspectRatio: "9:16", tier: "draft", motionLevel: "low", outPath: path.join(dir, "c.mp4") });
  assert.ok(Math.abs((await probeDuration(r.path)) - 4) < 0.3);
  assert.equal(r.model, "fake");
});

test("fake voice: thời lượng theo số âm tiết / 4.5, words = null", async () => {
  const r = await fakeVoiceEngine().synthesize({ text: "một hai ba bốn năm sáu bảy tám chín", voice: "fake", rate: 1, outPath: path.join(dir, "v.mp3") });
  assert.ok(Math.abs(r.durationSec - 2) < 0.4, `dur=${r.durationSec}`);
  assert.equal(r.words, null);
  assert.equal(fakeVoiceEngine().voices()[0].id, "fake");
});
```
- [ ]  **Step 6: Viết `server/studio/engines/fake.ts`**

```ts
/**
 * server/studio/engines/fake.ts — engine giả chạy bằng ffmpeg lavfi: đúng hợp đồng, 0 đồng.
 * Cho test tự động và sửa code lúc nửa đêm không sợ mất tiền (spec mục 11).
 */
import { frameSize } from "../config.js";
import { runFfmpeg, probeDuration } from "../ffmpeg.js";
import { countSyllables } from "../text.js";
import type { ImageEngine, VideoEngine, VoiceEngine } from "./types.js";

export const FAKE_SYLLABLES_PER_SEC = 4.5;

export function fakeImageEngine(): ImageEngine {
  return {
    name: "fake",
    async generate(req) {
      const { width, height } = frameSize(req.aspectRatio);
      await runFfmpeg(["-f", "lavfi", "-i", `color=c=#b06a16:s=${width}x${height}`, "-frames:v", "1", "-y", req.outPath], { nice: false });
      return { path: req.outPath, mimeType: "image/png", costUsd: 0, model: "fake" };
    },
  };
}

export function fakeVideoEngine(): VideoEngine {
  return {
    name: "fake",
    async generate(req) {
      const { width, height } = frameSize(req.aspectRatio);
      await runFfmpeg(["-f", "lavfi", "-i", `color=c=#3c7a5e:s=${width}x${height}:d=${req.durationSec}:r=24`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", req.outPath], { nice: false });
      return { path: req.outPath, durationSec: req.durationSec, costUsd: 0, model: "fake" };
    },
  };
}

export function fakeVoiceEngine(): VoiceEngine {
  return {
    name: "fake",
    voices: () => [{ id: "fake", label: "Giọng giả (im lặng)" }],
    async synthesize(req) {
      const dur = Math.max(0.5, countSyllables(req.text) / (FAKE_SYLLABLES_PER_SEC * (req.rate || 1)));
      await runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", dur.toFixed(2), "-c:a", "libmp3lame", "-b:a", "48k", "-y", req.outPath], { nice: false });
      return { path: req.outPath, durationSec: await probeDuration(req.outPath), words: null, costUsd: 0 };
    },
  };
}
```
- [ ]  **Step 7: Chạy test — PASS** (ffmpeg thật chạy, mỗi test < 3s). Commit:

```bash
git add server/studio/ffmpeg.ts server/studio/ffmpeg.test.ts server/studio/text.ts server/studio/text.test.ts server/studio/engines/fake.ts server/studio/engines/fake.test.ts
git commit -m "feat(xuong): ffmpeg helper (probe qua stderr), đếm âm tiết, engine giả bằng lavfi"
```

---

### Task 7: Phụ đề (cue, ASS, SRT) + engine giọng edge-tts / FPT.AI + align

**Files:**
- Create: `server/studio/subtitles.ts`, `server/studio/subtitles.test.ts`
- Create: `server/studio/engines/align.ts`
- Create: `server/studio/engines/voice.ts`, `server/studio/engines/voice.test.ts`
- Create: `server/studio/engines/voiceFpt.ts`, `server/studio/engines/voiceFpt.test.ts`

**Interfaces:**

-

Produces: `SubCue {text,startSec,endSec}`, `proportionalTimings(text, durationSec)`, `groupCues(words, maxChars=26)`, `shiftCues(cues, offset)`, `assTime(sec)`, `toAss(cues, {font,width,height,fontSize?})`, `toSrt(cues)`; `alignWords(words|null, text, durationSec)`; `edgeVoiceEngine()`, `parseEdgeMetadata(meta)`, `escapeXml(s)`, `EDGE_VOICES`; `fptVoiceEngine(apiKey, fetchImpl?)`, `rateToSpeed(rate)`, `FPT_VOICES`.

-

[ ]  **Step 1: Test `server/studio/subtitles.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { proportionalTimings, groupCues, shiftCues, assTime, toAss, toSrt } from "./subtitles.js";

test("proportionalTimings chia thời lượng theo độ dài chữ, phủ kín 0→dur", () => {
  const w = proportionalTimings("Mở hộp ra thơm", 4);
  assert.equal(w.length, 4);
  assert.equal(w[0].startSec, 0);
  assert.equal(w[3].endSec, 4);
  assert.ok(w[1].startSec >= w[0].endSec - 1e-9);
});

test("groupCues gom theo maxChars và cắt ở dấu câu", () => {
  const w = proportionalTimings("Mở hộp ra. Thơm nức mũi luôn nha mọi người ơi", 6);
  const cues = groupCues(w, 20);
  assert.equal(cues[0].text, "Mở hộp ra.");
  assert.ok(cues.every((c) => c.text.length <= 20 || c.text.split(" ").length === 1));
  assert.equal(cues[cues.length - 1].endSec, 6);
});

test("shiftCues dời mốc", () => {
  const c = shiftCues([{ text: "a", startSec: 1, endSec: 2 }], 7.5);
  assert.deepEqual(c, [{ text: "a", startSec: 8.5, endSec: 9.5 }]);
});

test("assTime định dạng H:MM:SS.cc", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(83.456), "0:01:23.46");
});

test("toAss có PlayRes, BorderStyle=3, font, Dialogue; toSrt đúng thứ tự", () => {
  const cues = [{ text: "Xin {chào}", startSec: 0, endSec: 1.5 }];
  const ass = toAss(cues, { font: "DejaVu Sans", width: 1080, height: 1920 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Style: Default,DejaVu Sans,/);
  assert.match(ass, /,3,\d+,0,2,/); // BorderStyle=3 … Alignment=2
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.50,Default,,0,0,0,,Xin \\\{chào\\\}/);
  assert.match(toSrt(cues), /1\n00:00:00,000 --> 00:00:01,500\nXin \{chào\}/);
});
```
- [ ]  **Step 2: Viết `server/studio/subtitles.ts`**

```ts
/**
 * server/studio/subtitles.ts — từ mốc thời gian từng từ → cue phụ đề → ASS (burn) và SRT.
 * Hộp nền vuông BorderStyle=3 (libass không bo góc), canh dưới, MarginV cao để tránh UI TikTok.
 */
import type { WordTiming } from "./engines/types.js";

export interface SubCue { text: string; startSec: number; endSec: number }

/** Không có timestamp thật → chia đều theo độ dài chữ (+1 cho khoảng cách). */
export function proportionalTimings(text: string, durationSec: number): WordTiming[] {
  const tokens = String(text || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map((t) => t.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: WordTiming[] = [];
  let t = 0;
  for (let i = 0; i < tokens.length; i++) {
    const d = (weights[i] / total) * durationSec;
    const end = i === tokens.length - 1 ? durationSec : t + d;
    out.push({ text: tokens[i], startSec: t, endSec: end });
    t = end;
  }
  return out;
}

export function groupCues(words: WordTiming[], maxChars = 26): SubCue[] {
  const cues: SubCue[] = [];
  let buf: WordTiming[] = [];
  const flush = () => {
    if (!buf.length) return;
    cues.push({ text: buf.map((w) => w.text).join(" "), startSec: buf[0].startSec, endSec: buf[buf.length - 1].endSec });
    buf = [];
  };
  for (const w of words) {
    const candidate = [...buf, w].map((x) => x.text).join(" ");
    if (buf.length && candidate.length > maxChars) flush();
    buf.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return cues;
}

export const shiftCues = (cues: SubCue[], offsetSec: number): SubCue[] =>
  cues.map((c) => ({ ...c, startSec: c.startSec + offsetSec, endSec: c.endSec + offsetSec }));

export function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const cs = Math.round((r - Math.floor(r)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(r)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const escAss = (t: string) => t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");

export function toAss(cues: SubCue[], o: { font: string; width: number; height: number; fontSize?: number }): string {
  const fs = o.fontSize ?? Math.round(o.height * 0.034); // ~64px trên 1920
  const marginV = Math.round(o.height * 0.14);
  const head = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${o.width}`, `PlayResY: ${o.height}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${o.font},${fs},&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,3,14,0,2,60,60,${marginV},163`, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines = cues.map((c) => `Dialogue: 0,${assTime(c.startSec)},${assTime(c.endSec)},Default,,0,0,0,,${escAss(c.text)}`);
  return [...head, ...lines, ""].join("\n");
}

const srtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};
export function toSrt(cues: SubCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.startSec)} --> ${srtTime(c.endSec)}\n${c.text}\n`).join("\n");
}
```
- [ ]  **Step 3: Viết `server/studio/engines/align.ts`**

```ts
/** server/studio/engines/align.ts — GĐ 1: engine không trả timestamp → chia tỉ lệ. GĐ 1.5: whisper forced-alignment. */
import { proportionalTimings } from "../subtitles.js";
import type { WordTiming } from "./types.js";

export function alignWords(words: WordTiming[] | null, text: string, durationSec: number): WordTiming[] {
  if (words && words.length) return words;
  return proportionalTimings(text, durationSec);
}
```
- [ ]  **Step 4: Test `server/studio/engines/voice.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEdgeMetadata, escapeXml, EDGE_VOICES } from "./voice.js";

test("parseEdgeMetadata đổi 100ns → giây, chỉ lấy WordBoundary", () => {
  const meta = { Metadata: [
    { Type: "SentenceBoundary", Data: { Offset: 0, Duration: 20000000, text: { Text: "Xin chào" } } },
    { Type: "WordBoundary", Data: { Offset: 1000000, Duration: 5000000, text: { Text: "Xin" } } },
    { Type: "WordBoundary", Data: { Offset: 7000000, Duration: 6000000, text: { Text: "chào" } } },
  ] };
  const w = parseEdgeMetadata(meta);
  assert.deepEqual(w, [{ text: "Xin", startSec: 0.1, endSec: 0.6 }, { text: "chào", startSec: 0.7, endSec: 1.3 }]);
});

test("escapeXml", () => { assert.equal(escapeXml(`a<b>&"c"`), "a&lt;b&gt;&amp;&quot;c&quot;"); });
test("EDGE_VOICES có Hoài My và Nam Minh", () => {
  assert.ok(EDGE_VOICES.some((v) => v.id === "vi-VN-HoaiMyNeural"));
  assert.ok(EDGE_VOICES.some((v) => v.id === "vi-VN-NamMinhNeural"));
});
```
- [ ]  **Step 5: Viết `server/studio/engines/voice.ts`**

```ts
/**
 * server/studio/engines/voice.ts — giọng nháp miễn phí qua Edge Read-Aloud (msedge-tts),
 * có mốc thời gian từng từ. API không chính thức → CHỈ nháp nội bộ (spec mục 2).
 */
import fs from "node:fs";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { probeDuration } from "../ffmpeg.js";
import type { VoiceEngine, WordTiming } from "./types.js";

export const EDGE_VOICES = [
  { id: "vi-VN-HoaiMyNeural", label: "Hoài My (nữ, miền Bắc)" },
  { id: "vi-VN-NamMinhNeural", label: "Nam Minh (nam, miền Bắc)" },
];

export const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function parseEdgeMetadata(meta: any): WordTiming[] {
  const items: any[] = meta?.Metadata || [];
  return items
    .filter((m) => m?.Type === "WordBoundary")
    .map((m) => {
      const start = Number(m.Data.Offset) / 1e7;
      const dur = Number(m.Data.Duration) / 1e7;
      return { text: String(m.Data.text?.Text || ""), startSec: round3(start), endSec: round3(start + dur) };
    });
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function edgeVoiceEngine(): VoiceEngine {
  return {
    name: "edge",
    voices: () => EDGE_VOICES,
    async synthesize(req) {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(req.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
      const tmp = fs.mkdtempSync(path.join(path.dirname(req.outPath), "tts-"));
      try {
        const { audioFilePath, metadataFilePath } = await tts.toFile(tmp, escapeXml(req.text), { rate: req.rate || 1 });
        fs.renameSync(audioFilePath, req.outPath);
        const words = metadataFilePath && fs.existsSync(metadataFilePath) ? parseEdgeMetadata(JSON.parse(fs.readFileSync(metadataFilePath, "utf8"))) : null;
        return { path: req.outPath, durationSec: await probeDuration(req.outPath), words: words && words.length ? words : null, costUsd: 0 };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        try { (tts as any).close?.(); } catch { /* bỏ qua */ }
      }
    },
  };
}
```
- [ ]  **Step 6: Test `server/studio/engines/voiceFpt.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rateToSpeed, fptVoiceEngine, FPT_VOICES } from "./voiceFpt.js";

test("rateToSpeed: 1.0→0, 1.2→1, 0.8→-1, kẹp -3..3", () => {
  assert.equal(rateToSpeed(1), 0); assert.equal(rateToSpeed(1.2), 1); assert.equal(rateToSpeed(0.8), -1);
  assert.equal(rateToSpeed(3), 3); assert.equal(rateToSpeed(0.1), -3);
});

test("fpt: gửi header api-key/voice/speed, poll URL async rồi ghi file; words=null; cost theo ký tự", async () => {
  const calls: any[] = [];
  const fakeFetch: any = async (url: string, init?: any) => {
    calls.push({ url, init });
    if (url.includes("hmi/tts")) return { ok: true, status: 200, json: async () => ({ error: 0, async: "https://cdn/x.mp3" }) };
    if (calls.filter((c) => c.url === "https://cdn/x.mp3").length < 2) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([0xff, 0xfb, 0x90, 0x00]).buffer };
  };
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fpt-")), "v.mp3");
  const eng = fptVoiceEngine("KEY", fakeFetch, { pollMs: 1, probe: async () => 1.5 });
  const r = await eng.synthesize({ text: "Xin chào", voice: "banmai", rate: 1.2, outPath: out });
  assert.equal(calls[0].init.headers["api-key"], "KEY");
  assert.equal(calls[0].init.headers.voice, "banmai");
  assert.equal(calls[0].init.headers.speed, "1");
  assert.equal(fs.statSync(out).size, 4);
  assert.equal(r.words, null);
  assert.equal(r.durationSec, 1.5);
  assert.equal(r.costUsd, 0.0002);
  assert.ok(FPT_VOICES.length >= 5);
});
```
- [ ]  **Step 7: Viết `server/studio/engines/voiceFpt.ts`**

```ts
/**
 * server/studio/engines/voiceFpt.ts — FPT.AI TTS v5 (giọng Việt bản địa, hạng chốt).
 * API trả URL bất đồng bộ → poll tới khi 200. Không trả timestamp → align.ts chia tỉ lệ.
 */
import fs from "node:fs";
import { StudioError } from "../errors.js";
import { voiceCost } from "../pricing.js";
import { probeDuration } from "../ffmpeg.js";
import type { VoiceEngine } from "./types.js";

export const FPT_VOICES = [
  { id: "banmai", label: "Ban Mai (nữ, Bắc)" }, { id: "leminh", label: "Lê Minh (nam, Bắc)" }, { id: "thuminh", label: "Thu Minh (nữ, Bắc)" },
  { id: "giahuy", label: "Gia Huy (nam, Trung)" }, { id: "ngoclam", label: "Ngọc Lam (nữ, Huế)" }, { id: "myan", label: "Mỹ An (nữ, Trung)" },
  { id: "lannhi", label: "Lan Nhi (nữ, Nam)" }, { id: "linhsan", label: "Linh San (nữ, Nam)" }, { id: "minhquang", label: "Minh Quang (nam, Nam)" },
];

/** rate 1.0 = 0; mỗi 0.2 = 1 bậc; FPT nhận -3..3. */
export const rateToSpeed = (rate: number) => Math.max(-3, Math.min(3, Math.round(((rate || 1) - 1) * 5)));

export function fptVoiceEngine(apiKey: string, fetchImpl: typeof fetch = fetch, deps: { pollMs?: number; maxWaitMs?: number; probe?: (p: string) => Promise<number> } = {}): VoiceEngine {
  const pollMs = deps.pollMs ?? 2000, maxWaitMs = deps.maxWaitMs ?? 90_000, probe = deps.probe ?? probeDuration;
  return {
    name: "fpt",
    voices: () => FPT_VOICES,
    async synthesize(req) {
      const res = await fetchImpl("https://api.fpt.ai/hmi/tts/v5", {
        method: "POST",
        headers: { "api-key": apiKey, voice: req.voice, speed: String(rateToSpeed(req.rate)), format: "mp3" },
        body: req.text,
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || Number(j?.error) !== 0 || !j?.async) throw new StudioError(res.status === 401 || res.status === 403 ? "billing" : "other", `FPT.AI: ${j?.message || res.status}`);
      const started = Date.now();
      for (;;) {
        const a = await fetchImpl(j.async);
        if (a.ok && a.status === 200) { fs.writeFileSync(req.outPath, Buffer.from(await a.arrayBuffer())); break; }
        if (Date.now() - started > maxWaitMs) throw new StudioError("network", "FPT.AI quá lâu chưa trả file giọng.");
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return { path: req.outPath, durationSec: await probe(req.outPath), words: null, costUsd: voiceCost("fpt", req.text.length) };
    },
  };
}
```
- [ ]  **Step 8: Chạy test — PASS.** Commit:

```bash
git add server/studio/subtitles.ts server/studio/subtitles.test.ts server/studio/engines/align.ts server/studio/engines/voice.ts server/studio/engines/voice.test.ts server/studio/engines/voiceFpt.ts server/studio/engines/voiceFpt.test.ts
git commit -m "feat(xuong): phụ đề ASS/SRT từ timestamp, giọng edge-tts (word boundary) + FPT.AI, align tỉ lệ"
```

---

### Task 8: Kịch bản — schema, ràng buộc âm tiết, sinh bằng Gemini

**Files:**
- Modify: `server/gemini.ts:125` (`function extractJSON` → `export function extractJSON`)
- Create: `server/studio/script.ts`, `server/studio/script.test.ts`

**Interfaces:**

-

Produces: `PURPOSES`, `CAMERAS`, `MOTIONS`, `ScriptShot`, `Script {shots, caption, hashtags[], cover_idx}`, `validateScript(raw, {maxSyllables})`, `buildScriptPrompt(a)`, `generateScriptAI(a)`.

-

[ ]  **Step 1: Sửa `server/gemini.ts`** — dòng 125 đổi thành `export function extractJSON(text: string): any | null {` (không đổi gì khác).

-

[ ]  **Step 2: Test `server/studio/script.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScript, buildScriptPrompt } from "./script.js";

const shot = (dialog: string, extra: any = {}) => ({ purpose: "product", camera: "medium", dialog, image_prompt: "p", motion_prompt: "m", motion_level: "medium", ...extra });

test("validateScript: hợp lệ, mặc định enum lạ, cắt hashtag về 8", () => {
  const r = validateScript({ shots: [shot("Giòn rụm", { purpose: "lạ", camera: "xa" })], caption: "c", hashtags: Array(12).fill("#x"), cover_idx: 5 }, { maxSyllables: 38 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.script.shots[0].purpose, "product");
    assert.equal(r.script.shots[0].camera, "medium");
    assert.equal(r.script.hashtags.length, 8);
    assert.equal(r.script.cover_idx, 0);
  }
});

test("validateScript: thoại vượt ngân sách âm tiết → lỗi ghi rõ cảnh và số", () => {
  const r = validateScript({ shots: [shot("một hai ba bốn năm sáu")], caption: "", hashtags: [] }, { maxSyllables: 5 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors[0], /Cảnh 1.*6.*5/);
});

test("validateScript: 0 hoặc >8 cảnh → lỗi", () => {
  assert.equal(validateScript({ shots: [] }, { maxSyllables: 38 }).ok, false);
  assert.equal(validateScript({ shots: Array(9).fill(shot("a")) }, { maxSyllables: 38 }).ok, false);
});

test("buildScriptPrompt nêu ngưỡng âm tiết, số cảnh, ngành, và yêu cầu JSON", () => {
  const p = buildScriptPrompt({ productName: "Mẹt đốt", industry: "food", shots: 4, clipLen: 8, maxSyllables: 38, hasBackground: true });
  assert.match(p, /38 âm tiết/);
  assert.match(p, /4 cảnh/);
  assert.match(p, /"shots"/);
  assert.match(p, /motion_level/);
});
```
- [ ]  **Step 3: Viết `server/studio/script.ts`**

```ts
/**
 * server/studio/script.ts — Phiếu kịch bản: 4 nguồn (AI/mổ xẻ/mẫu/nhập tay) đổ về CÙNG schema.
 * GĐ 1: nguồn AI (Gemini nhìn ảnh) + nhập tay. Ràng buộc: âm tiết thoại ≤ nhịp × clip_len (spec 3.3a).
 */
import fs from "node:fs";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { extractJSON } from "../gemini.js";
import { StudioError } from "../errors.js";
import { countSyllables } from "./text.js";
import type { FileRef } from "./engines/types.js";

export const PURPOSES = ["hook", "packaging", "product", "label", "interaction", "cta"] as const;
export const CAMERAS = ["wide", "medium", "close"] as const;
export const MOTIONS = ["low", "medium", "high"] as const;
export interface ScriptShot { purpose: (typeof PURPOSES)[number]; camera: (typeof CAMERAS)[number]; dialog: string; image_prompt: string; motion_prompt: string; motion_level: (typeof MOTIONS)[number] }
export interface Script { shots: ScriptShot[]; caption: string; hashtags: string[]; cover_idx: number }

const pick = <T extends readonly string[]>(list: T, v: any, d: T[number]): T[number] => (list as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : d;

export function validateScript(raw: any, o: { maxSyllables: number }): { ok: true; script: Script } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const shotsIn: any[] = Array.isArray(raw?.shots) ? raw.shots : [];
  if (shotsIn.length < 1 || shotsIn.length > 8) errors.push(`Cần 1–8 cảnh, nhận ${shotsIn.length}.`);
  const shots: ScriptShot[] = shotsIn.slice(0, 8).map((s, i) => {
    const dialog = String(s?.dialog || "").trim();
    const n = countSyllables(dialog);
    if (n > o.maxSyllables) errors.push(`Cảnh ${i + 1}: thoại ${n} âm tiết, vượt ngưỡng ${o.maxSyllables}.`);
    return {
      purpose: pick(PURPOSES, s?.purpose, "product"),
      camera: pick(CAMERAS, s?.camera, "medium"),
      dialog,
      image_prompt: String(s?.image_prompt || "").trim(),
      motion_prompt: String(s?.motion_prompt || "").trim(),
      motion_level: pick(MOTIONS, s?.motion_level, "medium"),
    };
  });
  if (errors.length) return { ok: false, errors };
  const hashtags = (Array.isArray(raw?.hashtags) ? raw.hashtags : []).map((h: any) => String(h).trim()).filter(Boolean).slice(0, 8);
  const cover = Number(raw?.cover_idx);
  return { ok: true, script: { shots, caption: String(raw?.caption || "").trim(), hashtags, cover_idx: Number.isInteger(cover) && cover >= 0 && cover < shots.length ? cover : 0 } };
}

export function buildScriptPrompt(a: { productName: string; industry: string; shots: number; clipLen: number; maxSyllables: number; hasBackground: boolean; notes?: string; autopsy?: string }): string {
  return `Bạn là biên kịch video review TikTok Shop của Nonelab. Nhìn các ảnh đính kèm: ảnh sản phẩm${a.hasBackground ? " và ảnh bối cảnh cuối cùng" : ""}.
Sản phẩm: "${a.productName}". Ngành hàng: ${a.industry}.${a.notes ? `\nGhi chú của người dùng: ${a.notes}` : ""}${a.autopsy ? `\nKhung từ Phiếu mổ xẻ video bùng nổ (bám theo nhịp và công thức này):\n${a.autopsy}` : ""}

Viết kịch bản đúng ${a.shots} cảnh, mỗi cảnh là một clip ${a.clipLen} giây, quay dọc 9:16, CHỈ CÓ BÀN TAY tương tác với sản phẩm, KHÔNG có mặt người, không chữ chèn.
Quy tắc:
- Cảnh 1 luôn là hook (purpose "hook"). Có ít nhất một cảnh "interaction" (tay bóc/cầm/chấm/rót). Cảnh cuối là "cta".
- Mỗi "dialog" (lời đọc tiếng Việt, tự nhiên như người thật nói) TỐI ĐA ${a.maxSyllables} âm tiết. Không vượt.
- "image_prompt": tiếng Anh, mô tả một khung hình tĩnh photorealistic: sản phẩm ĐÚNG như ảnh tham chiếu (giữ nguyên bao bì, chữ, màu), đặt trong bối cảnh tham chiếu, ánh sáng, góc máy (${CAMERAS.join("/")}), bàn tay nếu có.
- "motion_prompt": tiếng Anh, mô tả chuyển động trong ${a.clipLen}s bắt đầu từ đúng khung hình đó (camera + hành động tay).
- "motion_level": "low" cho cảnh nhìn rõ nhãn/chữ trên bao bì (packaging/label), "medium" mặc định, "high" chỉ khi hành động mạnh.
- "camera": một trong ${CAMERAS.join(", ")}. "purpose": một trong ${PURPOSES.join(", ")}.
- "caption": caption đăng TikTok Shop tiếng Việt ≤ 150 ký tự. "hashtags": 5–8 hashtag. "cover_idx": chỉ số cảnh (từ 0) làm ảnh bìa.

Trả về DUY NHẤT một JSON:
{"shots":[{"purpose":"hook","camera":"close","dialog":"...","image_prompt":"...","motion_prompt":"...","motion_level":"medium"}],"caption":"...","hashtags":["#..."],"cover_idx":0}`;
}

export async function generateScriptAI(a: { apiKey: string; model: string; refs: FileRef[]; productName: string; industry: string; shots: number; clipLen: number; maxSyllables: number; hasBackground: boolean; notes?: string; autopsy?: string }): Promise<Script> {
  const ai = new GoogleGenAI({ apiKey: a.apiKey });
  const parts: any[] = a.refs.map((r) => ({ inlineData: { data: fs.readFileSync(r.path).toString("base64"), mimeType: r.mimeType } }));
  parts.push(buildScriptPrompt(a));
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await ai.models.generateContent({ model: a.model, contents: createUserContent(parts), config: { responseMimeType: "application/json", temperature: 0.8 } });
    const json = extractJSON((resp.text ?? "").trim());
    const v = validateScript(json, { maxSyllables: a.maxSyllables });
    if (v.ok) return v.script;
    lastErrors = v.errors;
    parts[parts.length - 1] = buildScriptPrompt(a) + `\n\nLần trước bị lỗi, hãy sửa: ${v.errors.join(" ")}`;
  }
  throw new StudioError("other", `Kịch bản AI không đạt sau 2 lần: ${lastErrors.join(" ")}`);
}
```
- [ ]  **Step 4: Chạy test — PASS.** Commit:

```bash
git add server/gemini.ts server/studio/script.ts server/studio/script.test.ts
git commit -m "feat(xuong): phiếu kịch bản — schema, ngân sách âm tiết, sinh bằng Gemini nhìn ảnh"
```

---

### Task 9: Ghép — filter graph ffmpeg (xfade, giọng theo cảnh, nhạc, burn phụ đề)

**Files:**
- Create: `server/studio/assemble.ts`, `server/studio/assemble.test.ts`

**Interfaces:**

-

Produces: `Transition = "none"|"fade"|"dissolve"|"wipeleft"|"slideleft"|"zoomin"`, `TRANSITIONS`, `clipStarts(durations, t)`, `totalDuration(durations, t)`, `AssembleInput`, `buildAssembleArgs(input, transitionSec)`, `assembleVideo(input)`.

-

[ ]  **Step 1: Test `server/studio/assemble.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clipStarts, totalDuration, buildAssembleArgs, assembleVideo } from "./assemble.js";
import { fakeVideoEngine, fakeVoiceEngine } from "./engines/fake.js";
import { probeDuration } from "./ffmpeg.js";

test("clipStarts/totalDuration với chuyển cảnh 0.5s", () => {
  assert.deepEqual(clipStarts([8, 8, 8], 0.5), [0, 7.5, 15]);
  assert.equal(totalDuration([8, 8, 8], 0.5), 23);
  assert.deepEqual(clipStarts([8, 8], 0), [0, 8]);
});

const base = (dir: string) => ({
  clips: [{ path: path.join(dir, "a.mp4"), durationSec: 4 }, { path: path.join(dir, "b.mp4"), durationSec: 4 }],
  voices: [{ path: path.join(dir, "v0.mp3"), startSec: 0 }, null],
  cues: [{ text: "Xin chào", startSec: 0.2, endSec: 1.5 }],
  musicPath: null as string | null,
  transition: "fade" as const,
  width: 1080, height: 1920, font: "DejaVu Sans",
  outPath: path.join(dir, "out.mp4"), assPath: path.join(dir, "subs.ass"),
});

test("buildAssembleArgs: xfade offset đúng, adelay theo ms, subtitles, -t tổng", () => {
  const args = buildAssembleArgs(base("/x"), 0.5).join(" ");
  assert.match(args, /xfade=transition=fade:duration=0\.5:offset=3\.5/);
  assert.match(args, /adelay=0\|0/);
  assert.match(args, /subtitles=/);
  assert.match(args, /-t 7\.5 /);
  assert.match(args, /-map \[vout\] -map \[aout\]/);
});

test("buildAssembleArgs: transition none → concat; không giọng không nhạc → -an", () => {
  const i = { ...base("/x"), transition: "none" as const, voices: [null, null] };
  const args = buildAssembleArgs(i, 0.5).join(" ");
  assert.match(args, /concat=n=2:v=1:a=0/);
  assert.match(args, / -an /);
  assert.match(args, /-t 8 /);
});

test("assembleVideo ghép thật 2 clip giả + giọng giả + phụ đề (không nhạc)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-"));
  const v = fakeVideoEngine();
  await v.generate({ prompt: "", firstFrame: { path: "", mimeType: "image/png" }, durationSec: 4, aspectRatio: "9:16", tier: "draft", motionLevel: "low", outPath: path.join(dir, "a.mp4") });
  await v.generate({ prompt: "", firstFrame: { path: "", mimeType: "image/png" }, durationSec: 4, aspectRatio: "9:16", tier: "draft", motionLevel: "low", outPath: path.join(dir, "b.mp4") });
  await fakeVoiceEngine().synthesize({ text: "xin chào các bạn", voice: "fake", rate: 1, outPath: path.join(dir, "v0.mp3") });
  const r = await assembleVideo(base(dir));
  assert.ok(fs.statSync(r.outPath).size > 1000);
  assert.ok(Math.abs(r.durationSec - 7.5) < 0.4, `dur=${r.durationSec}`);
  assert.ok(Math.abs((await probeDuration(r.outPath)) - 7.5) < 0.4);
});
```
- [ ]  **Step 2: Viết `server/studio/assemble.ts`**

```ts
/**
 * server/studio/assemble.ts — MỘT lệnh ffmpeg, MỘT lần encode: scale/crop → xfade → subtitles;
 * giọng từng cảnh đặt đúng mốc bằng adelay; nhạc nền loop + volume + fade-out 3s; -t chặn tổng.
 * (Bài học MoneyPrinterTurbo, spec 3.3c–e.)
 */
import fs from "node:fs";
import { STUDIO } from "./config.js";
import { runFfmpeg, probeDuration } from "./ffmpeg.js";
import { toAss, type SubCue } from "./subtitles.js";

export const TRANSITIONS = ["none", "fade", "dissolve", "wipeleft", "slideleft", "zoomin"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export interface AssembleInput {
  clips: { path: string; durationSec: number }[];
  voices: ({ path: string; startSec: number } | null)[];   // cùng độ dài với clips
  cues: SubCue[];                                          // đã dời theo mốc cảnh
  musicPath: string | null;
  transition: Transition;
  width: number; height: number; font: string;
  outPath: string; assPath: string;
}

/** start_k = Σ d(0..k-1) − k·t. Với transition none, t = 0. */
export function clipStarts(durations: number[], t: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let k = 0; k < durations.length; k++) { out.push(Math.round((acc - k * t) * 1000) / 1000); acc += durations[k]; }
  return out;
}
export const totalDuration = (durations: number[], t: number) =>
  Math.round((durations.reduce((a, b) => a + b, 0) - t * Math.max(0, durations.length - 1)) * 1000) / 1000;

const escFilterPath = (p: string) => p.replace(/\\/g, "\\\\").replace(/'/g, "'\\''").replace(/:/g, "\\:");

export function buildAssembleArgs(i: AssembleInput, transitionSec: number): string[] {
  const n = i.clips.length;
  const t = i.transition === "none" ? 0 : transitionSec;
  const durs = i.clips.map((c) => c.durationSec);
  const starts = clipStarts(durs, t);
  const total = totalDuration(durs, t);
  const args: string[] = ["-hide_banner", "-loglevel", "error"];
  i.clips.forEach((c) => args.push("-i", c.path));
  const voiceIdx: number[] = [];
  i.voices.forEach((v) => { if (v) { voiceIdx.push(n + voiceIdx.length); args.push("-i", v.path); } });
  let musicIdx = -1;
  if (i.musicPath) { musicIdx = n + voiceIdx.length; args.push("-stream_loop", "-1", "-i", i.musicPath); }

  const f: string[] = [];
  for (let k = 0; k < n; k++) f.push(`[${k}:v]scale=${i.width}:${i.height}:force_original_aspect_ratio=increase,crop=${i.width}:${i.height},setsar=1,fps=24,format=yuv420p[v${k}]`);
  let vlast = "[v0]";
  if (n > 1 && t > 0) {
    for (let k = 1; k < n; k++) { const o = `[x${k}]`; f.push(`${vlast}[v${k}]xfade=transition=${i.transition}:duration=${t}:offset=${starts[k]}${o}`); vlast = o; }
  } else if (n > 1) {
    f.push(`${i.clips.map((_, k) => `[v${k}]`).join("")}concat=n=${n}:v=1:a=0[vcat]`); vlast = "[vcat]";
  }
  f.push(`${vlast}subtitles=filename='${escFilterPath(i.assPath)}'[vout]`);

  const aparts: string[] = [];
  let vi = 0;
  i.voices.forEach((v) => {
    if (!v) return;
    const ms = Math.round(v.startSec * 1000);
    f.push(`[${voiceIdx[vi]}:a]adelay=${ms}|${ms}[a${vi}]`); aparts.push(`[a${vi}]`); vi++;
  });
  if (musicIdx >= 0) { f.push(`[${musicIdx}:a]volume=${STUDIO.musicVolume},afade=t=out:st=${Math.max(0, total - 3)}:d=3[bg]`); aparts.push("[bg]"); }
  let audioMap: string[];
  if (aparts.length === 0) audioMap = ["-an"];
  else if (aparts.length === 1) { f.push(`${aparts[0]}anull[aout]`); audioMap = ["-map", "[aout]"]; }
  else { f.push(`${aparts.join("")}amix=inputs=${aparts.length}:duration=longest:normalize=0[aout]`); audioMap = ["-map", "[aout]"]; }

  args.push("-filter_complex", f.join(";"), "-map", "[vout]", ...audioMap,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "24",
    ...(aparts.length ? ["-c:a", "aac", "-b:a", "128k"] : []),
    "-movflags", "+faststart", "-t", String(total), "-y", i.outPath);
  return args;
}

export async function assembleVideo(i: AssembleInput): Promise<{ outPath: string; durationSec: number }> {
  fs.writeFileSync(i.assPath, toAss(i.cues, { font: i.font, width: i.width, height: i.height }));
  await runFfmpeg(buildAssembleArgs(i, STUDIO.transitionSec), { timeoutMs: 15 * 60_000 });
  return { outPath: i.outPath, durationSec: await probeDuration(i.outPath) };
}
```
- [ ]  **Step 3: Chạy test — PASS** (test cuối chạy ffmpeg thật ~5–10s). Nếu lỗi `No such filter: 'subtitles'` → ffmpeg thiếu libass; trên mac cài `brew install ffmpeg` và đặt `FFMPEG_PATH=$(which ffmpeg)`. Commit:

```bash
git add server/studio/assemble.ts server/studio/assemble.test.ts
git commit -m "feat(xuong): ghép ffmpeg một lần encode — xfade, giọng theo cảnh, nhạc nền, burn ASS"
```

---

### Task 10: Pipeline — máy trạng thái shot/project, chạy từng chặng, phục hồi sau restart

**Files:**
- Create: `server/studio/pipeline.ts`, `server/studio/pipeline.test.ts`

**Interfaces:**

-

Consumes: store, engines, script, subtitles, assemble, pricing, errors, config, text.

-

Produces: `makeEngines(apiKey)`, `RunOutcome {ok, kind?}`, `syllablesPerSecFor(project)`, `requestKeyframes(projectId, shotIds?)`, `runShotImage(shot, engines)`, `setApproved(shotId, approved)`, `requestClips(projectId, tier)`, `runShotClip(shot, engines)`, `requestAssemble(projectId, opts)`, `runAssemble(project, engines)`, `recoverInterrupted()`.

-

[ ]  **Step 1: Test `server/studio/pipeline.test.ts`**

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { initStudioTables } from "./db.js";
import { createProject, addAsset, replaceShots, listShots, getProject, getRender, updateShot } from "./store.js";
import { ensureProjectDirs } from "./config.js";
import { fakeImageEngine } from "./engines/fake.js";
import { makeEngines, requestKeyframes, runShotImage, setApproved, requestClips, runShotClip, requestAssemble, runAssemble, recoverInterrupted } from "./pipeline.js";

before(async () => { await initStudioTables(); });

async function seed() {
  const p = await createProject({ owner: "a@x", name: "Gà rán", industry: "food", ratio: "9:16", clipLen: 4, tier: "draft", scriptSource: "manual" });
  const root = ensureProjectDirs(p.id);
  const prod = path.join(root, "assets", "prod.png");
  await fakeImageEngine().generate({ prompt: "", refs: [], aspectRatio: "9:16", size: "1K", outPath: prod });
  await addAsset(p.id, "product", prod, "image/png");
  await replaceShots(p.id, [
    { purpose: "hook", camera: "close", dialog: "Mở hộp ra thơm nức", image_prompt: "a", motion_prompt: "b", motion_level: "low" },
    { purpose: "cta", camera: "medium", dialog: "Đặt ngay giỏ hàng", image_prompt: "c", motion_prompt: "d", motion_level: "medium" },
  ]);
  return p;
}

test("trọn pipeline với engine giả: ảnh → duyệt → clip → ghép", { timeout: 120_000 }, async () => {
  const engines = makeEngines("");
  const p = await seed();
  assert.equal(await requestKeyframes(p.id), 2);
  for (const s of await listShots(p.id)) { const r = await runShotImage(s, engines); assert.ok(r.ok); }
  let shots = await listShots(p.id);
  assert.ok(shots.every((s) => s.image_status === "done" && s.image_path && fs.existsSync(s.image_path)));
  assert.equal((await getProject(p.id))!.stage, "review");

  // Chưa duyệt → không được render.
  assert.equal((await requestClips(p.id, "draft")).ok, false);
  await setApproved(shots[0].id, 1); await setApproved(shots[1].id, 1);
  const rc = await requestClips(p.id, "draft");
  assert.ok(rc.ok);
  for (const s of await listShots(p.id)) { const r = await runShotClip(s, engines); assert.ok(r.ok, JSON.stringify(r)); }
  shots = await listShots(p.id);
  assert.ok(shots.every((s) => s.clip_status === "done" && s.clip_path && fs.existsSync(s.clip_path)));

  const ra = await requestAssemble(p.id, { voice: "fake", voiceRate: 1, music: null, transition: "fade" });
  assert.ok(ra.ok);
  const out = await runAssemble((await getProject(p.id))!, engines);
  assert.ok(out.ok, JSON.stringify(out));
  const render = await getRender(p.id);
  assert.ok(render && fs.statSync(render.mp4_path).size > 1000);
  assert.ok(render!.cover_path && fs.existsSync(render!.cover_path));
  assert.equal((await getProject(p.id))!.stage, "done");
});

test("requestClips từ chối khi thoại vượt ngân sách âm tiết", async () => {
  const p = await seed();
  const [s] = await listShots(p.id);
  await updateShot(s.id, { image_status: "done", image_path: "/tmp/x.png", approved: 1, dialog: Array(40).fill("a").join(" ") }); // 40 > 4.5*4=18
  const r = await requestClips(p.id, "draft");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /Cảnh 1/);
});

test("recoverInterrupted: shot đang processing có file → done, không có file → pending; clip đã xong KHÔNG đụng", async () => {
  const p = await seed();
  const [s0, s1] = await listShots(p.id);
  const root = ensureProjectDirs(p.id);
  const done = path.join(root, "clips", "ok.mp4"); fs.writeFileSync(done, "x");
  await updateShot(s0.id, { clip_status: "processing", clip_path: done, approved: 1 });
  await updateShot(s1.id, { image_status: "processing", image_path: null });
  const before = fs.statSync(done).mtimeMs;
  await recoverInterrupted();
  const [a, b] = await listShots(p.id);
  assert.equal(a.clip_status, "done");
  assert.equal(fs.statSync(done).mtimeMs, before);
  assert.equal(b.image_status, "pending");
});
```

-

[ ]  **Step 2: Chạy test — FAIL** (`Cannot find module './pipeline.js'`)

-

[ ]  **Step 3: Viết `server/studio/pipeline.ts`**

```ts
/**
 * server/studio/pipeline.ts — 5 chặng + máy trạng thái. Mỗi cảnh độc lập: hỏng ở đâu chạy lại
 * đúng chỗ đó. Chi phí ghi sổ ngay khi API trả về. Không gọi ffmpeg/model ở request — queue gọi các run*.
 */
import fs from "node:fs";
import path from "node:path";
import { STUDIO, ensureProjectDirs, projectDir, frameSize } from "./config.js";
import { classifyError, retryDelayMs, humanKind } from "./errors.js";
import { countSyllables, maxSyllablesFor } from "./text.js";
import { getProject, listAssets, listShots, updateShot, updateProject, recordCost, addDiskBytes, saveRender, type Project, type Shot } from "./store.js";
import { allQuery, runQuery } from "../db.js";
import { nanoImageEngine } from "./engines/image.js";
import { veoVideoEngine } from "./engines/video.js";
import { edgeVoiceEngine } from "./engines/voice.js";
import { fptVoiceEngine } from "./engines/voiceFpt.js";
import { fakeImageEngine, fakeVideoEngine, fakeVoiceEngine, FAKE_SYLLABLES_PER_SEC } from "./engines/fake.js";
import { alignWords } from "./engines/align.js";
import type { Engines } from "./engines/types.js";
import { groupCues, shiftCues, toSrt, type SubCue } from "./subtitles.js";
import { assembleVideo, clipStarts, TRANSITIONS, type Transition } from "./assemble.js";
import { runFfmpeg, probeDuration } from "./ffmpeg.js";

export interface RunOutcome { ok: boolean; kind?: ReturnType<typeof classifyError>; message?: string }

export function makeEngines(apiKey: string): Engines {
  const e = STUDIO.engines;
  return {
    image: e.image === "fake" ? fakeImageEngine() : nanoImageEngine(apiKey),
    video: e.video === "fake" ? fakeVideoEngine() : veoVideoEngine(apiKey),
    voice: e.voice === "fake" ? fakeVoiceEngine() : e.voice === "fpt" ? fptVoiceEngine((process.env.FPT_TTS_API_KEY || "").trim()) : edgeVoiceEngine(),
  };
}

/** Nhịp preset theo engine giọng (GĐ 1). GĐ 1.5: lấy từ studio_voices. */
export function syllablesPerSecFor(_p: Project): number {
  return STUDIO.engines.voice === "fake" ? FAKE_SYLLABLES_PER_SEC : 4.8;
}

const fileSize = (p: string) => { try { return fs.statSync(p).size; } catch { return 0; } };
const mimeOf = (p: string) => (/\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg");

async function fail(shot: Shot, field: "image" | "clip", err: unknown): Promise<RunOutcome> {
  const kind = classifyError(err);
  const attempts = (shot.attempts || 0) + 1;
  const delay = retryDelayMs(kind, attempts - 1);
  const msg = `${humanKind(kind)} ${String((err as any)?.message || err).slice(0, 300)}`;
  if (delay !== null) {
    await updateShot(shot.id, { [`${field}_status`]: "pending", attempts, retry_after: new Date(Date.now() + delay).toISOString(), error: msg } as any);
  } else {
    await updateShot(shot.id, { [`${field}_status`]: "failed", attempts, retry_after: null, error: msg } as any);
  }
  console.error(`[xuong] ${field} shot ${shot.id} lỗi (${kind}, lần ${attempts}): ${msg}`);
  return { ok: false, kind, message: msg };
}

// ── Chặng 2: ảnh khoá ─────────────────────────────────────────────────────────
export async function requestKeyframes(projectId: string, shotIds?: string[]): Promise<number> {
  const shots = await listShots(projectId);
  const targets = shots.filter((s) => (!shotIds || shotIds.includes(s.id)) && s.image_status !== "processing");
  for (const s of targets) await updateShot(s.id, { image_status: "pending", image_path: null, approved: 0, clip_status: "idle", clip_path: null, clip_tier: null, attempts: 0, retry_after: null, error: null });
  await updateProject(projectId, { stage: "keyframe", message: null });
  return targets.length;
}

export async function runShotImage(shot: Shot, engines: Engines): Promise<RunOutcome> {
  const p = await getProject(shot.project_id);
  if (!p) return { ok: false, message: "Không thấy dự án." };
  await updateShot(shot.id, { image_status: "processing" });
  try {
    const assets = await listAssets(p.id);
    const refs = [...assets.filter((a) => a.kind === "product"), ...assets.filter((a) => a.kind === "background")].map((a) => ({ path: a.path, mimeType: a.mime }));
    const root = ensureProjectDirs(p.id);
    const outPath = path.join(root, "keyframes", `shot_${shot.idx}_${Date.now()}.png`);
    const prompt = `${shot.image_prompt}\nThe product must match the reference photos exactly (same packaging, text, colors). Place it in the reference background. Photorealistic, vertical ${p.ratio}, hands only, no faces, no overlaid text.`;
    const r = await engines.image.generate({ prompt, refs, aspectRatio: p.ratio, size: "2K", outPath });
    await updateShot(shot.id, { image_status: "done", image_path: r.path, error: null, retry_after: null });
    await recordCost({ projectId: p.id, shotId: shot.id, kind: "image", model: r.model, usd: r.costUsd });
    await addDiskBytes(p.id, fileSize(r.path));
    const all = await listShots(p.id);
    if (all.every((s) => s.image_status === "done")) await updateProject(p.id, { stage: "review" });
    return { ok: true };
  } catch (e) {
    return fail(shot, "image", e);
  }
}

// ── Chặng 3: chốt duyệt ───────────────────────────────────────────────────────
export const setApproved = (shotId: string, approved: 0 | 1) => updateShot(shotId, { approved });

// ── Chặng 4: clip ─────────────────────────────────────────────────────────────
export async function requestClips(projectId: string, tier: "draft" | "final"): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const p = await getProject(projectId);
  if (!p) return { ok: false, message: "Không thấy dự án." };
  const shots = (await listShots(projectId)).filter((s) => s.approved === 1 && s.image_status === "done" && s.image_path);
  if (!shots.length) return { ok: false, message: "Chưa có ảnh nào được duyệt." };
  const max = maxSyllablesFor(syllablesPerSecFor(p), p.clip_len);
  const over = shots.filter((s) => countSyllables(s.dialog) > max).map((s) => `Cảnh ${s.idx + 1}: ${countSyllables(s.dialog)}/${max} âm tiết`);
  if (over.length) return { ok: false, message: `Thoại quá dài, sửa trước khi render — ${over.join("; ")}` };
  let count = 0;
  for (const s of shots) {
    if (s.clip_status === "done" && s.clip_path && s.clip_tier === tier && fs.existsSync(s.clip_path)) continue;
    await updateShot(s.id, { clip_status: "pending", clip_tier: tier, attempts: 0, retry_after: null, error: null });
    count++;
  }
  await updateProject(projectId, { tier, stage: "clip", message: null });
  return { ok: true, count };
}

export async function runShotClip(shot: Shot, engines: Engines): Promise<RunOutcome> {
  const p = await getProject(shot.project_id);
  if (!p) return { ok: false, message: "Không thấy dự án." };
  if (!shot.approved || !shot.image_path) { await updateShot(shot.id, { clip_status: "idle" }); return { ok: false, message: "Shot chưa duyệt." }; }
  await updateShot(shot.id, { clip_status: "processing" });
  try {
    const tier = (shot.clip_tier as "draft" | "final") || p.tier;
    const outPath = path.join(ensureProjectDirs(p.id), "clips", `shot_${shot.idx}_${tier}_${Date.now()}.mp4`);
    const r = await engines.video.generate({ prompt: shot.motion_prompt || shot.image_prompt, firstFrame: { path: shot.image_path, mimeType: mimeOf(shot.image_path) }, durationSec: p.clip_len as 4 | 6 | 8, aspectRatio: p.ratio, tier, motionLevel: shot.motion_level, outPath });
    await updateShot(shot.id, { clip_status: "done", clip_path: r.path, clip_tier: tier, engine: r.model, error: null, retry_after: null });
    await recordCost({ projectId: p.id, shotId: shot.id, kind: "video", model: r.model, usd: r.costUsd });
    await addDiskBytes(p.id, fileSize(r.path));
    return { ok: true };
  } catch (e) {
    return fail(shot, "clip", e);
  }
}

// ── Chặng 5: ghép ─────────────────────────────────────────────────────────────
export async function requestAssemble(projectId: string, o: { voice?: string; voiceRate?: number; music?: string | null; transition?: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = await getProject(projectId);
  if (!p) return { ok: false, message: "Không thấy dự án." };
  const approved = (await listShots(projectId)).filter((s) => s.approved === 1);
  if (!approved.length) return { ok: false, message: "Chưa có cảnh nào được duyệt." };
  const notReady = approved.filter((s) => s.clip_status !== "done" || !s.clip_path);
  if (notReady.length) return { ok: false, message: `Còn ${notReady.length} cảnh chưa có clip.` };
  const transition = TRANSITIONS.includes(o.transition as Transition) ? (o.transition as Transition) : "fade";
  await updateProject(projectId, { voice: o.voice || p.voice || STUDIO.voiceDefault, voice_rate: o.voiceRate || p.voice_rate || 1, music: o.music ?? null, transition, stage: "assemble", assemble_status: "pending", message: null });
  return { ok: true };
}

export async function runAssemble(p: Project, engines: Engines): Promise<RunOutcome> {
  await updateProject(p.id, { assemble_status: "processing" });
  try {
    const shots = (await listShots(p.id)).filter((s) => s.approved === 1 && s.clip_status === "done" && s.clip_path);
    if (!shots.length) throw new Error("Không có cảnh nào để ghép.");
    const root = ensureProjectDirs(p.id);
    const renderDir = path.join(root, "render");
    const clips: { path: string; durationSec: number }[] = [];
    for (const s of shots) clips.push({ path: s.clip_path!, durationSec: await probeDuration(s.clip_path!) });
    const t = p.transition === "none" ? 0 : STUDIO.transitionSec;
    const starts = clipStarts(clips.map((c) => c.durationSec), t);

    const voices: ({ path: string; startSec: number } | null)[] = [];
    const cues: SubCue[] = [];
    let voiceCost = 0;
    for (let k = 0; k < shots.length; k++) {
      const s = shots[k];
      if (!s.dialog.trim()) { voices.push(null); continue; }
      const outPath = path.join(renderDir, `voice_${s.idx}.mp3`);
      const r = await engines.voice.synthesize({ text: s.dialog, voice: p.voice || STUDIO.voiceDefault, rate: p.voice_rate || 1, outPath });
      voiceCost += r.costUsd;
      if (r.durationSec > clips[k].durationSec + 0.3) console.warn(`[xuong] Cảnh ${s.idx + 1}: giọng ${r.durationSec.toFixed(1)}s dài hơn clip ${clips[k].durationSec}s.`);
      voices.push({ path: r.path, startSec: starts[k] });
      cues.push(...shiftCues(groupCues(alignWords(r.words, s.dialog, r.durationSec)), starts[k]));
    }
    if (voiceCost > 0) await recordCost({ projectId: p.id, kind: "voice", model: engines.voice.name, usd: voiceCost });

    const { width, height } = frameSize(p.ratio);
    const musicPath = p.music ? path.join(STUDIO.dataDir, "_music", path.basename(p.music)) : null;
    const outPath = path.join(renderDir, `final_${Date.now()}.mp4`);
    const res = await assembleVideo({ clips, voices, cues, musicPath: musicPath && fs.existsSync(musicPath) ? musicPath : null, transition: (p.transition as Transition) || "fade", width, height, font: STUDIO.subFont, outPath, assPath: path.join(renderDir, "subs.ass") });

    const coverSrc = (shots[Math.min(p.cover_idx || 0, shots.length - 1)] || shots[0]).image_path;
    const coverPath = path.join(renderDir, "cover.jpg");
    if (coverSrc && fs.existsSync(coverSrc)) await runFfmpeg(["-i", coverSrc, "-q:v", "3", "-y", coverPath]);
    const srtPath = path.join(renderDir, "subs.srt");
    fs.writeFileSync(srtPath, toSrt(cues));

    await saveRender({ project_id: p.id, mp4_path: res.outPath, cover_path: fs.existsSync(coverPath) ? coverPath : null, srt_path: srtPath, caption: p.caption, hashtags: p.hashtags, voice: p.voice, music: p.music, duration: res.durationSec, cost_usd: voiceCost });
    await addDiskBytes(p.id, fileSize(res.outPath) + fileSize(coverPath));
    await updateProject(p.id, { stage: "done", assemble_status: "done", message: null });
    return { ok: true };
  } catch (e) {
    const kind = classifyError(e);
    const message = `${humanKind(kind)} ${String((e as any)?.message || e).slice(0, 300)}`;
    await updateProject(p.id, { assemble_status: "failed", stage: "failed", message });
    console.error(`[xuong] ghép ${p.id} lỗi: ${message}`);
    return { ok: false, kind, message };
  }
}

// ── Phục hồi sau restart ──────────────────────────────────────────────────────
/** Đang 'processing' lúc tắt máy: có file thật → done (KHÔNG sinh lại); không có → pending. */
export async function recoverInterrupted(): Promise<void> {
  const rows = await listAllProcessing();
  for (const s of rows) {
    if (s.image_status === "processing") await updateShot(s.id, s.image_path && fs.existsSync(s.image_path) ? { image_status: "done" } : { image_status: "pending", retry_after: null });
    if (s.clip_status === "processing") await updateShot(s.id, s.clip_path && fs.existsSync(s.clip_path) ? { clip_status: "done" } : { clip_status: "pending", retry_after: null });
  }
  await updateProjectsProcessing();
}
const listAllProcessing = () => allQuery<Shot>("SELECT * FROM studio_shots WHERE image_status='processing' OR clip_status='processing'");
const updateProjectsProcessing = () => runQuery("UPDATE studio_projects SET assemble_status='pending' WHERE assemble_status='processing'");
```
- [ ]  **Step 4: Chạy test — PASS** (test đầu ~20–40s vì ffmpeg thật). Commit:

```bash
git add server/studio/pipeline.ts server/studio/pipeline.test.ts
git commit -m "feat(xuong): pipeline 5 chặng — máy trạng thái shot, cổng duyệt, ngân sách âm tiết, phục hồi không sinh lại"
```

---

### Task 11: Hàng đợi riêng của Xưởng — claim nguyên tử, ngân sách ngày, đĩa, tạm dừng khi billing

**Files:**
- Create: `server/studio/queue.ts`, `server/studio/queue.test.ts`

**Interfaces:**

-

Consumes: `runQueryChanges`, `todaySpendUsd`, `totalDiskBytes`, `getShot`, `getProject`, `runShotImage/Clip/Assemble`, `recoverInterrupted`, `STUDIO`.

-

Produces: `startStudioQueue(engines, {intervalMs?})`, `stopStudioQueue()`, `queueStatus()`, `pauseQueue(ms, reason)`.

-

[ ]  **Step 1: Test `server/studio/queue.test.ts`**

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { initStudioTables } from "./db.js";
import { createProject, addAsset, replaceShots, listShots, recordCost } from "./store.js";
import { ensureProjectDirs, STUDIO } from "./config.js";
import { fakeImageEngine } from "./engines/fake.js";
import { makeEngines, requestKeyframes } from "./pipeline.js";
import { startStudioQueue, stopStudioQueue, queueStatus } from "./queue.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function seed(n = 2) {
  const p = await createProject({ owner: "a@x", name: "Q", industry: "food", ratio: "9:16", clipLen: 4, tier: "draft", scriptSource: "manual" });
  const prod = path.join(ensureProjectDirs(p.id), "assets", "p.png");
  await fakeImageEngine().generate({ prompt: "", refs: [], aspectRatio: "9:16", size: "1K", outPath: prod });
  await addAsset(p.id, "product", prod, "image/png");
  await replaceShots(p.id, Array.from({ length: n }, (_, i) => ({ purpose: "product", camera: "medium", dialog: `cảnh ${i}`, image_prompt: "a", motion_prompt: "b", motion_level: "medium" as const })));
  return p;
}
before(async () => { await initStudioTables(); });
after(() => stopStudioQueue());

test("hàng đợi tự nhặt shot pending và chạy xong ảnh", { timeout: 60_000 }, async () => {
  const p = await seed(2);
  await requestKeyframes(p.id);
  startStudioQueue(makeEngines(""), { intervalMs: 200 });
  for (let i = 0; i < 100; i++) { const s = await listShots(p.id); if (s.every((x) => x.image_status === "done")) break; await sleep(300); }
  stopStudioQueue();
  const shots = await listShots(p.id);
  assert.ok(shots.every((s) => s.image_status === "done" && fs.existsSync(s.image_path!)));
});

test("vượt ngân sách ngày → không nhặt việc", { timeout: 20_000 }, async () => {
  const p = await seed(1);
  await requestKeyframes(p.id);
  const saved = STUDIO.dailyBudgetUsd;
  STUDIO.dailyBudgetUsd = 0.5;
  await recordCost({ projectId: p.id, kind: "image", model: "fake", usd: 1 });
  startStudioQueue(makeEngines(""), { intervalMs: 100 });
  await sleep(1500);
  stopStudioQueue();
  STUDIO.dailyBudgetUsd = saved;
  assert.equal((await listShots(p.id))[0].image_status, "pending");
  assert.ok(queueStatus().pausedUntil > Date.now());
});
```
- [ ]  **Step 2: Viết `server/studio/queue.ts`**

```ts
/**
 * server/studio/queue.ts — hàng đợi RIÊNG của Xưởng (không dùng chung queue.ts của mổ xẻ).
 * Cùng khuôn: poll 3s, claim bằng UPDATE … WHERE status='pending' (nguyên tử), giới hạn song song.
 * Khác: ngân sách ngày, trần đĩa, retry_after, tạm dừng cả hàng đợi khi lỗi billing.
 */
import fs from "node:fs";
import { STUDIO } from "./config.js";
import { getShot, getProject, runQueryChanges, todaySpendUsd, totalDiskBytes, type Shot, type Project } from "./store.js";
import { allQuery } from "../db.js";
import { runShotImage, runShotClip, runAssemble, recoverInterrupted } from "./pipeline.js";
import type { Engines } from "./engines/types.js";

let active = 0, ffActive = 0, claiming = false, pausedUntil = 0, pauseReason = "";
let timer: ReturnType<typeof setInterval> | null = null;

export const queueStatus = () => ({ active, ffActive, pausedUntil, pauseReason, concurrency: STUDIO.concurrency, ffmpegConcurrency: STUDIO.ffmpegConcurrency });
export function pauseQueue(ms: number, reason: string) { pausedUntil = Date.now() + ms; pauseReason = reason; console.warn(`[xuong] Tạm dừng hàng đợi ${Math.round(ms / 60000)} phút: ${reason}`); }
export function stopStudioQueue() { if (timer) clearInterval(timer); timer = null; }

async function guardsOk(): Promise<boolean> {
  if (Date.now() < pausedUntil) return false;
  const spend = await todaySpendUsd();
  if (STUDIO.dailyBudgetUsd > 0 && spend >= STUDIO.dailyBudgetUsd) { pauseQueue(10 * 60_000, `đã tiêu $${spend.toFixed(2)} ≥ trần ngày $${STUDIO.dailyBudgetUsd}`); return false; }
  const bytes = await totalDiskBytes();
  if (STUDIO.maxDiskGb > 0 && bytes >= STUDIO.maxDiskGb * 1e9) { pauseQueue(10 * 60_000, `đĩa Xưởng ${(bytes / 1e9).toFixed(1)}GB ≥ trần ${STUDIO.maxDiskGb}GB`); return false; }
  try { const st = fs.statfsSync(STUDIO.dataDir); if (st.bavail * st.bsize < 1e9) { pauseQueue(10 * 60_000, "ổ đĩa còn < 1GB"); return false; } } catch { /* thư mục chưa có → bỏ qua */ }
  return true;
}

const NOW = () => new Date().toISOString();

type Claimed = { shot: Shot; field: "image" | "clip" };
async function claimShot(field: "image" | "clip"): Promise<Claimed | null> {
  const extra = field === "clip" ? " AND approved = 1" : "";
  const row = await allQuery<Shot>(`SELECT * FROM studio_shots WHERE ${field}_status = 'pending'${extra} AND (retry_after IS NULL OR retry_after <= ?) ORDER BY updated ASC LIMIT 1`, [NOW()]);
  if (!row.length) return null;
  const n = await runQueryChanges(`UPDATE studio_shots SET ${field}_status = 'processing', updated = ? WHERE id = ? AND ${field}_status = 'pending'`, [NOW(), row[0].id]);
  if (n !== 1) return null;
  const shot = await getShot(row[0].id);
  return shot ? { shot, field } : null;
}
async function claimAssemble(): Promise<Project | null> {
  const row = await allQuery<Project>("SELECT * FROM studio_projects WHERE assemble_status = 'pending' ORDER BY updated ASC LIMIT 1");
  if (!row.length) return null;
  const n = await runQueryChanges("UPDATE studio_projects SET assemble_status = 'processing', updated = ? WHERE id = ? AND assemble_status = 'pending'", [NOW(), row[0].id]);
  return n === 1 ? (await getProject(row[0].id)) || null : null;
}

function track(p: Promise<{ ok: boolean; kind?: string }>, ff: boolean) {
  active++; if (ff) ffActive++;
  p.then((r) => { if (r?.kind === "billing") pauseQueue(30 * 60_000, "lỗi thanh toán/key"); })
   .catch((e) => console.error("[xuong] lỗi job:", e))
   .finally(() => { active--; if (ff) ffActive--; });
}

export function startStudioQueue(engines: Engines, opts: { intervalMs?: number } = {}) {
  stopStudioQueue();
  console.log(`[xuong] Hàng đợi Xưởng: ${STUDIO.concurrency} model song song, ${STUDIO.ffmpegConcurrency} ffmpeg, trần $${STUDIO.dailyBudgetUsd}/ngày.`);
  timer = setInterval(async () => {
    if (claiming) return;
    claiming = true;
    try {
      if (!(await guardsOk())) return;
      // Ghép trước (rẻ, giải phóng dự án chờ), rồi ảnh, rồi clip.
      while (ffActive < STUDIO.ffmpegConcurrency && active < STUDIO.concurrency) {
        const p = await claimAssemble(); if (!p) break; track(runAssemble(p, engines), true);
      }
      while (active < STUDIO.concurrency) {
        const c = (await claimShot("image")) || (await claimShot("clip"));
        if (!c) break;
        track(c.field === "image" ? runShotImage(c.shot, engines) : runShotClip(c.shot, engines), false);
      }
    } catch (e) { console.error("[xuong] vòng lặp hàng đợi:", e); }
    finally { claiming = false; }
  }, opts.intervalMs ?? 3000);
}

/** Gọi lúc khởi động server: phục hồi rồi chạy hàng đợi. */
export async function bootStudioQueue(engines: Engines) {
  await recoverInterrupted();
  startStudioQueue(engines);
}
```
- [ ]  **Step 3: Chạy test — PASS.** Commit:

```bash
git add server/studio/queue.ts server/studio/queue.test.ts
git commit -m "feat(xuong): hàng đợi riêng — claim nguyên tử, retry_after, trần ngân sách/đĩa, tạm dừng khi billing"
```

---

### Task 12: API `/api/studio/*` + mount vào server

**Files:**
- Create: `server/studio/routes.ts`, `server/studio/routes.test.ts`
- Modify: `server/index.ts` (import + `app.use` + khởi động; ~6 dòng)

**Interfaces:**
- Consumes: store, pipeline, script, pricing, config, `requireEditor`, `verifyToken`, `resolveKey` (copy nhỏ), multer.
- Produces: `studioRouter` (Express Router). Endpoint:

| Method | Path | Body/Query | Trả về |
| --- | --- | --- | --- |
| GET | `/api/studio/health` |  | `{ok, engines, voices[], queue, spendTodayUsd, diskBytes, budgetUsd}` |
| GET | `/api/studio/music` |  | `{ok, files: string[]}` |
| GET | `/api/studio/projects` |  | `{ok, projects[]}` |
| POST | `/api/studio/projects` | multipart `products[]`(≤10) `background`(≤1) + `name industry ratio clipLen tier scriptSource` | `{ok, project}` |
| GET | `/api/studio/projects/:id` |  | `{ok, project, shots[], assets[], render, maxSyllables}` — đường dẫn file đã đổi sang `*_rel` |
| DELETE | `/api/studio/projects/:id` |  | `{ok}` |
| PATCH | `/api/studio/projects/:id` | `{name? caption? hashtags? cover_idx? voice? voice_rate? music? transition?}` | `{ok}` |
| POST | `/api/studio/projects/:id/script` | `{source:'ai' | 'manual', shots?, notes?, apiKey?, model?, count?}` |
| PUT | `/api/studio/projects/:id/shots` | `{shots: ShotInput[]}` | `{ok, shots[]}` |
| POST | `/api/studio/projects/:id/keyframes` | `{shotIds?: string[]}` | `{ok, count}` |
| POST | `/api/studio/shots/:id/approve` | `{approved: 0 | 1}` |
| POST | `/api/studio/shots/:id/regenerate` | `{image_prompt?}` | `{ok}` |
| POST | `/api/studio/projects/:id/clips` | `{tier}` | `{ok, count}` / 400 `{ok:false,message}` |
| POST | `/api/studio/projects/:id/assemble` | `{voice, voiceRate, music, transition}` | `{ok}` / 400 |
| GET | `/api/studio/projects/:id/estimate?tier=` |  | `{ok, estimate, spentUsd}` |
| GET | `/api/studio/file/:projectId/*` | `?t=<jwt>` hoặc header Bearer | file tĩnh (owner/admin) |
- [ ]  **Step 1: Test `server/studio/routes.test.ts`**

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectDB } from "../db.js";
import { signToken } from "../auth.js";
import { initStudioTables } from "./db.js";
import { studioRouter } from "./routes.js";
import { fakeImageEngine } from "./engines/fake.js";

let base = ""; let server: any; let token = "";
before(async () => {
  process.env.ADMIN_INIT_PASSWORD = "x-test-x";
  await connectDB(); await initStudioTables();
  token = signToken({ email: "k@nerman.asia", role: "Quản trị" });
  const app = express(); app.use(express.json({ limit: "2mb" })); app.use("/api/studio", studioRouter);
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());
const H = () => ({ Authorization: `Bearer ${token}` });
const j = (r: Response) => r.json() as Promise<any>;

test("luồng API: tạo dự án (multipart) → nhập tay kịch bản → yêu cầu ảnh khoá → đọc lại → file token", { timeout: 30_000 }, async () => {
  const png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rt-")), "p.png");
  await fakeImageEngine().generate({ prompt: "", refs: [], aspectRatio: "9:16", size: "1K", outPath: png });
  const fd = new FormData();
  fd.append("name", "Gà rán"); fd.append("industry", "food"); fd.append("clipLen", "8"); fd.append("ratio", "9:16"); fd.append("tier", "draft"); fd.append("scriptSource", "manual");
  fd.append("products", new Blob([fs.readFileSync(png)], { type: "image/png" }), "p.png");
  const c = await j(await fetch(`${base}/api/studio/projects`, { method: "POST", headers: H(), body: fd }));
  assert.ok(c.ok, JSON.stringify(c)); const id = c.project.id;

  const s = await j(await fetch(`${base}/api/studio/projects/${id}/script`, { method: "POST", headers: { ...H(), "Content-Type": "application/json" }, body: JSON.stringify({ source: "manual", shots: [{ purpose: "hook", camera: "close", dialog: "Mở hộp", image_prompt: "a", motion_prompt: "b", motion_level: "low" }] }) }));
  assert.ok(s.ok, JSON.stringify(s)); assert.equal(s.shots.length, 1);

  const k = await j(await fetch(`${base}/api/studio/projects/${id}/keyframes`, { method: "POST", headers: { ...H(), "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(k.count, 1);
  const g = await j(await fetch(`${base}/api/studio/projects/${id}`, { headers: H() }));
  assert.equal(g.shots[0].image_status, "pending");
  assert.equal(g.assets[0].kind, "product");
  assert.ok(g.assets[0].rel.startsWith("assets/"));
  assert.equal(g.maxSyllables, 36); // 4.5 × 8 (engine fake)

  const f = await fetch(`${base}/api/studio/file/${id}/${g.assets[0].rel}?t=${token}`);
  assert.equal(f.status, 200);
  const bad = await fetch(`${base}/api/studio/file/${id}/../../etc/passwd?t=${token}`);
  assert.notEqual(bad.status, 200);
  const noauth = await fetch(`${base}/api/studio/file/${id}/${g.assets[0].rel}`);
  assert.equal(noauth.status, 401);
});

test("người khác không thấy dự án của tôi", async () => {
  const other = signToken({ email: "b@nerman.asia", role: "Biên tập" });
  const r = await fetch(`${base}/api/studio/projects`, { headers: { Authorization: `Bearer ${other}` } });
  // b@ chưa có trong bảng users → requireEditor trả 403; đủ để chứng minh không lộ dữ liệu.
  assert.ok([401, 403].includes(r.status));
});
```
- [ ]  **Step 2: Viết `server/studio/routes.ts`**

```ts
/**
 * server/studio/routes.ts — API Xưởng. Mỏng: kiểm tra đầu vào, quyền sở hữu, gọi pipeline/store.
 * Không gọi model, không chạy ffmpeg ở đây (trừ sinh kịch bản AI — một lượt Gemini nhanh, chấp nhận).
 */
import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { requireEditor, verifyToken } from "../auth.js";
import { STUDIO, ensureProjectDirs, projectDir, incomingDir, musicDir } from "./config.js";
import { createProject, getProject, listProjects, updateProject, deleteProject, addAsset, listAssets, replaceShots, listShots, getShot, updateShot, getRender, todaySpendUsd, totalDiskBytes, type Project } from "./store.js";
import { requestKeyframes, requestClips, requestAssemble, setApproved, syllablesPerSecFor, makeEngines } from "./pipeline.js";
import { generateScriptAI, validateScript } from "./script.js";
import { estimateProject } from "./pricing.js";
import { maxSyllablesFor, countSyllables } from "./text.js";
import { queueStatus } from "./queue.js";

export const studioRouter = Router();
const upload = multer({ dest: incomingDir(), limits: { fileSize: 20 * 1024 * 1024, files: 11 } });

const ownerEmail = (req: any) => String(req?.user?.email || "").toLowerCase().trim();
const isAdmin = (req: any) => req?.user?.role === "Quản trị";
function resolveKey(reqKey?: string): string | null {
  const k = (reqKey || "").trim(); if (k.length >= 10) return k;
  const env = (process.env.GEMINI_API_KEY || "").trim(); return env.length >= 10 ? env : null;
}
async function owned(req: Request, res: Response, id: string): Promise<Project | null> {
  const p = await getProject(id);
  if (!p || (!isAdmin(req) && p.owner !== ownerEmail(req))) { res.status(404).json({ ok: false, message: "Không tìm thấy dự án." }); return null; }
  return p;
}
const rel = (p: Project, abs: string | null) => (abs ? path.relative(projectDir(p.id), abs).split(path.sep).join("/") : null);
async function projectPayload(p: Project) {
  const shots = (await listShots(p.id)).map((s) => ({ ...s, image_rel: rel(p, s.image_path), clip_rel: rel(p, s.clip_path), syllables: countSyllables(s.dialog) }));
  const assets = (await listAssets(p.id)).map((a) => ({ ...a, rel: rel(p, a.path) }));
  const r = await getRender(p.id);
  const render = r ? { ...r, mp4_rel: rel(p, r.mp4_path), cover_rel: rel(p, r.cover_path), srt_rel: rel(p, r.srt_path) } : null;
  return { project: p, shots, assets, render, maxSyllables: maxSyllablesFor(syllablesPerSecFor(p), p.clip_len) };
}
const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

studioRouter.get("/health", requireEditor, async (_req, res) => {
  const engines = makeEngines(resolveKey() || "");
  res.json({ ok: true, engines: STUDIO.engines, voices: engines.voice.voices(), voiceDefault: STUDIO.voiceDefault, queue: queueStatus(), spendTodayUsd: await todaySpendUsd(), budgetUsd: STUDIO.dailyBudgetUsd, diskBytes: await totalDiskBytes(), maxDiskGb: STUDIO.maxDiskGb, models: { image: STUDIO.imageModel, draft: STUDIO.videoModelDraft, final: STUDIO.videoModelFinal } });
});
studioRouter.get("/music", requireEditor, (_req, res) => {
  const files = fs.readdirSync(musicDir()).filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f)).sort();
  res.json({ ok: true, files });
});

studioRouter.get("/projects", requireEditor, async (req, res) => {
  res.json({ ok: true, projects: await listProjects(isAdmin(req) ? null : ownerEmail(req)) });
});

studioRouter.post("/projects", requireEditor, upload.fields([{ name: "products", maxCount: 10 }, { name: "background", maxCount: 1 }]), async (req, res) => {
  try {
    const b = req.body || {};
    const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
    const products = files.products || [];
    if (!products.length) return res.status(400).json({ ok: false, message: "Cần ít nhất 1 ảnh sản phẩm." });
    const ratio = ["9:16", "16:9", "1:1"].includes(b.ratio) ? b.ratio : "9:16";
    const clipLen = [4, 6, 8].includes(Number(b.clipLen)) ? Number(b.clipLen) : 8;
    const p = await createProject({ owner: ownerEmail(req), name: String(b.name || "Dự án mới").slice(0, 120), industry: String(b.industry || "other"), ratio, clipLen, tier: b.tier === "final" ? "final" : "draft", scriptSource: String(b.scriptSource || "ai") });
    const root = ensureProjectDirs(p.id);
    const move = async (f: Express.Multer.File, kind: "product" | "background", i: number) => {
      const ext = (path.extname(f.originalname) || ".jpg").toLowerCase();
      const dest = path.join(root, "assets", `${kind}_${i}${ext}`);
      fs.renameSync(f.path, dest);
      await addAsset(p.id, kind, dest, f.mimetype || "image/jpeg");
    };
    for (let i = 0; i < products.length; i++) await move(products[i], "product", i);
    if (files.background?.[0]) await move(files.background[0], "background", 0);
    res.json({ ok: true, project: await getProject(p.id) });
  } catch (e: any) { console.error("[xuong] tạo dự án:", e); res.status(500).json({ ok: false, message: "Lỗi tạo dự án." }); }
});

studioRouter.get("/projects/:id", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  res.json({ ok: true, ...(await projectPayload(p)) });
});
studioRouter.delete("/projects/:id", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  await deleteProject(p.id);
  fs.rmSync(projectDir(p.id), { recursive: true, force: true });
  res.json({ ok: true });
});
studioRouter.patch("/projects/:id", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const b = req.body || {};
  await updateProject(p.id, { name: b.name, caption: b.caption, hashtags: Array.isArray(b.hashtags) ? b.hashtags.join(" ") : b.hashtags, cover_idx: b.cover_idx, voice: b.voice, voice_rate: b.voice_rate, music: b.music, transition: b.transition });
  res.json({ ok: true });
});

studioRouter.post("/projects/:id/script", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const b = req.body || {};
  const maxSyllables = maxSyllablesFor(syllablesPerSecFor(p), p.clip_len);
  try {
    if (b.source === "manual") {
      const v = validateScript({ shots: b.shots, caption: b.caption ?? p.caption, hashtags: b.hashtags ?? String(p.hashtags || "").split(/\s+/).filter(Boolean) }, { maxSyllables });
      if (!v.ok) return res.status(400).json({ ok: false, message: v.errors.join(" ") });
      const shots = await replaceShots(p.id, v.script.shots);
      await updateProject(p.id, { script_source: "manual", caption: v.script.caption, hashtags: v.script.hashtags.join(" "), cover_idx: v.script.cover_idx, stage: "script" });
      return res.json({ ok: true, shots, caption: v.script.caption, hashtags: v.script.hashtags });
    }
    const apiKey = resolveKey(b.apiKey);
    if (!apiKey) return res.status(400).json({ ok: false, message: "Chưa có API key Gemini." });
    const assets = await listAssets(p.id);
    const refs = [...assets.filter((a) => a.kind === "product"), ...assets.filter((a) => a.kind === "background")].map((a) => ({ path: a.path, mimeType: a.mime }));
    const script = await generateScriptAI({ apiKey, model: String(b.model || STUDIO.scriptModel), refs, productName: p.name, industry: p.industry, shots: Math.min(8, Math.max(1, num(b.count, 4))), clipLen: p.clip_len, maxSyllables, hasBackground: assets.some((a) => a.kind === "background"), notes: b.notes ? String(b.notes).slice(0, 2000) : undefined });
    const shots = await replaceShots(p.id, script.shots);
    await updateProject(p.id, { script_source: "ai", caption: script.caption, hashtags: script.hashtags.join(" "), cover_idx: script.cover_idx, stage: "script" });
    res.json({ ok: true, shots, caption: script.caption, hashtags: script.hashtags });
  } catch (e: any) { res.status(502).json({ ok: false, message: e?.message || "Lỗi sinh kịch bản." }); }
});

studioRouter.put("/projects/:id/shots", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const maxSyllables = maxSyllablesFor(syllablesPerSecFor(p), p.clip_len);
  const v = validateScript({ shots: req.body?.shots, caption: p.caption, hashtags: [] }, { maxSyllables });
  if (!v.ok) return res.status(400).json({ ok: false, message: v.errors.join(" ") });
  res.json({ ok: true, shots: await replaceShots(p.id, v.script.shots) });
});

studioRouter.post("/projects/:id/keyframes", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const ids = Array.isArray(req.body?.shotIds) ? req.body.shotIds.map(String) : undefined;
  res.json({ ok: true, count: await requestKeyframes(p.id, ids) });
});
studioRouter.post("/shots/:id/approve", requireEditor, async (req, res) => {
  const s = await getShot(req.params.id); if (!s) return res.status(404).json({ ok: false });
  const p = await owned(req, res, s.project_id); if (!p) return;
  await setApproved(s.id, req.body?.approved ? 1 : 0);
  res.json({ ok: true });
});
studioRouter.post("/shots/:id/regenerate", requireEditor, async (req, res) => {
  const s = await getShot(req.params.id); if (!s) return res.status(404).json({ ok: false });
  const p = await owned(req, res, s.project_id); if (!p) return;
  if (typeof req.body?.image_prompt === "string") await updateShot(s.id, { image_prompt: req.body.image_prompt.slice(0, 2000) });
  await requestKeyframes(p.id, [s.id]);
  res.json({ ok: true });
});
studioRouter.post("/projects/:id/clips", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const r = await requestClips(p.id, req.body?.tier === "final" ? "final" : "draft");
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});
studioRouter.post("/projects/:id/assemble", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const b = req.body || {};
  const r = await requestAssemble(p.id, { voice: b.voice, voiceRate: num(b.voiceRate, 1), music: b.music || null, transition: b.transition });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});
studioRouter.get("/projects/:id/estimate", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const shots = await listShots(p.id);
  const approved = shots.filter((s) => s.approved === 1);
  const tier = req.query.tier === "final" ? "final" : "draft";
  const est = estimateProject({ shots: (approved.length || shots.length) || 1, clipLen: p.clip_len, videoModel: STUDIO.engines.video === "fake" ? "fake" : tier === "final" ? STUDIO.videoModelFinal : STUDIO.videoModelDraft, imageModel: STUDIO.engines.image === "fake" ? "fake" : STUDIO.imageModel, voiceEngine: STUDIO.engines.voice, dialogChars: shots.reduce((a, s) => a + s.dialog.length, 0) });
  res.json({ ok: true, estimate: est, spentUsd: p.cost_usd });
});

// File tĩnh: <img>/<video> không gửi header → chấp nhận ?t=<jwt>. Chặn thoát thư mục.
studioRouter.get("/file/:projectId/*", async (req, res) => {
  const tok = String(req.query.t || "") || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = tok ? verifyToken(tok) : null;
  if (!user) return res.status(401).end();
  const p = await getProject(req.params.projectId);
  if (!p || (user.role !== "Quản trị" && p.owner !== user.email.toLowerCase().trim())) return res.status(404).end();
  const root = path.resolve(projectDir(p.id));
  const target = path.resolve(root, String((req.params as any)[0] || ""));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) return res.status(404).end();
  res.sendFile(target);
});
```
- [ ]  **Step 3: Sửa `server/index.ts`** — thêm import cạnh các import khác và mount:

```ts
import { studioRouter } from "./studio/routes.js";
import { initStudioTables } from "./studio/db.js";
import { bootStudioQueue } from "./studio/queue.js";
import { makeEngines as makeStudioEngines } from "./studio/pipeline.js";
```

Sau dòng `app.use(express.json({ limit: "16mb" }));` thêm:

```ts
app.use("/api/studio", studioRouter); // Xưởng — sản xuất video affiliate
```

Trong `startServer()` sau `await connectDB();` thêm:

```ts
  await initStudioTables();
  bootStudioQueue(makeStudioEngines((process.env.GEMINI_API_KEY || "").trim())).catch((e) => console.error("[xuong] khởi động hàng đợi:", e));
```
- [ ]  **Step 4: Chạy test — PASS.** Chạy `npm run dev:api` và `curl -s localhost:8787/api/studio/health` (không token) → 401. Commit:

```bash
git add server/studio/routes.ts server/studio/routes.test.ts server/index.ts
git commit -m "feat(xuong): API /api/studio — dự án, kịch bản, ảnh khoá, duyệt, clip, ghép, file token; mount + hàng đợi"
```

---

### Task 13: Frontend — API client, nhãn tiếng Việt, màn Xưởng (danh sách + dự án mới), nối vào App

**Files:**
- Create: `src/studio/studioApi.ts`, `src/studio/studioLabels.ts`, `src/studio/StudioView.tsx`, `src/studio/NewProjectForm.tsx`
- Modify: `src/types.ts:115` (thêm `"studio"` vào `Screen`)
- Modify: `src/App.tsx` — 4 chỗ: import; `navDef` (dòng ~423) thêm mục; `titles` (dòng ~431) thêm; gating (dòng ~774) thêm `"studio"`; render (dòng ~862) thêm `<StudioView/>`

**Interfaces:**
- Produces: mọi hàm trong `studioApi.ts` (bảng dưới), `LABELS` trong `studioLabels.ts`, `<StudioView isMobile integration showToast isAdmin/>`.

Không có test runner React trong repo → xác minh bằng `npm run build` (tsc + vite) và chạy tay.
- [ ]  **Step 1: Sửa `src/types.ts` dòng 115**

```ts
export type Screen = "dashboard" | "upload" | "report" | "history" | "admin" | "analyzing" | "error" | "auth" | "ads" | "campaign" | "studio";
```
- [ ]  **Step 2: Viết `src/studio/studioApi.ts`**

```ts
/** src/studio/studioApi.ts — client cho /api/studio. Đường dẫn file: dùng studioFileUrl (token trên query vì <img>/<video> không gửi header). */
import { authHeaders } from "../lib/api";

const jh = () => ({ ...authHeaders(), "Content-Type": "application/json" });
const parse = (r: Response) => r.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ từ server." }));

export const getStudioHealth = () => fetch("/api/studio/health", { headers: authHeaders() }).then(parse);
export const listStudioMusic = () => fetch("/api/studio/music", { headers: authHeaders() }).then(parse);
export const listStudioProjects = () => fetch("/api/studio/projects", { headers: authHeaders() }).then(parse);
export const createStudioProject = (fd: FormData) => fetch("/api/studio/projects", { method: "POST", headers: authHeaders(), body: fd }).then(parse);
export const getStudioProject = (id: string) => fetch(`/api/studio/projects/${id}`, { headers: authHeaders() }).then(parse);
export const deleteStudioProject = (id: string) => fetch(`/api/studio/projects/${id}`, { method: "DELETE", headers: authHeaders() }).then(parse);
export const patchStudioProject = (id: string, body: any) => fetch(`/api/studio/projects/${id}`, { method: "PATCH", headers: jh(), body: JSON.stringify(body) }).then(parse);
export const genStudioScript = (id: string, body: { source: "ai" | "manual"; shots?: any[]; notes?: string; count?: number; apiKey?: string; model?: string; caption?: string; hashtags?: string[] }) =>
  fetch(`/api/studio/projects/${id}/script`, { method: "POST", headers: jh(), body: JSON.stringify(body) }).then(parse);
export const saveStudioShots = (id: string, shots: any[]) => fetch(`/api/studio/projects/${id}/shots`, { method: "PUT", headers: jh(), body: JSON.stringify({ shots }) }).then(parse);
export const requestStudioKeyframes = (id: string, shotIds?: string[]) => fetch(`/api/studio/projects/${id}/keyframes`, { method: "POST", headers: jh(), body: JSON.stringify({ shotIds }) }).then(parse);
export const approveStudioShot = (shotId: string, approved: 0 | 1) => fetch(`/api/studio/shots/${shotId}/approve`, { method: "POST", headers: jh(), body: JSON.stringify({ approved }) }).then(parse);
export const regenerateStudioShot = (shotId: string, image_prompt?: string) => fetch(`/api/studio/shots/${shotId}/regenerate`, { method: "POST", headers: jh(), body: JSON.stringify({ image_prompt }) }).then(parse);
export const requestStudioClips = (id: string, tier: "draft" | "final") => fetch(`/api/studio/projects/${id}/clips`, { method: "POST", headers: jh(), body: JSON.stringify({ tier }) }).then(parse);
export const requestStudioAssemble = (id: string, body: { voice: string; voiceRate: number; music: string | null; transition: string }) => fetch(`/api/studio/projects/${id}/assemble`, { method: "POST", headers: jh(), body: JSON.stringify(body) }).then(parse);
export const getStudioEstimate = (id: string, tier: "draft" | "final") => fetch(`/api/studio/projects/${id}/estimate?tier=${tier}`, { headers: authHeaders() }).then(parse);

export function studioFileUrl(projectId: string, rel: string | null | undefined): string {
  if (!rel) return "";
  let t = ""; try { t = localStorage.getItem("nonelab_token") || ""; } catch {}
  return `/api/studio/file/${projectId}/${rel}?t=${encodeURIComponent(t)}`;
}

/** Giữ đồng bộ với server/studio/text.ts. */
export const countSyllables = (text: string) => String(text || "").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
```
- [ ]  **Step 3: Viết `src/studio/studioLabels.ts`**

```ts
/** src/studio/studioLabels.ts — bảng tra enum tiếng Anh (DB) → nhãn tiếng Việt (UI). Nơi DUY NHẤT dịch. */
export const PURPOSE_LABEL: Record<string, string> = { hook: "Hook", packaging: "Bao bì", product: "Sản phẩm", label: "Nhãn", interaction: "Tương tác", cta: "Kêu gọi mua" };
export const CAMERA_LABEL: Record<string, string> = { wide: "Góc xa", medium: "Góc trung", close: "Góc cận" };
export const MOTION_LABEL: Record<string, string> = { low: "Biên độ thấp", medium: "Vừa", high: "Mạnh" };
export const STAGE_LABEL: Record<string, string> = { script: "Kịch bản", keyframe: "Đang dựng ảnh", review: "Chờ duyệt ảnh", clip: "Đang render clip", assemble: "Đang ghép", done: "Hoàn tất", failed: "Lỗi" };
export const STATUS_LABEL: Record<string, string> = { idle: "—", pending: "Chờ", processing: "Đang chạy", done: "Xong", failed: "Lỗi" };
export const TRANSITION_LABEL: Record<string, string> = { none: "Cắt thẳng", fade: "Fade", dissolve: "Dissolve", wipeleft: "Wipe trái", slideleft: "Slide trái", zoomin: "Zoom" };
export const INDUSTRIES = [["food", "Đồ ăn vặt / F&B"], ["beauty", "Mỹ phẩm"], ["home", "Gia dụng"], ["fashion", "Thời trang"], ["mom_baby", "Mẹ & bé"], ["other", "Khác"]] as const;
export const TIER_LABEL: Record<string, string> = { draft: "Nháp (rẻ)", final: "Chốt (đẹp)" };
export const vnd = (usd: number) => `${Math.round((usd * 26000) / 1000) * 1000}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " đ";
```
- [ ]  **Step 4: Viết `src/studio/NewProjectForm.tsx`**

```tsx
import { useState } from "react";
import { css } from "../lib/csx";
import { INDUSTRIES } from "./studioLabels";
import { createStudioProject } from "./studioApi";

const inp = css("width:100%;padding:10px 12px;border:1px solid #e6dcc8;border-radius:10px;background:#fff;font-size:14px;color:#2a2016");
const lab = css("font-size:12px;font-weight:600;color:#8a7c67;letter-spacing:.04em;text-transform:uppercase;margin:14px 0 6px;display:block");
const btn = css("padding:12px 18px;border-radius:12px;border:0;background:#b06a16;color:#fff;font-weight:700;cursor:pointer;font-size:14px");

export function NewProjectForm({ onCreated, onCancel, showToast }: { onCreated: (id: string) => void; onCancel: () => void; showToast: (m: string) => void }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("food");
  const [clipLen, setClipLen] = useState(8);
  const [tier, setTier] = useState<"draft" | "final">("draft");
  const [products, setProducts] = useState<File[]>([]);
  const [background, setBackground] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return showToast("Nhập tên sản phẩm.");
    if (!products.length) return showToast("Chọn ít nhất 1 ảnh sản phẩm.");
    setBusy(true);
    const fd = new FormData();
    fd.append("name", name.trim()); fd.append("industry", industry); fd.append("clipLen", String(clipLen)); fd.append("ratio", "9:16"); fd.append("tier", tier); fd.append("scriptSource", "ai");
    products.slice(0, 10).forEach((f) => fd.append("products", f, f.name));
    if (background) fd.append("background", background, background.name);
    const r = await createStudioProject(fd);
    setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không tạo được dự án.");
    onCreated(r.project.id);
  };

  return (
    <div style={css("max-width:720px;background:#fff;border:1px solid #efe6d4;border-radius:16px;padding:22px")}>
      <div style={css("font-family:Fraunces,serif;font-size:22px;font-weight:600;color:#2a2016")}>Dự án mới</div>
      <div style={css("color:#8a7c67;font-size:13px;margin-top:4px")}>Ảnh sản phẩm + ảnh bối cảnh → kịch bản → ảnh khoá → duyệt → clip → mp4 đăng được ngay.</div>
      <label style={lab}>Tên sản phẩm</label>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Mẹt đốt chua xua tẩm ớt" />
      <label style={lab}>Ngành hàng</label>
      <select style={inp} value={industry} onChange={(e) => setIndustry(e.target.value)}>{INDUSTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <div style={css("display:flex;gap:16px")}>
        <div style={css("flex:1")}><label style={lab}>Thời lượng mỗi cảnh</label>
          <div style={css("display:flex;gap:8px")}>{[4, 6, 8].map((n) => <button key={n} onClick={() => setClipLen(n)} style={css(`flex:1;padding:10px;border-radius:10px;border:1px solid ${clipLen === n ? "#b06a16" : "#e6dcc8"};background:${clipLen === n ? "#fff3e0" : "#fff"};cursor:pointer;font-weight:600;color:#2a2016`)}>{n}s</button>)}</div></div>
        <div style={css("flex:1")}><label style={lab}>Hạng render</label>
          <div style={css("display:flex;gap:8px")}>{(["draft", "final"] as const).map((t) => <button key={t} onClick={() => setTier(t)} style={css(`flex:1;padding:10px;border-radius:10px;border:1px solid ${tier === t ? "#b06a16" : "#e6dcc8"};background:${tier === t ? "#fff3e0" : "#fff"};cursor:pointer;font-weight:600;color:#2a2016`)}>{t === "draft" ? "Nháp (rẻ)" : "Chốt (đẹp)"}</button>)}</div></div>
      </div>
      <label style={lab}>Ảnh sản phẩm (1–10, mặt trước, đủ sáng)</label>
      <input type="file" accept="image/*" multiple onChange={(e) => setProducts(Array.from(e.target.files || []))} />
      <div style={css("display:flex;gap:6px;flex-wrap:wrap;margin-top:8px")}>{products.map((f, i) => <img key={i} src={URL.createObjectURL(f)} style={css("width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #efe6d4")} />)}</div>
      <label style={lab}>Ảnh bối cảnh (1, tuỳ chọn)</label>
      <input type="file" accept="image/*" onChange={(e) => setBackground(e.target.files?.[0] || null)} />
      {background && <img src={URL.createObjectURL(background)} style={css("width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #efe6d4;margin-top:8px;display:block")} />}
      <div style={css("display:flex;gap:10px;margin-top:22px")}>
        <button style={btn} disabled={busy} onClick={submit}>{busy ? "Đang tạo…" : "Tạo dự án → dựng kịch bản"}</button>
        <button style={css("padding:12px 18px;border-radius:12px;border:1px solid #e6dcc8;background:#fff;cursor:pointer;color:#574a3a")} onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}
```
- [ ]  **Step 5: Viết `src/studio/StudioView.tsx`** (khung + danh sách + điều phối 3 bước; `ScriptSheet`/`ReviewGrid`/`RenderPanel` viết ở Task 14–15 — tạm import và tạo file stub trả `null` để build qua)

```tsx
import { useEffect, useRef, useState } from "react";
import { css } from "../lib/csx";
import { listStudioProjects, getStudioProject, deleteStudioProject, getStudioHealth } from "./studioApi";
import { STAGE_LABEL, vnd } from "./studioLabels";
import { NewProjectForm } from "./NewProjectForm";
import { ScriptSheet } from "./ScriptSheet";
import { ReviewGrid } from "./ReviewGrid";
import { RenderPanel } from "./RenderPanel";

export interface StudioBundle { project: any; shots: any[]; assets: any[]; render: any | null; maxSyllables: number }
const BUSY = new Set(["keyframe", "clip", "assemble"]);

export function StudioView({ isMobile, integration, showToast, isAdmin }: { isMobile: boolean; integration: { key: string; model: string }; showToast: (m: string) => void; isAdmin?: boolean }) {
  const [mode, setMode] = useState<"list" | "new" | "project">("list");
  const [projects, setProjects] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [bundle, setBundle] = useState<StudioBundle | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reloadList = async () => { const r = await listStudioProjects(); if (r?.ok) setProjects(r.projects); };
  const load = async (id: string) => { const r = await getStudioProject(id); if (r?.ok) setBundle(r); else showToast(r?.message || "Không tải được dự án."); return r; };
  useEffect(() => { reloadList(); getStudioHealth().then((h) => h?.ok && setHealth(h)); }, []);

  // Poll khi có việc chạy nền (ảnh/clip/ghép) hoặc còn shot pending/processing.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (mode !== "project" || !bundle) return;
    const busy = BUSY.has(bundle.project.stage) || bundle.shots.some((s) => ["pending", "processing"].includes(s.image_status) || ["pending", "processing"].includes(s.clip_status)) || bundle.project.assemble_status === "pending" || bundle.project.assemble_status === "processing";
    if (!busy) return;
    timer.current = setInterval(() => load(bundle.project.id), 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [mode, bundle?.project?.id, bundle?.project?.stage, bundle?.project?.assemble_status, JSON.stringify(bundle?.shots?.map((s) => [s.image_status, s.clip_status]))]);

  const open = async (id: string) => { await load(id); setMode("project"); };

  if (mode === "new") return <NewProjectForm showToast={showToast} onCancel={() => setMode("list")} onCreated={(id) => { reloadList(); open(id); }} />;

  if (mode === "project" && bundle) {
    const p = bundle.project;
    return (
      <div>
        <div style={css("display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap")}>
          <button onClick={() => { setMode("list"); reloadList(); }} style={css("border:1px solid #e6dcc8;background:#fff;border-radius:10px;padding:8px 12px;cursor:pointer;color:#574a3a")}>← Danh sách</button>
          <div style={css("font-family:Fraunces,serif;font-size:20px;font-weight:600;color:#2a2016")}>{p.name}</div>
          <span style={css("font-size:12px;padding:4px 10px;border-radius:999px;background:#fff3e0;color:#9a5a12;font-weight:600")}>{STAGE_LABEL[p.stage] || p.stage}</span>
          <span style={css("font-size:12px;color:#8a7c67")}>Đã tiêu ${Number(p.cost_usd || 0).toFixed(3)} ≈ {vnd(p.cost_usd || 0)}</span>
          {p.message && <span style={css("font-size:12px;color:#9e3a3a")}>{p.message}</span>}
        </div>
        <ScriptSheet bundle={bundle} integration={integration} showToast={showToast} reload={() => load(p.id)} />
        <ReviewGrid bundle={bundle} showToast={showToast} reload={() => load(p.id)} />
        <RenderPanel bundle={bundle} health={health} showToast={showToast} reload={() => load(p.id)} />
      </div>
    );
  }

  return (
    <div>
      <div style={css("display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px")}>
        <div style={css("color:#8a7c67;font-size:13px")}>
          {health ? <>Engine: ảnh <b>{health.engines.image}</b> · video <b>{health.engines.video}</b> · giọng <b>{health.engines.voice}</b> · hôm nay ${Number(health.spendTodayUsd).toFixed(2)}/{health.budgetUsd} · đĩa {(health.diskBytes / 1e9).toFixed(1)}GB{health.queue?.pausedUntil > Date.now() ? <span style={css("color:#9e3a3a")}> · HÀNG ĐỢI TẠM DỪNG: {health.queue.pauseReason}</span> : null}</> : "…"}
        </div>
        <button onClick={() => setMode("new")} style={css("padding:10px 16px;border-radius:12px;border:0;background:#b06a16;color:#fff;font-weight:700;cursor:pointer")}>+ Dự án mới</button>
      </div>
      {projects.length === 0 && <div style={css("color:#8a7c67;padding:30px;text-align:center;border:1px dashed #e6dcc8;border-radius:16px")}>Chưa có dự án. Bấm “+ Dự án mới”, cho ảnh sản phẩm vào là xong.</div>}
      <div style={css(`display:grid;grid-template-columns:repeat(${isMobile ? 1 : 3},1fr);gap:12px`)}>
        {projects.map((p) => (
          <div key={p.id} style={css("background:#fff;border:1px solid #efe6d4;border-radius:14px;padding:14px;cursor:pointer")} onClick={() => open(p.id)}>
            <div style={css("font-weight:700;color:#2a2016")}>{p.name}</div>
            <div style={css("font-size:12px;color:#8a7c67;margin-top:4px")}>{STAGE_LABEL[p.stage] || p.stage} · {p.clip_len}s/cảnh · {p.tier === "final" ? "Chốt" : "Nháp"} · ${Number(p.cost_usd || 0).toFixed(2)}</div>
            <div style={css("font-size:11px;color:#b3a48c;margin-top:6px")}>{new Date(p.created).toLocaleString("vi-VN")}{isAdmin ? ` · ${p.owner}` : ""}</div>
            <button onClick={async (e) => { e.stopPropagation(); if (confirm("Xoá dự án và toàn bộ file?")) { await deleteStudioProject(p.id); reloadList(); } }} style={css("margin-top:8px;font-size:11px;border:0;background:transparent;color:#9e3a3a;cursor:pointer;padding:0")}>Xoá</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Tạo tạm 3 stub để build qua (Task 14–15 thay thế):

```tsx
// src/studio/ScriptSheet.tsx
export function ScriptSheet(_: any) { return null; }
// src/studio/ReviewGrid.tsx
export function ReviewGrid(_: any) { return null; }
// src/studio/RenderPanel.tsx
export function RenderPanel(_: any) { return null; }
```
- [ ]  **Step 6: Nối vào `src/App.tsx`** (4 chỗ)

Import (cạnh các import khác, đầu file):

```ts
import { StudioView } from "./studio/StudioView";
```

`navDef` — chèn sau mục `campaign`:

```ts
    { key: "studio", label: "Xưởng", sub: "Ảnh sản phẩm → clip review affiliate có giọng, phụ đề, nhạc" },
```

`titles` — thêm:

```ts
    studio: ["Xưởng", "Sản xuất video affiliate từ ảnh sản phẩm"],
```

Gating (dòng có `it.key === "ads" || it.key === "campaign"`) — đổi thành:

```ts
              if ((it.key === "ads" || it.key === "campaign" || it.key === "studio") && !(user?.role === "Quản trị" || user?.role === "Biên tập")) return null;
```

Render — ngay sau dòng `{screen === "campaign" && <CampaignView .../>}`:

```tsx
            {screen === "studio" && <StudioView isMobile={isMobile} integration={integration} showToast={showToast} isAdmin={user?.role === "Quản trị"} />}
```
- [ ]  **Step 7: Build và chạy tay**

Run: `npm run build` → Expected: không lỗi TypeScript. Run: `npm run dev`, đăng nhập admin, thấy mục **Xưởng** trong menu, tạo dự án với 1 ảnh → chuyển sang màn dự án (3 section stub trống, header có tên + stage “Kịch bản”).
- [ ]  **Step 8: Commit**

```bash
git add src/types.ts src/App.tsx src/studio/
git commit -m "feat(xuong): frontend — API client, nhãn, màn Xưởng (danh sách/dự án mới), nối menu"
```

---

### Task 14: Frontend — Phiếu kịch bản với bộ đếm âm tiết

**Files:**

-

Replace: `src/studio/ScriptSheet.tsx`

-

[ ]  **Step 1: Viết `src/studio/ScriptSheet.tsx`**

```tsx
import { useEffect, useState } from "react";
import { css } from "../lib/csx";
import type { StudioBundle } from "./StudioView";
import { genStudioScript, saveStudioShots, requestStudioKeyframes, patchStudioProject, countSyllables } from "./studioApi";
import { PURPOSE_LABEL, CAMERA_LABEL, MOTION_LABEL } from "./studioLabels";

const card = css("background:#fff;border:1px solid #efe6d4;border-radius:16px;padding:18px;margin-bottom:16px");
const h = css("font-family:Fraunces,serif;font-size:18px;font-weight:600;color:#2a2016;margin-bottom:4px");
const inp = css("width:100%;padding:8px 10px;border:1px solid #e6dcc8;border-radius:8px;font-size:13px;color:#2a2016;background:#fff");
const sel = css("padding:6px 8px;border:1px solid #e6dcc8;border-radius:8px;font-size:12px;background:#fff;color:#2a2016");
const btnP = css("padding:10px 16px;border-radius:10px;border:0;background:#b06a16;color:#fff;font-weight:700;cursor:pointer");
const btnS = css("padding:10px 16px;border-radius:10px;border:1px solid #e6dcc8;background:#fff;color:#574a3a;cursor:pointer");
const empty = () => ({ purpose: "product", camera: "medium", dialog: "", image_prompt: "", motion_prompt: "", motion_level: "medium" });

export function ScriptSheet({ bundle, integration, showToast, reload }: { bundle: StudioBundle; integration: { key: string; model: string }; showToast: (m: string) => void; reload: () => Promise<any> }) {
  const { project: p, maxSyllables } = bundle;
  const [shots, setShots] = useState<any[]>(bundle.shots.length ? bundle.shots : [empty()]);
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState("");
  const [caption, setCaption] = useState(p.caption || "");
  const [hashtags, setHashtags] = useState(p.hashtags || "");
  const locked = ["clip", "assemble", "done"].includes(p.stage) || bundle.shots.some((s) => s.clip_status === "done");
  useEffect(() => { if (bundle.shots.length) setShots(bundle.shots); setCaption(p.caption || ""); setHashtags(p.hashtags || ""); }, [bundle.project.updated, bundle.shots.length]);

  const over = shots.map((s) => countSyllables(s.dialog) > maxSyllables);
  const upd = (i: number, k: string, v: any) => setShots((arr) => arr.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  const genAI = async () => {
    setBusy("ai");
    const r = await genStudioScript(p.id, { source: "ai", notes, count, apiKey: integration.key || undefined, model: integration.model || undefined });
    setBusy("");
    if (!r?.ok) return showToast(r?.message || "AI không viết được kịch bản.");
    setShots(r.shots); setCaption(r.caption || ""); setHashtags((r.hashtags || []).join(" ")); showToast("Đã có kịch bản — sửa tay rồi bấm Dựng ảnh khoá."); reload();
  };
  const save = async () => {
    if (over.some(Boolean)) return showToast(`Có cảnh vượt ${maxSyllables} âm tiết — rút gọn thoại trước.`);
    setBusy("save");
    const r = await saveStudioShots(p.id, shots.map((s) => ({ purpose: s.purpose, camera: s.camera, dialog: s.dialog, image_prompt: s.image_prompt, motion_prompt: s.motion_prompt, motion_level: s.motion_level })));
    await patchStudioProject(p.id, { caption, hashtags });
    setBusy("");
    if (!r?.ok) return showToast(r?.message || "Không lưu được.");
    await reload(); return true;
  };
  const keyframes = async () => {
    if (!(await save())) return;
    setBusy("kf");
    const r = await requestStudioKeyframes(p.id);
    setBusy("");
    if (!r?.ok) return showToast(r?.message || "Không xếp hàng được.");
    showToast(`Đang dựng ${r.count} ảnh khoá — theo dõi ở mục Chốt duyệt.`); reload();
  };

  return (
    <div style={card}>
      <div style={h}>1 · Phiếu kịch bản</div>
      <div style={css("font-size:12px;color:#8a7c67;margin-bottom:12px")}>Mỗi cảnh = 1 clip {p.clip_len}s. Thoại tối đa <b>{maxSyllables} âm tiết</b>/cảnh (nhịp giọng × thời lượng). Sửa tay được mọi ô.</div>
      {!locked && (
        <div style={css("display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px")}>
          <input style={css("flex:1;min-width:220px;padding:8px 10px;border:1px solid #e6dcc8;border-radius:8px;font-size:13px")} placeholder="Ghi chú cho AI (điểm bán, đối tượng, giọng điệu…)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <select style={sel} value={count} onChange={(e) => setCount(Number(e.target.value))}>{[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} cảnh</option>)}</select>
          <button style={btnP} disabled={!!busy} onClick={genAI}>{busy === "ai" ? "AI đang viết…" : "AI viết kịch bản từ ảnh"}</button>
          <button style={btnS} onClick={() => setShots((a) => [...a, empty()])}>+ Thêm cảnh</button>
        </div>
      )}
      <div style={css("display:grid;gap:10px")}>
        {shots.map((s, i) => (
          <div key={s.id || i} style={css(`border:1px solid ${over[i] ? "#e08a8a" : "#efe6d4"};border-radius:12px;padding:12px;background:${over[i] ? "#fff5f5" : "#fffdf8"}`)}>
            <div style={css("display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px")}>
              <b style={css("color:#2a2016")}>Cảnh {i + 1}</b>
              <select disabled={locked} style={sel} value={s.purpose} onChange={(e) => upd(i, "purpose", e.target.value)}>{Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select disabled={locked} style={sel} value={s.camera} onChange={(e) => upd(i, "camera", e.target.value)}>{Object.entries(CAMERA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select disabled={locked} style={sel} value={s.motion_level} onChange={(e) => upd(i, "motion_level", e.target.value)}>{Object.entries(MOTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <span style={css(`margin-left:auto;font-size:12px;font-weight:700;color:${over[i] ? "#c0392b" : "#3c7a5e"}`)}>{countSyllables(s.dialog)}/{maxSyllables} âm tiết</span>
              {!locked && shots.length > 1 && <button onClick={() => setShots((a) => a.filter((_, j) => j !== i))} style={css("border:0;background:transparent;color:#9e3a3a;cursor:pointer;font-size:12px")}>Xoá</button>}
            </div>
            <textarea disabled={locked} style={{ ...inp, minHeight: 44 }} placeholder="Lời đọc tiếng Việt…" value={s.dialog} onChange={(e) => upd(i, "dialog", e.target.value)} />
            <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px")}>
              <textarea disabled={locked} style={{ ...inp, minHeight: 56, fontSize: 12 }} placeholder="Image prompt (English) — khung hình tĩnh" value={s.image_prompt} onChange={(e) => upd(i, "image_prompt", e.target.value)} />
              <textarea disabled={locked} style={{ ...inp, minHeight: 56, fontSize: 12 }} placeholder="Motion prompt (English) — chuyển động từ khung đó" value={s.motion_prompt} onChange={(e) => upd(i, "motion_prompt", e.target.value)} />
            </div>
          </div>
        ))}
      </div>
      <div style={css("display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:12px")}>
        <input style={inp} placeholder="Caption đăng bài" value={caption} onChange={(e) => setCaption(e.target.value)} />
        <input style={inp} placeholder="#hashtag #cách #nhau" value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
      </div>
      {!locked && (
        <div style={css("display:flex;gap:8px;margin-top:14px")}>
          <button style={btnS} disabled={!!busy} onClick={save}>{busy === "save" ? "Đang lưu…" : "Lưu kịch bản"}</button>
          <button style={btnP} disabled={!!busy || shots.some((s) => !s.image_prompt.trim())} onClick={keyframes}>{busy === "kf" ? "Đang xếp hàng…" : `Dựng ${shots.length} ảnh khoá →`}</button>
        </div>
      )}
      {locked && <div style={css("font-size:12px;color:#8a7c67;margin-top:10px")}>Kịch bản đã khoá vì đã có clip. Muốn sửa: sinh lại ảnh khoá của cảnh đó ở mục Chốt duyệt.</div>}
    </div>
  );
}
```
- [ ]  **Step 2: Build + chạy tay**: `npm run build` sạch; tạo dự án → bấm “AI viết kịch bản từ ảnh” (cần `GEMINI_API_KEY`) hoặc nhập tay → bộ đếm đỏ khi vượt → “Dựng ảnh khoá” → stage đổi “Đang dựng ảnh”. Commit:

```bash
git add src/studio/ScriptSheet.tsx
git commit -m "feat(xuong): phiếu kịch bản — AI/nhập tay, bộ đếm âm tiết realtime, dựng ảnh khoá"
```

---

### Task 15: Frontend — Chốt duyệt (lưới ảnh) + Bản dựng (render, ước tính, kết quả)

**Files:**

-

Replace: `src/studio/ReviewGrid.tsx`, `src/studio/RenderPanel.tsx`

-

[ ]  **Step 1: Viết `src/studio/ReviewGrid.tsx`**

```tsx
import { useState } from "react";
import { css } from "../lib/csx";
import type { StudioBundle } from "./StudioView";
import { approveStudioShot, regenerateStudioShot, requestStudioClips, studioFileUrl } from "./studioApi";
import { PURPOSE_LABEL, STATUS_LABEL } from "./studioLabels";

const card = css("background:#fff;border:1px solid #efe6d4;border-radius:16px;padding:18px;margin-bottom:16px");
const h = css("font-family:Fraunces,serif;font-size:18px;font-weight:600;color:#2a2016;margin-bottom:4px");
const small = css("font-size:11px;padding:5px 9px;border-radius:8px;border:1px solid #e6dcc8;background:#fff;cursor:pointer;color:#574a3a");

export function ReviewGrid({ bundle, showToast, reload }: { bundle: StudioBundle; showToast: (m: string) => void; reload: () => Promise<any> }) {
  const { project: p, shots } = bundle;
  const [editing, setEditing] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const withImage = shots.filter((s) => s.image_status !== "idle");
  if (!withImage.length) return null;
  const approved = shots.filter((s) => s.approved === 1 && s.image_status === "done");
  const rendering = shots.some((s) => ["pending", "processing"].includes(s.clip_status));

  const toggle = async (s: any) => { await approveStudioShot(s.id, s.approved ? 0 : 1); reload(); };
  const regen = async (s: any) => { setBusy(true); const r = await regenerateStudioShot(s.id, editing === s.id ? prompt : undefined); setBusy(false); setEditing(null); if (!r?.ok) showToast(r?.message || "Lỗi"); reload(); };
  const clips = async (tier: "draft" | "final") => {
    if (!confirm(`Render ${approved.length} cảnh hạng ${tier === "final" ? "CHỐT (đắt)" : "nháp"}?`)) return;
    setBusy(true); const r = await requestStudioClips(p.id, tier); setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không render được.");
    showToast(`Đã xếp hàng ${r.count} clip.`); reload();
  };

  return (
    <div style={card}>
      <div style={h}>2 · Chốt duyệt ảnh khoá</div>
      <div style={css("font-size:12px;color:#8a7c67;margin-bottom:12px")}>Chỉ ảnh <b>được duyệt</b> mới đi render clip (mất tiền). Ảnh xấu: sinh lại (rẻ) trước, đừng render.</div>
      <div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px")}>
        {withImage.map((s) => (
          <div key={s.id} style={css(`border:2px solid ${s.approved ? "#3c7a5e" : "#efe6d4"};border-radius:12px;overflow:hidden;background:#fffdf8`)}>
            <div style={css("aspect-ratio:9/16;background:#f3ede0;display:flex;align-items:center;justify-content:center;position:relative")}>
              {s.image_status === "done" && s.image_rel ? <img src={studioFileUrl(p.id, s.image_rel)} style={css("width:100%;height:100%;object-fit:cover")} /> : <span style={css("font-size:12px;color:#8a7c67")}>{STATUS_LABEL[s.image_status]}{s.image_status === "processing" ? "…" : ""}</span>}
              {s.approved === 1 && <span style={css("position:absolute;top:6px;right:6px;background:#3c7a5e;color:#fff;border-radius:999px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px")}>✓</span>}
              {s.clip_status !== "idle" && <span style={css(`position:absolute;bottom:6px;left:6px;font-size:10px;padding:2px 6px;border-radius:6px;background:${s.clip_status === "done" ? "#3c7a5e" : s.clip_status === "failed" ? "#9e3a3a" : "#b06a16"};color:#fff`)}>Clip: {STATUS_LABEL[s.clip_status]}</span>}
            </div>
            <div style={css("padding:8px")}>
              <div style={css("font-size:12px;font-weight:700;color:#2a2016")}>Cảnh {s.idx + 1} · {PURPOSE_LABEL[s.purpose] || s.purpose}</div>
              {s.error && <div style={css("font-size:10px;color:#9e3a3a;margin-top:2px")}>{s.error.slice(0, 120)}</div>}
              <div style={css("display:flex;gap:4px;flex-wrap:wrap;margin-top:6px")}>
                {s.image_status === "done" && <button style={{ ...small, ...(s.approved ? css("background:#3c7a5e;color:#fff;border-color:#3c7a5e") : {}) }} onClick={() => toggle(s)}>{s.approved ? "Đã duyệt" : "Duyệt"}</button>}
                {["done", "failed"].includes(s.image_status) && <button style={small} disabled={busy} onClick={() => regen(s)}>Sinh lại</button>}
                {["done", "failed"].includes(s.image_status) && <button style={small} onClick={() => { setEditing(editing === s.id ? null : s.id); setPrompt(s.image_prompt); }}>Sửa prompt</button>}
                {s.clip_status === "done" && s.clip_rel && <a style={{ ...small, textDecoration: "none" }} href={studioFileUrl(p.id, s.clip_rel)} target="_blank">Xem clip</a>}
              </div>
              {editing === s.id && (<div style={css("margin-top:6px")}><textarea style={css("width:100%;font-size:11px;min-height:60px;border:1px solid #e6dcc8;border-radius:8px;padding:6px")} value={prompt} onChange={(e) => setPrompt(e.target.value)} /><button style={small} disabled={busy} onClick={() => regen(s)}>Sinh lại với prompt này</button></div>)}
            </div>
          </div>
        ))}
      </div>
      <div style={css("display:flex;gap:8px;align-items:center;margin-top:14px;flex-wrap:wrap")}>
        <span style={css("font-size:13px;color:#574a3a")}>Đã duyệt <b>{approved.length}</b>/{withImage.length}</span>
        <button disabled={!approved.length || busy || rendering} style={css(`padding:10px 16px;border-radius:10px;border:0;background:${approved.length && !rendering ? "#b06a16" : "#d9cdb5"};color:#fff;font-weight:700;cursor:pointer`)} onClick={() => clips("draft")}>Render nháp (rẻ)</button>
        <button disabled={!approved.length || busy || rendering} style={css(`padding:10px 16px;border-radius:10px;border:1px solid #b06a16;background:#fff;color:${approved.length && !rendering ? "#9a5a12" : "#c9b899"};font-weight:700;cursor:pointer`)} onClick={() => clips("final")}>Render chốt (đẹp)</button>
        {rendering && <span style={css("font-size:12px;color:#8a7c67")}>Đang render… trang tự cập nhật.</span>}
      </div>
    </div>
  );
}
```
- [ ]  **Step 2: Viết `src/studio/RenderPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { css } from "../lib/csx";
import type { StudioBundle } from "./StudioView";
import { requestStudioAssemble, getStudioEstimate, listStudioMusic, studioFileUrl } from "./studioApi";
import { TRANSITION_LABEL, vnd } from "./studioLabels";

const card = css("background:#fff;border:1px solid #efe6d4;border-radius:16px;padding:18px;margin-bottom:16px");
const h = css("font-family:Fraunces,serif;font-size:18px;font-weight:600;color:#2a2016;margin-bottom:4px");
const sel = css("padding:8px 10px;border:1px solid #e6dcc8;border-radius:8px;font-size:13px;background:#fff;color:#2a2016");

export function RenderPanel({ bundle, health, showToast, reload }: { bundle: StudioBundle; health: any; showToast: (m: string) => void; reload: () => Promise<any> }) {
  const { project: p, shots, render } = bundle;
  const approved = shots.filter((s) => s.approved === 1);
  const ready = approved.length > 0 && approved.every((s) => s.clip_status === "done");
  const [voice, setVoice] = useState(p.voice || health?.voiceDefault || "");
  const [rate, setRate] = useState(Number(p.voice_rate || 1));
  const [music, setMusic] = useState<string>(p.music || "");
  const [musics, setMusics] = useState<string[]>([]);
  const [transition, setTransition] = useState(p.transition || "fade");
  const [est, setEst] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listStudioMusic().then((r) => r?.ok && setMusics(r.files)); }, []);
  useEffect(() => { getStudioEstimate(p.id, p.tier).then((r) => r?.ok && setEst(r)); }, [p.id, p.tier, approved.length]);
  useEffect(() => { if (!voice && health?.voiceDefault) setVoice(health.voiceDefault); }, [health?.voiceDefault]);
  if (!approved.length && !render) return null;
  const assembling = p.assemble_status === "pending" || p.assemble_status === "processing";

  const go = async () => {
    setBusy(true); const r = await requestStudioAssemble(p.id, { voice, voiceRate: rate, music: music || null, transition }); setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không ghép được."); showToast("Đang ghép — vài chục giây."); reload();
  };
  const copy = (t: string) => { navigator.clipboard?.writeText(t); showToast("Đã copy."); };

  return (
    <div style={card}>
      <div style={h}>3 · Bản dựng</div>
      {est && <div style={css("font-size:12px;color:#8a7c67;margin-bottom:10px")}>Ước tính hạng {p.tier === "final" ? "chốt" : "nháp"}: ảnh ${est.estimate.imagesUsd} + clip ${est.estimate.clipsUsd} + giọng ${est.estimate.voiceUsd} = <b>${est.estimate.totalUsd}</b> ≈ {vnd(est.estimate.totalUsd)} · <b>Đã tiêu thật ${Number(est.spentUsd).toFixed(3)}</b></div>}
      <div style={css("display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
        <select style={sel} value={voice} onChange={(e) => setVoice(e.target.value)}>{(health?.voices || []).map((v: any) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
        <label style={css("font-size:12px;color:#574a3a")}>Tốc độ <input type="range" min={0.8} max={1.4} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} /> {rate.toFixed(2)}×</label>
        <select style={sel} value={music} onChange={(e) => setMusic(e.target.value)}><option value="">Không nhạc nền</option>{musics.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        <select style={sel} value={transition} onChange={(e) => setTransition(e.target.value)}>{Object.entries(TRANSITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button disabled={!ready || busy || assembling} style={css(`padding:10px 16px;border-radius:10px;border:0;background:${ready && !assembling ? "#3c7a5e" : "#d9cdb5"};color:#fff;font-weight:700;cursor:pointer`)} onClick={go}>{assembling ? "Đang ghép…" : render ? "Ghép lại" : "Ghép video hoàn chỉnh"}</button>
      </div>
      {!ready && !render && <div style={css("font-size:12px;color:#8a7c67;margin-top:8px")}>Chờ đủ clip của các cảnh đã duyệt.</div>}
      {render && (
        <div style={css("display:grid;grid-template-columns:260px 1fr;gap:16px;margin-top:16px;align-items:start")}>
          <video controls src={studioFileUrl(p.id, render.mp4_rel)} style={css("width:260px;aspect-ratio:9/16;border-radius:12px;background:#000")} />
          <div>
            <div style={css("font-size:13px;color:#2a2016")}>Thời lượng {Number(render.duration).toFixed(1)}s · giọng {render.voice}{render.music ? ` · nhạc ${render.music}` : ""}</div>
            <div style={css("display:flex;gap:8px;margin-top:8px;flex-wrap:wrap")}>
              <a href={studioFileUrl(p.id, render.mp4_rel)} download style={css("padding:8px 12px;border-radius:8px;background:#b06a16;color:#fff;text-decoration:none;font-size:13px;font-weight:700")}>Tải mp4</a>
              {render.cover_rel && <a href={studioFileUrl(p.id, render.cover_rel)} download style={css("padding:8px 12px;border-radius:8px;border:1px solid #e6dcc8;color:#574a3a;text-decoration:none;font-size:13px")}>Tải ảnh bìa</a>}
              {render.srt_rel && <a href={studioFileUrl(p.id, render.srt_rel)} download style={css("padding:8px 12px;border-radius:8px;border:1px solid #e6dcc8;color:#574a3a;text-decoration:none;font-size:13px")}>Tải .srt</a>}
            </div>
            <div style={css("margin-top:12px;font-size:12px;color:#8a7c67")}>Caption</div>
            <div style={css("background:#fffdf8;border:1px solid #efe6d4;border-radius:8px;padding:8px;font-size:13px;color:#2a2016;white-space:pre-wrap")}>{render.caption || "—"}</div>
            <div style={css("margin-top:8px;font-size:12px;color:#8a7c67")}>Hashtag</div>
            <div style={css("background:#fffdf8;border:1px solid #efe6d4;border-radius:8px;padding:8px;font-size:13px;color:#2a2016")}>{render.hashtags || "—"}</div>
            <button style={css("margin-top:8px;padding:8px 12px;border-radius:8px;border:1px solid #e6dcc8;background:#fff;cursor:pointer;font-size:12px;color:#574a3a")} onClick={() => copy(`${render.caption || ""}\n${render.hashtags || ""}`.trim())}>Copy caption + hashtag</button>
            {render.cover_rel && <img src={studioFileUrl(p.id, render.cover_rel)} style={css("display:block;width:90px;border-radius:8px;margin-top:10px;border:1px solid #efe6d4")} />}
          </div>
        </div>
      )}
    </div>
  );
}
```
- [ ]  **Step 3: Build + chạy trọn luồng với engine giả**

Đặt trong `.env`: `STUDIO_ENGINE_IMAGE=fake STUDIO_ENGINE_VIDEO=fake STUDIO_ENGINE_VOICE=fake`. `npm run dev` → tạo dự án → nhập tay 2 cảnh → Dựng ảnh khoá → sau vài giây 2 ô cam hiện lên → Duyệt cả 2 → Render nháp → clip xanh → Ghép → video 9:16 phát được, có phụ đề (chữ trắng nền đen), tải mp4/bìa/srt, chi phí $0.

Rồi đổi sang engine thật (`nano`/`veo`/`edge`) chạy 1 dự án 2 cảnh — mất khoảng $1.
- [ ]  **Step 4: Commit**

```bash
git add src/studio/ReviewGrid.tsx src/studio/RenderPanel.tsx
git commit -m "feat(xuong): chốt duyệt lưới ảnh + bản dựng (ước tính vs thật, giọng/nhạc/chuyển cảnh, tải về, copy caption)"
```

---

### Task 16: Đóng gói — Docker, compose, README

**Files:**

-

Modify: `Dockerfile` (font Việt), `docker-compose.yml` (volume + env), `README.md` (mục Xưởng)

-

[ ]  **Step 1: `Dockerfile`** — đổi dòng `RUN apk add --no-cache python3 make g++ ffmpeg` thành:

```dockerfile
# + ttf-dejavu/fontconfig: font có glyph tiếng Việt cho burn phụ đề (Xưởng)
RUN apk add --no-cache python3 make g++ ffmpeg ttf-dejavu fontconfig
```
- [ ]  **Step 2: `docker-compose.yml`** — thêm vào `environment` và `volumes`:

```yaml
      # Xưởng: file ảnh/clip/mp4 nằm trên ổ dữ liệu 150GB (/data), KHÔNG trên ổ hệ thống
      - STUDIO_DATA_DIR=/app/data/studio
      - STUDIO_SUB_FONT=DejaVu Sans
```

```yaml
      - /data/videoana-studio:/app/data/studio
```
- [ ]  **Step 3: `README.md`** — thêm mục sau phần "Luồng phân tích":

```markdown
## Xưởng — sản xuất video affiliate từ ảnh sản phẩm

Menu **Xưởng** (Biên tập/Quản trị): ảnh sản phẩm + bối cảnh → kịch bản (AI nhìn ảnh, hoặc nhập tay)
→ ảnh khoá (Nano Banana Pro) → **chốt duyệt** → clip (Veo 3.1, nháp/chốt) → ghép giọng Việt +
phụ đề + nhạc → mp4 9:16 + ảnh bìa + caption. Chi phí ghi sổ từng bước.
- Cấu hình: khối `STUDIO_*` trong `.env.example`. Engine `fake` để chạy thử không tốn tiền.
- Nhạc nền: thả mp3 vào `<STUDIO_DATA_DIR>/_music/`.
- Bench engine (Bước 0): `npm run studio:bench -- --product a.jpg --background b.jpg --prompt "..."`.
- Test: `npm test` (không gọi API thật).
- Thiết kế: `docs/superpowers/specs/2026-08-19-xuong-san-xuat-video-affiliate-design.md`.
```
- [ ]  **Step 4: Build image thử cục bộ và commit**

Run: `docker build -t videoana-test .` → thành công. (Không deploy trong task này.)

```bash
git add Dockerfile docker-compose.yml README.md
git commit -m "chore(xuong): font phụ đề trong image, volume /data/videoana-studio, README"
```

---

## Sau khi xong Giai đoạn 1
- Deploy lên `163.44.193.87`: `mkdir -p /data/videoana-studio`, thêm `STUDIO_*` + `GEMINI_API_KEY` vào `.env` prod, `docker compose up -d --build`. Kiểm tra `curl -H "Authorization: Bearer <jwt>" https://video.nonelab.net/api/studio/health`.
- Nhớ 3 commit campaign chưa lên prod (`9acb766`, `82f82ba`, `85bcbf8`) sẽ lên cùng — kiểm tra lại màn Campaign sau deploy.
- Phiếu ngoài phạm vi (spec mục 13): siết CORS `*`, chốt model prod, dọn đĩa tự động, dọn backup sqlite cũ.
- Giai đoạn 1.5 (Kho giọng, spec mục 6): spec/plan riêng — xác minh Blaze.vn trước.
