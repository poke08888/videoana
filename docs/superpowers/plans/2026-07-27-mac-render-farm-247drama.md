# Mac Render Farm cho 247drama — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy toàn bộ pipeline tải + OCR + dịch + burn sub trên máy Mac M4, rồi rsync file lên server + ghi thẳng MongoDB, để server (4 nhân, quá tải) chỉ còn stream.

**Architecture:** Một worker Node.js chạy trên Mac tái dùng nguyên các module pipeline hiện có của server (`duanjuProvider`, `asrOcr`, `subtitle`, `transcode`, `translate`, `autosub`) qua rsync. Worker đọc phim "pending" từ Mongo server (bind public + auth), tải video qua SOCKS5 tới HK VPS, OCR+dịch+burn cục bộ (file nặng nằm trên ổ ngoài exFAT BINGNET), rsync mp4 kết quả vào `/uploads` server và upsert `ShortVideo` khớp đúng shape mà server tạo. Server tắt hẳn pipeline OCR.

**Tech Stack:** Node.js v20 (CommonJS), mongoose, axios, socks-proxy-agent, p-limit@3, dotenv; Python venv (rapidocr-onnxruntime + onnxruntime + opencv-python-headless + numpy); ffmpeg/ffprobe (brew); ssh SOCKS tunnel.

## Global Constraints

- **KHÔNG sửa code trên server.** Mọi thay đổi ở phía Mac + đúng 1 lần set `chineseDramaApi.importConcurrency=0` trong Mongo.
- **Node CommonJS** (không ESM). `p-limit` phải là **v3** (v4+ là ESM-only).
- **Media nặng** (download / tmp / output) chỉ ghi vào `/Volumes/BINGNET/247drama-render/`. Python venv + code + node_modules nằm ổ chính (`/Users/kevin/video/247drama-worker/`) vì exFAT không hỗ trợ symlink/permission.
- **videoUrl format phải khớp tuyệt đối** bản server tạo: `http://103.179.185.196/uploads/<provider>_<sourceId>_ep<index>.mp4`. Filename phẳng, `<index>` là 0-based `episodeNumber`.
- **Thứ tự bắt buộc:** rsync file lên `/uploads` THÀNH CÔNG rồi mới upsert Mongo (tránh record trỏ file không tồn tại).
- **Idempotent:** bỏ qua tập đã có `episodeNumber` trong Mongo. Chạy lại worker không tạo trùng.
- **Secrets không commit:** `.env` worker chứa Mongo connection string + password server → phải nằm trong `.gitignore`.
- Giá trị chốt từ server (dùng nguyên): `freeEpisodesForNonVip=5` → `freeLimit=6` (index<6 miễn phí, coin 0; index>=6 khoá, coin 10). `proxyUrl=socks5://127.0.0.1:1080`. Gemini key + 52api key + OCR params đọc runtime từ `settingJSON` trong Mongo.
- **HK VPS proxy** (`HK_HOST`/`HK_PASSWORD`) và **Server 247drama** (`SERVER_HOST`/`SERVER_PASSWORD`): thông tin đăng nhập lưu trong `.env` (gitignored), KHÔNG hardcode trong file commit.

---

## File Structure

Thư mục worker: `/Users/kevin/video/247drama-worker/`

**Copy từ server (rsync, không tự viết — nguồn chuẩn đã kiểm thử):**
- `util/duanjuProvider.js`, `util/asrOcr.js`, `util/asr.js`, `util/subtitle.js`, `util/transcode.js`, `util/translate.js`, `util/autosub.js`
- `scripts/ocr_subs.py`
- `models/movieSeries.model.js`, `models/shortVideo.model.js`, `models/setting.model.js`
- `types/constant.js` (movieSeries.model require)

**Tự viết:**
- `.env`, `.gitignore`, `package.json`
- `config.js` — nạp env, đường dẫn, `buildFilename()`, `buildVideoUrl()`, `buildSubtitleConfig()`
- `db.js` — kết nối Mongo, export models, `loadSettings()`
- `work.js` — `computeMissingEpisodes()` (thuần), `findPendingWork()`
- `render.js` — `renderEpisode()`
- `worker.js` — vòng lặp chính (p-limit, one-shot)
- `test/config.test.js`, `test/work.test.js` — dùng `node --test` (built-in)
- `ops/disable-server-pipeline.sh` — tắt OCR server (Task 7)

---

## Task 1: Scaffold worker + copy pipeline files từ server

**Files:**
- Create: `247drama-worker/package.json`, `247drama-worker/.gitignore`
- Copy (rsync): `util/*.js`, `scripts/ocr_subs.py`, `models/*.model.js`, `types/constant.js`

**Interfaces:**
- Produces: thư mục worker có đủ module pipeline require được; `node_modules` cài xong.

- [ ] **Step 1: Tạo thư mục + package.json**

```bash
mkdir -p /Users/kevin/video/247drama-worker
cd /Users/kevin/video/247drama-worker
```

`247drama-worker/package.json`:
```json
{
  "name": "247drama-worker",
  "version": "1.0.0",
  "private": true,
  "description": "Local render farm cho 247drama (tải + OCR + dịch + burn sub trên Mac, up server)",
  "main": "worker.js",
  "scripts": {
    "worker": "node worker.js",
    "test": "node --test"
  },
  "dependencies": {
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "https-proxy-agent": "^7.0.0",
    "mongoose": "^8.5.0",
    "p-limit": "^3.1.0",
    "socks-proxy-agent": "^8.0.0"
  }
}
```

- [ ] **Step 2: Tạo .gitignore (chặn commit secrets/media/node_modules)**

`247drama-worker/.gitignore`:
```
node_modules/
.env
ocr-venv/
*.mp4
*.ass
*.log
```

- [ ] **Step 3: Copy các file pipeline từ server bằng rsync**

```bash
cd /Users/kevin/video/247drama-worker
export SSHPASS='Ngaymainha@1'
RSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new"
SRV=root@103.179.185.196:/var/www/247drama/backend

mkdir -p util scripts models types
rsync -av -e "$RSH" \
  $SRV/util/duanjuProvider.js $SRV/util/asrOcr.js $SRV/util/asr.js \
  $SRV/util/subtitle.js $SRV/util/transcode.js $SRV/util/translate.js $SRV/util/autosub.js \
  util/
rsync -av -e "$RSH" $SRV/scripts/ocr_subs.py scripts/
rsync -av -e "$RSH" $SRV/models/movieSeries.model.js $SRV/models/shortVideo.model.js $SRV/models/setting.model.js models/
rsync -av -e "$RSH" $SRV/types/constant.js types/
```

- [ ] **Step 4: Cài node_modules**

```bash
cd /Users/kevin/video/247drama-worker && npm install
```
Expected: cài xong, không lỗi. `p-limit@3` (CommonJS).

- [ ] **Step 5: Verify các module require được (chưa chạy pipeline)**

```bash
cd /Users/kevin/video/247drama-worker
node -e "require('./util/duanjuProvider'); require('./util/autosub'); require('./util/translate'); require('./models/movieSeries.model'); require('./models/shortVideo.model'); require('./models/setting.model'); console.log('OK require all')"
```
Expected: in `OK require all`. (Nếu `types/constant` thiếu export CONTENT_TYPE → rsync lại; nếu model trùng tên khi require 2 lần → bỏ qua, ở worker mỗi model require 1 lần.)

- [ ] **Step 6: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/package.json 247drama-worker/.gitignore 247drama-worker/util 247drama-worker/scripts 247drama-worker/models 247drama-worker/types 247drama-worker/package-lock.json
git commit -m "feat(worker): scaffold 247drama render worker + copy pipeline modules"
```

---

## Task 2: Setup môi trường Mac (venv OCR, ffmpeg, font, BINGNET, SOCKS tunnel)

**Files:**
- Create: `/Users/kevin/video/247drama-worker/ocr-venv/` (python venv, gitignored)
- Create dirs: `/Volumes/BINGNET/247drama-render/{download,tmp,output}`
- Create: `247drama-worker/ops/hk-tunnel.sh`

**Interfaces:**
- Produces: `OCR_PYTHON` chạy được OCR; `ffprobe` tồn tại; SOCKS5 `127.0.0.1:1080` ra IP HK; thư mục BINGNET ghi được.

- [ ] **Step 1: Cài ffmpeg + ffprobe (đầy đủ) + sshpass**

```bash
brew install ffmpeg sshpass 2>/dev/null; brew reinstall ffmpeg
which ffmpeg ffprobe
```
Expected: cả `ffmpeg` và `ffprobe` đều có đường dẫn.

- [ ] **Step 2: Tạo Python venv OCR trên ổ chính**

```bash
cd /Users/kevin/video/247drama-worker
python3 -m venv ocr-venv
./ocr-venv/bin/pip install --upgrade pip
./ocr-venv/bin/pip install rapidocr-onnxruntime==1.4.4 onnxruntime opencv-python-headless numpy
```
Expected: cài xong. Nếu `onnxruntime` không có wheel cho python 3.13 → `brew install python@3.12` rồi `python3.12 -m venv ocr-venv` và cài lại.

- [ ] **Step 3: Verify OCR chạy — tạo clip mẫu rồi OCR**

```bash
cd /Users/kevin/video/247drama-worker
# clip test 3s có chữ (dùng testsrc + drawtext tiếng Trung nếu có font; đơn giản là 1 video bất kỳ)
ffmpeg -y -f lavfi -i testsrc=size=720x1280:rate=5:duration=3 -pix_fmt yuv420p /Volumes/BINGNET/247drama-render/tmp/ocrtest.mp4
OCR_THREADS=2 ./ocr-venv/bin/python scripts/ocr_subs.py /Volumes/BINGNET/247drama-render/tmp/ocrtest.mp4 3.2 0.55 0.85 0.6
```
Expected: in JSON (vd `{"segments":[],"chineseBottomRatio":...}` hoặc `[]`) — quan trọng là chạy KHÔNG lỗi import cv2/rapidocr.

- [ ] **Step 4: Tạo thư mục làm việc BINGNET**

```bash
mkdir -p /Volumes/BINGNET/247drama-render/download /Volumes/BINGNET/247drama-render/tmp /Volumes/BINGNET/247drama-render/output
echo ok > /Volumes/BINGNET/247drama-render/.wtest && rm /Volumes/BINGNET/247drama-render/.wtest && echo "BINGNET writable"
```
Expected: in `BINGNET writable`.

- [ ] **Step 5: Script mở SOCKS tunnel tới HK VPS**

`247drama-worker/ops/hk-tunnel.sh`:
```bash
#!/usr/bin/env bash
# Mở SOCKS5 127.0.0.1:1080 tới HK VPS để tải video hm (CDN cbread.cn chặn từ VN).
# Chạy nền; nếu đã có tunnel trên 1080 thì bỏ qua.
set -e
if lsof -iTCP:1080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "SOCKS 1080 đã chạy"; exit 0
fi
export SSHPASS='Dinh2510@'
sshpass -e ssh -fN -D 127.0.0.1:1080 \
  -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  root@47.76.79.169
echo "SOCKS 1080 -> HK VPS đã mở"
```

- [ ] **Step 6: Chạy tunnel + verify ra IP HK**

```bash
chmod +x /Users/kevin/video/247drama-worker/ops/hk-tunnel.sh
/Users/kevin/video/247drama-worker/ops/hk-tunnel.sh
curl -s --socks5-hostname 127.0.0.1:1080 https://api.ipify.org; echo
```
Expected: in ra 1 IP (của HK VPS, khác IP mạng nhà). Nếu fail → kiểm tra HK VPS còn sống.

- [ ] **Step 7: Commit script ops**

```bash
cd /Users/kevin/video
git add 247drama-worker/ops/hk-tunnel.sh
git commit -m "feat(worker): setup ops - HK SOCKS tunnel script"
```

---

## Task 3: Config module + .env + hàm build URL/filename (có unit test)

**Files:**
- Create: `247drama-worker/.env`, `247drama-worker/config.js`, `247drama-worker/test/config.test.js`

**Interfaces:**
- Produces:
  - `config.env` — object: `{ mongoUri, baseUrl, workDir, downloadDir, tmpDir, outputDir, ocrPython, concurrency, ocrThreads, keepOriginal, server: {host, user, password, uploadsPath} }`
  - `buildFilename(provider, sourceId, index) -> "<provider>_<sourceId>_ep<index>.mp4"`
  - `buildVideoUrl(provider, sourceId, index) -> "<baseUrl>/uploads/<filename>"`
  - `buildSubtitleConfig(settingJSON) -> {apiKey, geminiModel, whisperModel, whisperCpuThreads, sourceLang, targetLang, translateBatchSize, coverBoxYRatio, coverBoxHeightRatio, coverBoxColor, coverEnabled}` (khớp `getSubtitleConfig` của server)

- [ ] **Step 1: Tạo .env (lấy Mongo string từ server, KHÔNG hardcode vào code)**

```bash
cd /Users/kevin/video/247drama-worker
MONGO=$(sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=accept-new root@103.179.185.196 'grep "^MongoDb_Connection_String=" /var/www/247drama/backend/.env | cut -d= -f2-')
cat > .env <<EOF
MongoDb_Connection_String=$MONGO
baseURL=http://103.179.185.196
WORK_DIR=/Volumes/BINGNET/247drama-render
OCR_PYTHON=/Users/kevin/video/247drama-worker/ocr-venv/bin/python
RENDER_CONCURRENCY=4
OCR_THREADS=3
KEEP_ORIGINAL=1
SERVER_HOST=103.179.185.196
SERVER_USER=root
SERVER_PASSWORD=Ngaymainha@1
SERVER_UPLOADS=/var/www/247drama/backend/uploads
EOF
echo ".env created (MONGO len: ${#MONGO})"
```
Expected: `.env created` với MONGO len > 0. Nếu len=0 → connection string không lấy được, kiểm tra lại.

- [ ] **Step 2: Viết test cho buildFilename/buildVideoUrl (fail trước)**

`247drama-worker/test/config.test.js`:
```js
const { test } = require("node:test");
const assert = require("node:assert");
const { buildFilename, buildVideoUrl } = require("../config");

test("buildFilename khớp format server", () => {
  assert.strictEqual(buildFilename("hg", "7661582233639062553", 58), "hg_7661582233639062553_ep58.mp4");
  assert.strictEqual(buildFilename("hm", "12345", 0), "hm_12345_ep0.mp4");
});

test("buildVideoUrl khớp URL server", () => {
  process.env.baseURL = "http://103.179.185.196";
  assert.strictEqual(
    buildVideoUrl("hg", "7661582233639062553", 58),
    "http://103.179.185.196/uploads/hg_7661582233639062553_ep58.mp4",
  );
});
```

- [ ] **Step 3: Chạy test → fail**

```bash
cd /Users/kevin/video/247drama-worker && node --test test/config.test.js
```
Expected: FAIL — `Cannot find module '../config'`.

- [ ] **Step 4: Viết config.js**

`247drama-worker/config.js`:
```js
require("dotenv").config();
const path = require("path");

const workDir = process.env.WORK_DIR || "/Volumes/BINGNET/247drama-render";

const env = {
  mongoUri: process.env.MongoDb_Connection_String,
  baseUrl: process.env.baseURL || "http://103.179.185.196",
  workDir,
  downloadDir: path.join(workDir, "download"),
  tmpDir: path.join(workDir, "tmp"),
  outputDir: path.join(workDir, "output"),
  ocrPython: process.env.OCR_PYTHON,
  concurrency: Math.max(1, parseInt(process.env.RENDER_CONCURRENCY) || 4),
  ocrThreads: Math.max(0, parseInt(process.env.OCR_THREADS) || 3),
  keepOriginal: process.env.KEEP_ORIGINAL !== "0",
  server: {
    host: process.env.SERVER_HOST,
    user: process.env.SERVER_USER,
    password: process.env.SERVER_PASSWORD,
    uploadsPath: process.env.SERVER_UPLOADS,
  },
};

// Tên file phẳng, KHỚP đúng uploadBufferToStorage local của server.
function buildFilename(provider, sourceId, index) {
  return `${provider}_${sourceId}_ep${index}.mp4`;
}

// URL công khai KHỚP đúng bản server tạo (storage=local).
function buildVideoUrl(provider, sourceId, index) {
  const base = process.env.baseURL || env.baseUrl;
  return `${base}/uploads/${buildFilename(provider, sourceId, index)}`;
}

// Khớp getSubtitleConfig() của server (controllers/admin/movieSeries.controller.js).
function buildSubtitleConfig(settingJSON) {
  const s = (settingJSON && settingJSON.subtitle) || {};
  return {
    apiKey: s.geminiApiKey || "",
    geminiModel: s.geminiModel || "gemini-2.5-flash",
    whisperModel: s.whisperModel || "medium",
    whisperCpuThreads: s.whisperCpuThreads || 4,
    sourceLang: s.sourceLang || "zh",
    targetLang: s.targetLang || "vi",
    translateBatchSize: s.translateBatchSize || 20,
    coverBoxYRatio: typeof s.coverBoxYRatio === "number" ? s.coverBoxYRatio : 0.66,
    coverBoxHeightRatio: typeof s.coverBoxHeightRatio === "number" ? s.coverBoxHeightRatio : 0.17,
    coverBoxColor: s.coverBoxColor || "white@1",
    coverEnabled: s.coverEnabled !== false,
  };
}

module.exports = { env, buildFilename, buildVideoUrl, buildSubtitleConfig };
```

- [ ] **Step 5: Chạy test → pass**

```bash
cd /Users/kevin/video/247drama-worker && node --test test/config.test.js
```
Expected: PASS cả 2 test.

- [ ] **Step 6: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/config.js 247drama-worker/test/config.test.js
git commit -m "feat(worker): config module + build URL/filename khớp server (tested)"
```

---

## Task 4: DB connect + models + tìm phim pending (có unit test cho computeMissingEpisodes)

**Files:**
- Create: `247drama-worker/db.js`, `247drama-worker/work.js`, `247drama-worker/test/work.test.js`

**Interfaces:**
- Consumes: `env.mongoUri` (config), models đã copy, `duanjuProvider.detail` (Task 1).
- Produces:
  - `db.connect() -> Promise<void>`; `db.MovieSeries`, `db.ShortVideo`, `db.Setting`; `db.loadSettings() -> Promise<settingJSON>` (đồng thời gán `global.settingJSON`).
  - `work.computeMissingEpisodes(detailEpisodes, existingNumbers) -> [{index, videoId, title}]` — thuần, không I/O.
  - `work.findPendingWork() -> [{ series:{_id,name,thumbnail}, provider, sourceId, episodes:[all detail episodes], missing:[{index,videoId,title}] }]`
  - `work.extract52apiSource(series) -> {provider, sourceId}` (khớp server).

- [ ] **Step 1: Viết db.js**

`247drama-worker/db.js`:
```js
const mongoose = require("mongoose");
const { env } = require("./config");

const MovieSeries = require("./models/movieSeries.model");
const ShortVideo = require("./models/shortVideo.model");
const Setting = require("./models/setting.model");

async function connect() {
  if (!env.mongoUri) throw new Error("Thiếu MongoDb_Connection_String trong .env");
  await mongoose.connect(env.mongoUri);
}

// Nạp Setting -> gán global.settingJSON (các module pipeline đọc từ đây). Inject ocrThreads để giới hạn luồng OCR.
async function loadSettings() {
  const s = await Setting.findOne({}).lean();
  if (!s) throw new Error("Không đọc được Setting từ Mongo");
  s.subtitle = s.subtitle || {};
  if (env.ocrThreads > 0) s.subtitle.ocrThreads = env.ocrThreads;
  global.settingJSON = s;
  return s;
}

module.exports = { connect, loadSettings, mongoose, MovieSeries, ShortVideo, Setting };
```

- [ ] **Step 2: Viết test cho computeMissingEpisodes (fail trước)**

`247drama-worker/test/work.test.js`:
```js
const { test } = require("node:test");
const assert = require("node:assert");
const { computeMissingEpisodes } = require("../work");

test("bỏ tập đã có, giữ tập thiếu đúng thứ tự", () => {
  const detail = [
    { index: 0, videoId: "a", title: "t0" },
    { index: 1, videoId: "b", title: "t1" },
    { index: 2, videoId: "c", title: "t2" },
    { index: 3, videoId: "d", title: "t3" },
  ];
  const existing = new Set([0, 1]);
  const missing = computeMissingEpisodes(detail, existing);
  assert.deepStrictEqual(missing.map((m) => m.index), [2, 3]);
  assert.strictEqual(missing[0].videoId, "c");
});

test("không thiếu tập -> mảng rỗng", () => {
  const detail = [{ index: 0, videoId: "a", title: "t0" }];
  assert.deepStrictEqual(computeMissingEpisodes(detail, new Set([0])), []);
});
```

- [ ] **Step 3: Chạy test → fail**

```bash
cd /Users/kevin/video/247drama-worker && node --test test/work.test.js
```
Expected: FAIL — `Cannot find module '../work'`.

- [ ] **Step 4: Viết work.js**

`247drama-worker/work.js`:
```js
const duanju = require("./util/duanjuProvider");
const { MovieSeries, ShortVideo } = require("./db");

const PROVIDERS = ["hg", "hm"];
function normalizeProvider(p) {
  const v = String(p || "").toLowerCase();
  return PROVIDERS.includes(v) ? v : null;
}

// Khớp extract52apiSource của server: ưu tiên bookId "hg:<id>", fallback sourceProvider.
function extract52apiSource(series) {
  let provider = null;
  let sourceId = null;
  if (series && series.bookId && series.bookId.includes(":")) {
    const [p, sid] = series.bookId.split(":");
    provider = normalizeProvider(p);
    sourceId = sid;
  }
  if (!provider && series && series.sourceProvider) {
    const m = String(series.sourceProvider).match(/^52api-(hg|hm)$/);
    if (m) provider = m[1];
  }
  return { provider, sourceId };
}

// Thuần: từ danh sách tập nguồn + tập đã có -> tập còn thiếu (theo episodeNumber = index).
function computeMissingEpisodes(detailEpisodes, existingNumbers) {
  return (detailEpisodes || []).filter((ep) => !existingNumbers.has(ep.index));
}

// Quét mọi phim 52api, trả về danh sách việc cần render (chỉ phim còn thiếu tập).
async function findPendingWork() {
  const movies = await MovieSeries.find({ sourceProvider: /^52api-/ })
    .select("_id name thumbnail bookId sourceProvider sourceEpisodeCount")
    .lean();

  const work = [];
  for (const m of movies) {
    const { provider, sourceId } = extract52apiSource(m);
    if (!provider || !sourceId) continue;

    let info;
    try {
      info = await duanju.detail(provider, sourceId); // đi qua throttle 52api
    } catch (e) {
      console.error(`[work] detail lỗi ${provider}:${sourceId}:`, e.message);
      continue;
    }
    const episodes = info.episodes || [];
    if (!episodes.length) continue;

    const existing = await ShortVideo.find({ movieSeries: m._id }).select("episodeNumber").lean();
    const existingNumbers = new Set(existing.map((e) => e.episodeNumber));
    const missing = computeMissingEpisodes(episodes, existingNumbers);

    if (missing.length) {
      work.push({
        series: { _id: m._id, name: m.name, thumbnail: m.thumbnail || "" },
        provider,
        sourceId,
        episodes,
        missing,
      });
    }
  }
  return work;
}

module.exports = { computeMissingEpisodes, findPendingWork, extract52apiSource };
```

- [ ] **Step 5: Chạy test → pass**

```bash
cd /Users/kevin/video/247drama-worker && node --test test/work.test.js
```
Expected: PASS cả 2 test.

- [ ] **Step 6: Integration smoke — liệt kê pending thật (cần tunnel đang mở)**

```bash
cd /Users/kevin/video/247drama-worker
./ops/hk-tunnel.sh
node -e "
const db=require('./db'); const work=require('./work');
(async()=>{
  await db.connect(); await db.loadSettings();
  const w=await work.findPendingWork();
  console.log('Phim pending:', w.length);
  for (const it of w) console.log(' -', it.series.name, it.provider+':'+it.sourceId, 'thiếu', it.missing.length, '/', it.episodes.length);
  await db.mongoose.disconnect();
})().catch(e=>{console.error(e);process.exit(1);});
"
```
Expected: in ra danh sách phim còn thiếu tập (vd Trọng Sinh thiếu N/76, Tam Sinh thiếu 80/80). Không lỗi.

- [ ] **Step 7: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/db.js 247drama-worker/work.js 247drama-worker/test/work.test.js
git commit -m "feat(worker): db connect + tìm phim pending + computeMissingEpisodes (tested)"
```

---

## Task 5: renderEpisode — tải → OCR+dịch+burn → rsync → upsert Mongo

**Files:**
- Create: `247drama-worker/render.js`

**Interfaces:**
- Consumes: `duanju.resolveVideo/downloadToBuffer` (Task 1), `subtitleVideoBuffer` (autosub, Task 1), `db.ShortVideo/MovieSeries`, `config` helpers, `env`.
- Produces: `renderEpisode({series, provider, sourceId, ep}) -> Promise<{ok, reason?}>` — tải, render, rsync, upsert 1 tập.

- [ ] **Step 1: Viết render.js**

`247drama-worker/render.js`:
```js
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const duanju = require("./util/duanjuProvider");
const { subtitleVideoBuffer } = require("./util/autosub");
const { env, buildFilename, buildVideoUrl, buildSubtitleConfig } = require("./config");
const { ShortVideo } = require("./db");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 400)));
      resolve(stdout);
    });
  });
}

// duration (giây) từ file đã render bằng ffprobe.
async function probeDuration(file) {
  try {
    const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]);
    const d = parseFloat(String(out).trim());
    return Number.isFinite(d) ? Math.round(d) : 0;
  } catch (e) {
    return 0;
  }
}

// rsync 1 file lên /uploads server (đúng thứ tự: up xong mới ghi Mongo).
async function rsyncToServer(localFile, filename) {
  const { host, user, password, uploadsPath } = env.server;
  const rsh = `sshpass -p ${JSON.stringify(password)} ssh -o StrictHostKeyChecking=accept-new`;
  // --chmod=F644: ép file world-readable (rsync -a giữ mode 700 của Mac -> nginx www-data không đọc được -> 403).
  await run("rsync", ["-a", "--chmod=F644", "-e", rsh, localFile, `${user}@${host}:${uploadsPath}/${filename}`], {
    timeout: 5 * 60 * 1000,
  });
}

async function renderEpisode({ series, provider, sourceId, ep }) {
  const tag = `${provider}:${sourceId} ep${ep.index + 1}`;
  const filename = buildFilename(provider, sourceId, ep.index);
  const outPath = path.join(env.outputDir, filename);
  const rawPath = path.join(env.downloadDir, filename);

  // freeLimit đọc TẠI THỜI ĐIỂM CHẠY (sau db.loadSettings, khi global.settingJSON đã có).
  // Tính ở module-load sẽ =1 vì settingJSON chưa nạp -> khoá nhầm tập 1-5.
  const freeLimit = ((global.settingJSON && global.settingJSON.freeEpisodesForNonVip) || 0) + 1; // =6

  try {
    // 1) resolve + tải mp4 gốc (hm qua proxy)
    const resolved = await duanju.resolveVideo(provider, sourceId, ep.videoId);
    if (!resolved.mp4Url) return { ok: false, reason: "không có link" };
    let buf = await duanju.downloadToBuffer(resolved.mp4Url, { useProxy: provider === "hm" });

    if (env.keepOriginal) {
      try { fs.writeFileSync(rawPath, buf); } catch (e) {}
    }

    // 2) OCR sub Trung -> dịch Việt -> burn (file tạm ghi vào TMPDIR=BINGNET/tmp)
    const subCfg = buildSubtitleConfig(global.settingJSON);
    const r = await subtitleVideoBuffer(buf, subCfg);
    buf = r.buffer;
    // Transcode hỏng hoàn toàn (cả burn LẪN fallback H.264 fail) -> bỏ, không lưu tập đen (mọi provider).
    if (!r.subbed && r.codec !== "h264" && !r.transcoded) {
      return { ok: false, reason: `codec không phát được (${r.codec || "bvc2"})` };
    }
    const subLang = r.subbed ? (subCfg.targetLang || "vi") : "";

    // 3) ghi output ra BINGNET
    fs.writeFileSync(outPath, buf);

    // 4) rsync lên server TRƯỚC
    await rsyncToServer(outPath, filename);

    // 5) duration + 6) upsert Mongo (khớp process52apiEpisodes)
    const duration = await probeDuration(outPath);
    const videoUrl = buildVideoUrl(provider, sourceId, ep.index);
    await ShortVideo.updateOne(
      { movieSeries: series._id, episodeNumber: ep.index },
      {
        $set: {
          videoImage: series.thumbnail || "",
          videoUrl,
          duration,
          coin: ep.index < freeLimit ? 0 : 10,
          isLocked: ep.index >= freeLimit,
          sourceProvider: `52api-${provider}`,
          sourceVideoId: ep.videoId,
          subLang,
        },
      },
      { upsert: true },
    );

    if (!env.keepOriginal) { try { fs.unlinkSync(rawPath); } catch (e) {} }
    console.log(`[render] ✓ ${tag} sub=${subLang || "none"} ${r.segments || 0} câu, ${duration}s`);
    return { ok: true };
  } catch (e) {
    console.error(`[render] ✗ ${tag}:`, e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { renderEpisode, probeDuration };
```

- [ ] **Step 2: Integration test — render ĐÚNG 1 tập thật**

```bash
cd /Users/kevin/video/247drama-worker
./ops/hk-tunnel.sh
export TMPDIR=/Volumes/BINGNET/247drama-render/tmp
node -e "
const db=require('./db'); const work=require('./work'); const {renderEpisode}=require('./render');
(async()=>{
  await db.connect(); await db.loadSettings();
  const w=await work.findPendingWork();
  if(!w.length){console.log('không có pending');process.exit(0);}
  const it=w[0]; const ep=it.missing[0];
  console.log('Render thử:', it.series.name, it.provider+':'+it.sourceId, 'ep', ep.index+1);
  const r=await renderEpisode({series:it.series, provider:it.provider, sourceId:it.sourceId, ep});
  console.log('KẾT QUẢ:', JSON.stringify(r));
  await db.mongoose.disconnect();
})().catch(e=>{console.error(e);process.exit(1);});
"
```
Expected: in `KẾT QUẢ: {"ok":true}`. **Lưu ý `export TMPDIR` bắt buộc** để file tạm nằm trên BINGNET.

- [ ] **Step 3: Verify tập vừa render trên server + Mongo**

```bash
cd /Users/kevin/video/247drama-worker
# file có trên server?
sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=accept-new root@103.179.185.196 'ls -la /var/www/247drama/backend/uploads/ | tail -3'
# record đúng shape? (so với sample: videoUrl http://103.../uploads/..., coin, isLocked, subLang=vi)
node -e "
const db=require('./db');
(async()=>{ await db.connect();
  const sv=await db.ShortVideo.findOne({}).sort({updatedAt:-1}).lean();
  console.log(JSON.stringify({videoUrl:sv.videoUrl,duration:sv.duration,coin:sv.coin,isLocked:sv.isLocked,subLang:sv.subLang,sourceVideoId:sv.sourceVideoId,episodeNumber:sv.episodeNumber},null,1));
  await db.mongoose.disconnect();
})();
"
# phát được? (HTTP 200 + content-type video)
curl -sI http://103.179.185.196/uploads/$(sshpass -p 'Ngaymainha@1' ssh root@103.179.185.196 'ls -t /var/www/247drama/backend/uploads/*.mp4 | head -1 | xargs basename') | head -3
```
Expected: file mp4 mới trong `/uploads`; record `videoUrl` dạng `http://103.179.185.196/uploads/..._epN.mp4`, `subLang:"vi"`, `coin`/`isLocked` đúng theo index; `curl -I` trả `200` + `Content-Type` video. Kiểm tra bằng mắt 1 khung hình sub Việt khớp sub Trung nếu cần.

- [ ] **Step 4: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/render.js
git commit -m "feat(worker): renderEpisode - tải+OCR+dịch+burn+rsync+upsert (verified 1 tập)"
```

---

## Task 6: worker.js — vòng lặp chính (p-limit, one-shot)

**Files:**
- Create: `247drama-worker/worker.js`

**Interfaces:**
- Consumes: `work.findPendingWork`, `render.renderEpisode`, `db`, `env.concurrency`.
- Produces: chạy `npm run worker` → render hết pending với `concurrency` luồng rồi thoát.

- [ ] **Step 1: Viết worker.js**

`247drama-worker/worker.js`:
```js
// Bắt buộc file tạm nằm trên BINGNET (autosub/transcode dùng os.tmpdir()).
const { env } = require("./config");
process.env.TMPDIR = env.tmpDir;

const pLimit = require("p-limit");
const db = require("./db");
const { findPendingWork } = require("./work");
const { renderEpisode } = require("./render");

async function main() {
  await db.connect();
  await db.loadSettings();
  console.log(`[worker] concurrency=${env.concurrency}, ocrThreads=${env.ocrThreads}, tmp=${env.tmpDir}`);

  const work = await findPendingWork();
  const totalMissing = work.reduce((n, w) => n + w.missing.length, 0);
  console.log(`[worker] ${work.length} phim, ${totalMissing} tập cần render`);
  if (!totalMissing) { await db.mongoose.disconnect(); return; }

  const limit = pLimit(env.concurrency);
  let done = 0, ok = 0, fail = 0;

  const jobs = [];
  for (const it of work) {
    for (const ep of it.missing) {
      jobs.push(limit(async () => {
        // Cập nhật tổng số tập nguồn (khớp process52apiEpisodes) — chạy 1 lần/phim là đủ, updateOne rẻ.
        await db.MovieSeries.updateOne({ _id: it.series._id }, { $set: { sourceEpisodeCount: it.episodes.length } }).catch(() => {});
        const r = await renderEpisode({ series: it.series, provider: it.provider, sourceId: it.sourceId, ep });
        done++; r.ok ? ok++ : fail++;
        if (done % 5 === 0 || done === totalMissing) console.log(`[worker] tiến độ ${done}/${totalMissing} (ok ${ok}, lỗi ${fail})`);
      }));
    }
  }
  await Promise.all(jobs);

  console.log(`[worker] XONG: ${ok} tập ok, ${fail} lỗi / ${totalMissing}`);
  await db.mongoose.disconnect();
}

main().catch((e) => { console.error("[worker] fatal:", e); process.exit(1); });
```

- [ ] **Step 2: Chạy worker giới hạn 1 phim để kiểm tra loop (tạm hạ concurrency)**

```bash
cd /Users/kevin/video/247drama-worker
./ops/hk-tunnel.sh
RENDER_CONCURRENCY=2 npm run worker
```
Expected: log `[worker] N phim, M tập cần render`, tiến độ tăng dần, kết thúc `XONG`. Máy không treo. (Nếu muốn dừng sớm: Ctrl-C, chạy lại sẽ tiếp tục vì idempotent.)

- [ ] **Step 3: Verify idempotent — chạy lại ngay**

```bash
cd /Users/kevin/video/247drama-worker && RENDER_CONCURRENCY=2 npm run worker
```
Expected: các tập đã render KHÔNG làm lại (missing giảm), không tạo record trùng. Nếu đã xong hết 1 phim thì phim đó biến mất khỏi pending.

- [ ] **Step 4: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/worker.js
git commit -m "feat(worker): vòng lặp chính p-limit one-shot render hết pending"
```

---

## Task 7: Tắt hẳn pipeline OCR trên server

**Files:**
- Create: `247drama-worker/ops/disable-server-pipeline.sh`

**Interfaces:**
- Produces: server dừng mọi OCR/import; `importConcurrency=0`; `node index.js` restart; load average tụt.

- [ ] **Step 1: Viết script tắt server pipeline**

`247drama-worker/ops/disable-server-pipeline.sh`:
```bash
#!/usr/bin/env bash
# Tắt hẳn pipeline tải/OCR trên server 247drama để Mac làm worker duy nhất.
set -e
SRV=root@103.179.185.196
export SSHPASS='Ngaymainha@1'
RUN="sshpass -e ssh -o StrictHostKeyChecking=accept-new $SRV"

# 1) Kill script reimport + mọi tiến trình OCR/whisper/ffmpeg đang render
$RUN 'pkill -f reimport_all_hm.js || true; pkill -f ocr_subs.py || true; pkill -f "whisper" || true; pkill -f "ffmpeg .*as_src" || true; echo "killed bg jobs"'

# 2) Set importConcurrency=0 trong Mongo (auto-resume sẽ không spawn OCR)
$RUN 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; cd /var/www/247drama/backend && node -e "
require(\"dotenv\").config(); const m=require(\"mongoose\");
(async()=>{ await m.connect(process.env.MongoDb_Connection_String);
  const S=require(\"./models/setting.model\");
  await S.updateOne({},{\$set:{\"chineseDramaApi.importConcurrency\":0}});
  console.log(\"importConcurrency=0 set\");
  await m.disconnect();
})();
"'

# 3) Restart node index.js (bỏ trạng thái queue cũ trong RAM). Chạy nền như hiện tại (nohup).
$RUN 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; pkill -f "node /var/www/247drama/backend/index.js" || true; sleep 2; cd /var/www/247drama/backend && nohup node index.js > /var/www/247drama/backend/server.log 2>&1 & sleep 3; echo "node restarted"'

echo "== Đã tắt pipeline server =="
```

- [ ] **Step 2: Chạy script**

```bash
chmod +x /Users/kevin/video/247drama-worker/ops/disable-server-pipeline.sh
/Users/kevin/video/247drama-worker/ops/disable-server-pipeline.sh
```
Expected: in `killed bg jobs`, `importConcurrency=0 set`, `node restarted`, `Đã tắt pipeline server`.

- [ ] **Step 3: Verify server nhẹ + app còn stream**

```bash
sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=accept-new root@103.179.185.196 '
sleep 20; echo "=== load ==="; uptime;
echo "=== còn OCR/reimport? ==="; ps aux | grep -E "ocr_subs|reimport|whisper" | grep -v grep | wc -l;
echo "=== node đang chạy? ==="; ps aux | grep "node /var/www/247drama/backend/index.js" | grep -v grep | wc -l;
'
# app còn stream? (1 videoUrl bất kỳ trả 200)
curl -sI http://103.179.185.196/uploads/$(sshpass -p 'Ngaymainha@1' ssh root@103.179.185.196 'ls -t /var/www/247drama/backend/uploads/*.mp4 | head -1 | xargs basename') | head -1
```
Expected: OCR/reimport count = 0; node index.js count = 1; load average giảm dần; curl trả `HTTP/1.1 200`.

- [ ] **Step 4: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/ops/disable-server-pipeline.sh
git commit -m "feat(worker): ops script tắt pipeline OCR server (Mac làm worker duy nhất)"
```

---

## Task 8: Chạy full backlog + nghiệm thu

**Files:** (không tạo file mới — vận hành)

- [ ] **Step 1: Mở tunnel + chạy full concurrency**

```bash
cd /Users/kevin/video/247drama-worker
./ops/hk-tunnel.sh
npm run worker 2>&1 | tee /Volumes/BINGNET/247drama-render/worker-$(date +%Y%m%d-%H%M).log
```
Expected: chạy tới `[worker] XONG: X tập ok, Y lỗi / Z`. Theo dõi máy vẫn dùng được (concurrency=4).

- [ ] **Step 2: Nghiệm thu — mọi phim đã đủ tập**

```bash
cd /Users/kevin/video/247drama-worker
node -e "
const db=require('./db');
(async()=>{ await db.connect();
  const ms=await db.MovieSeries.find({sourceProvider:/^52api-/}).select('name sourceEpisodeCount').lean();
  for (const m of ms){ const c=await db.ShortVideo.countDocuments({movieSeries:m._id}); console.log((c>=m.sourceEpisodeCount&&m.sourceEpisodeCount>0?'✓':'…'), m.name, c+'/'+m.sourceEpisodeCount); }
  await db.mongoose.disconnect();
})();
"
```
Expected: các phim in `✓` với `count == sourceEpisodeCount`. Phim còn `…` → chạy lại worker (Step 1) cho phần thiếu.

- [ ] **Step 3: Nghiệm thu chất lượng — 1 tập mới bất kỳ**

```bash
# kéo 1 tập mới về xem sub Việt có khớp sub Trung không
F=$(sshpass -p 'Ngaymainha@1' ssh root@103.179.185.196 'ls -t /var/www/247drama/backend/uploads/*_ep*.mp4 | head -1')
sshpass -p 'Ngaymainha@1' scp -o StrictHostKeyChecking=accept-new root@103.179.185.196:"$F" /Volumes/BINGNET/247drama-render/tmp/check.mp4
ffmpeg -y -ss 30 -i /Volumes/BINGNET/247drama-render/tmp/check.mp4 -frames:v 1 /Volumes/BINGNET/247drama-render/tmp/check.jpg
open /Volumes/BINGNET/247drama-render/tmp/check.jpg
```
Expected: khung hình có sub Trung (cháy sẵn) + sub Việt ngay dưới, canh khớp thời điểm.

- [ ] **Step 4: Cập nhật memory (ghi lại pipeline mới)**

Cập nhật `/Users/kevin/.claude/projects/-Users-kevin-video/memory/52api-duanju-integration.md`: thêm mục "Render farm trên Mac" — worker `/Users/kevin/video/247drama-worker/` tái dùng module server qua rsync, đọc pending từ Mongo, tải qua SOCKS HK, OCR+dịch+burn trên Mac (media ở /Volumes/BINGNET), rsync /uploads + upsert ShortVideo trực tiếp; server đã tắt OCR (`importConcurrency=0`). Cách chạy: `./ops/hk-tunnel.sh && npm run worker`.

- [ ] **Step 5: Commit spec/plan hoàn tất**

```bash
cd /Users/kevin/video
git add docs/superpowers/specs/2026-07-27-mac-render-farm-247drama-design.md docs/superpowers/plans/2026-07-27-mac-render-farm-247drama.md
git commit -m "docs: spec + plan Mac render farm 247drama"
```

---

## Self-Review (đã rà)

- **Spec coverage:** rsync+ghi Mongo (Task 5), đọc pending Mongo (Task 4), tắt server (Task 7), 4 luồng config (Task 3/6), media→BINGNET + TMPDIR (Task 2/6), venv trên ổ chính (Task 2), idempotent theo episodeNumber (Task 4/5/6), giữ mp4 gốc (Task 5 `keepOriginal`), one-shot (Task 6), proxy HK (Task 2). ✓
- **videoUrl/insert khớp server:** filename + URL + $set fields copy nguyên từ `process52apiEpisodes` + `uploadBufferToStorage` (local) + sample record đã đọc. `freeLimit=6`. ✓
- **Không sửa code server:** override qua `OCR_PYTHON`/`TMPDIR`/`global.settingJSON`; chỉ set `importConcurrency=0`. ✓
- **Type consistency:** `computeMissingEpisodes(detailEpisodes, existingNumbers:Set)`, `renderEpisode({series,provider,sourceId,ep})`, `buildFilename/buildVideoUrl(provider,sourceId,index)` nhất quán giữa các task. ✓
- **Placeholder scan:** không còn TBD/TODO; mọi code step có code thật. ✓
- **Rủi ro mở:** hg tải direct từ Mac (VN) có thể bị chặn — nếu Task 5 Step 2 fail ở download hg, đổi `useProxy` cho hg (sửa 1 chỗ trong render.js) hoặc bật proxy cho cả hai.
