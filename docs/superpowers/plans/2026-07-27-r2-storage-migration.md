# R2 Storage Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Chuyển lưu trữ video 247drama từ server local (`/uploads`) sang Cloudflare R2; Mac worker up thẳng R2; backfill 8.3GB hiện có; giải phóng server.

**Architecture:** R2 tương thích S3 → tái dùng `@aws-sdk/client-s3`. Mac worker thay `rsyncToServer` bằng `uploadToR2`, `videoUrl` = `${R2_PUBLIC_BASE}/videos/<filename>`. Script backfill chạy trên server đẩy mp4 cũ lên R2 + rewrite Mongo. Server Setting slot `awsS3` trỏ R2.

**Tech Stack:** Node.js, `@aws-sdk/client-s3`, Mongoose, Cloudflare R2, `node --test`.

## Global Constraints

- **Key scheme (bất biến):** `videos/<provider>_<sourceId>_ep<index>.mp4`. Server + worker dùng CHUNG. Prefix từ `R2_KEY_PREFIX` (mặc định `videos`).
- **Public URL:** `${R2_PUBLIC_BASE}/videos/<filename>` (R2_PUBLIC_BASE = `https://pub-<hash>.r2.dev`, chưa có domain).
- **Object metadata:** `ContentType: "video/mp4"`, `CacheControl: "public, max-age=31536000, immutable"`.
- **S3 client R2:** `region: "auto"`, `endpoint: R2_ENDPOINT`, `forcePathStyle: true`, credentials từ `R2_ACCESS_KEY`/`R2_SECRET`. **KHÔNG** set ACL (R2 public ở cấp bucket).
- **Filename builder giữ nguyên:** `buildFilename(provider,sourceId,index)` = `<provider>_<sourceId>_ep<index>.mp4`.
- **Creds chỉ trong `.env` (gitignored) + Mongo Setting** — không commit.
- Env worker: `R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET, R2_BUCKET, R2_PUBLIC_BASE, R2_KEY_PREFIX=videos`.
- Test runner: `npm test` (`node --test`), test files ở `test/*.test.js`.

---

### Task 1: Worker — R2 key + URL builders trong config.js

**Files:**
- Modify: `247drama-worker/config.js`
- Modify: `247drama-worker/test/config.test.js`
- Modify: `247drama-worker/package.json` (thêm dep)

**Interfaces:**
- Produces: `buildR2Key(provider, sourceId, index) -> "videos/<provider>_<sourceId>_ep<index>.mp4"`; `buildVideoUrl(provider, sourceId, index) -> "${R2_PUBLIC_BASE}/videos/<filename>"`; `env.r2 = {endpoint, accessKey, secret, bucket, publicBase, keyPrefix}`.
- Consumes (sau này): `util/r2.js` dùng `env.r2`; `render.js` dùng `buildR2Key`.

- [ ] **Step 1: Sửa test cho builders mới**

Trong `test/config.test.js`, thay test `buildVideoUrl` cũ (đang expect `/uploads`) và thêm test `buildR2Key`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { buildFilename, buildR2Key, buildVideoUrl } = require("../config");

test("buildFilename khớp format server", () => {
  assert.strictEqual(buildFilename("hg", "7661582233639062553", 58), "hg_7661582233639062553_ep58.mp4");
  assert.strictEqual(buildFilename("hm", "12345", 0), "hm_12345_ep0.mp4");
});

test("buildR2Key = prefix + filename", () => {
  process.env.R2_KEY_PREFIX = "videos";
  assert.strictEqual(buildR2Key("hg", "7661582233639062553", 58), "videos/hg_7661582233639062553_ep58.mp4");
});

test("buildVideoUrl trỏ R2 public base", () => {
  process.env.R2_KEY_PREFIX = "videos";
  process.env.R2_PUBLIC_BASE = "https://pub-abc123.r2.dev";
  assert.strictEqual(
    buildVideoUrl("hg", "7661582233639062553", 58),
    "https://pub-abc123.r2.dev/videos/hg_7661582233639062553_ep58.mp4",
  );
});
```

- [ ] **Step 2: Chạy test — fail**

Run: `cd 247drama-worker && npm test`
Expected: FAIL (`buildR2Key` chưa export; `buildVideoUrl` trả URL cũ).

- [ ] **Step 3: Sửa config.js**

Thêm block `r2` vào `env` (sau `server`):

```js
  r2: {
    endpoint: process.env.R2_ENDPOINT,
    accessKey: process.env.R2_ACCESS_KEY,
    secret: process.env.R2_SECRET,
    bucket: process.env.R2_BUCKET,
    publicBase: process.env.R2_PUBLIC_BASE,
    keyPrefix: process.env.R2_KEY_PREFIX || "videos",
  },
```

Thêm `buildR2Key` và sửa `buildVideoUrl`:

```js
// Key trên R2: <prefix>/<filename>. Server + worker dùng chung scheme.
function buildR2Key(provider, sourceId, index) {
  const prefix = process.env.R2_KEY_PREFIX || "videos";
  return `${prefix}/${buildFilename(provider, sourceId, index)}`;
}

// URL công khai đọc từ R2 (r2.dev hoặc custom domain).
function buildVideoUrl(provider, sourceId, index) {
  const base = process.env.R2_PUBLIC_BASE || env.r2.publicBase || "";
  return `${base}/${buildR2Key(provider, sourceId, index)}`;
}
```

Cập nhật `module.exports`: thêm `buildR2Key`.

- [ ] **Step 4: Thêm dep aws-sdk**

Trong `package.json` `dependencies`, thêm `"@aws-sdk/client-s3": "^3.600.0"`. Run: `cd 247drama-worker && npm install`.

- [ ] **Step 5: Chạy test — pass**

Run: `cd 247drama-worker && npm test`
Expected: PASS toàn bộ.

- [ ] **Step 6: Commit**

```bash
git add config.js test/config.test.js package.json package-lock.json
git commit -m "feat(r2): key + URL builders trỏ R2 public base"
```

---

### Task 2: Worker — util/r2.js (uploadToR2)

**Files:**
- Create: `247drama-worker/util/r2.js`
- Create: `247drama-worker/test/r2.test.js`

**Interfaces:**
- Consumes: `env.r2` từ config.
- Produces: `r2Client()` -> S3 client cấu hình R2; `uploadToR2(buffer, key, contentType)` -> Promise (PUT object).

- [ ] **Step 1: Viết test cấu hình client**

`test/r2.test.js` (test phần thuần: cấu hình client đúng, không gọi mạng):

```js
const { test } = require("node:test");
const assert = require("node:assert");

test("r2Client cấu hình đúng cho R2", async () => {
  process.env.R2_ENDPOINT = "https://acc.r2.cloudflarestorage.com";
  process.env.R2_ACCESS_KEY = "ak";
  process.env.R2_SECRET = "sk";
  process.env.R2_BUCKET = "bk";
  delete require.cache[require.resolve("../config")];
  delete require.cache[require.resolve("../util/r2")];
  const { r2Client } = require("../util/r2");
  const c = r2Client();
  const cfg = c.config;
  assert.strictEqual(await cfg.region(), "auto");
  assert.strictEqual(cfg.forcePathStyle, true);
  const ep = await cfg.endpoint();
  assert.strictEqual(ep.hostname, "acc.r2.cloudflarestorage.com");
});
```

- [ ] **Step 2: Chạy test — fail**

Run: `cd 247drama-worker && npm test`
Expected: FAIL (`util/r2` chưa tồn tại).

- [ ] **Step 3: Viết util/r2.js**

```js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { env } = require("../config");

// S3 client trỏ R2 (region auto, path-style, endpoint R2).
function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: env.r2.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: env.r2.accessKey, secretAccessKey: env.r2.secret },
  });
}

// Upload buffer lên R2. Cache dài vì key cố định theo tập.
async function uploadToR2(buffer, key, contentType) {
  const client = r2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

module.exports = { r2Client, uploadToR2 };
```

- [ ] **Step 4: Chạy test — pass**

Run: `cd 247drama-worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add util/r2.js test/r2.test.js
git commit -m "feat(r2): uploadToR2 + r2Client"
```

---

### Task 3: Worker — render.js up R2 thay rsync

**Files:**
- Modify: `247drama-worker/render.js`

**Interfaces:**
- Consumes: `uploadToR2` (Task 2), `buildR2Key` (Task 1).

- [ ] **Step 1: Sửa import + phase upload**

Đầu file, thêm import:
```js
const { uploadToR2 } = require("./util/r2");
```
Cập nhật destructuring config để lấy `buildR2Key`:
```js
const { env, buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig } = require("./config");
```

- [ ] **Step 2: Thay khối upload (bước 4 trong renderEpisodeInner)**

Thay:
```js
    // 4) rsync lên server TRƯỚC
    status.setPhase(tag, "upload");
    await rsyncToServer(outPath, filename);
```
bằng:
```js
    // 4) upload thẳng R2 (bỏ rsync server)
    status.setPhase(tag, "upload");
    await uploadToR2(buf, buildR2Key(provider, sourceId, ep.index), "video/mp4");
```

- [ ] **Step 3: Xoá hàm rsyncToServer + import thừa**

Xoá cả hàm `rsyncToServer` (dòng ~31-43) không còn dùng. Giữ `probeDuration`, `run` (vẫn dùng cho ffprobe).

- [ ] **Step 4: Kiểm tra không còn tham chiếu rsync video**

Run: `cd 247drama-worker && grep -n "rsyncToServer" render.js`
Expected: KHÔNG có kết quả.

- [ ] **Step 5: Smoke require (không crash)**

Run: `cd 247drama-worker && node -e "require('./render.js'); console.log('render.js OK')"`
Expected: in `render.js OK`.

- [ ] **Step 6: Commit**

```bash
git add render.js
git commit -m "feat(r2): render.js up video thẳng R2, bỏ rsync"
```

---

### Task 4: Smoke test — PUT 1 object lên R2 + verify (ops)

**Prereq:** `.env` đã có đủ R2 creds; Public Development URL đã Enable trên bucket.

- [ ] **Step 1: Điền creds vào .env** (controller làm, không commit): `R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET, R2_BUCKET, R2_PUBLIC_BASE, R2_KEY_PREFIX=videos`.

- [ ] **Step 2: PUT object test**

```bash
cd 247drama-worker && node -e '
const { uploadToR2 } = require("./util/r2");
const { env } = require("./config");
uploadToR2(Buffer.from("hello r2"), "videos/_smoke.txt", "text/plain")
  .then(() => console.log("PUT ok ->", env.r2.publicBase + "/videos/_smoke.txt"))
  .catch(e => { console.error("PUT fail:", e.message); process.exit(1); });
'
```
Expected: `PUT ok -> https://pub-....r2.dev/videos/_smoke.txt`.

- [ ] **Step 3: Verify công khai đọc được**

Run: `curl -sI "$(grep R2_PUBLIC_BASE .env | cut -d= -f2)/videos/_smoke.txt"`
Expected: `HTTP/... 200`, `content-type: text/plain`.
(Nếu 401/403 → Public Development URL chưa Enable → dừng, báo user.)

- [ ] **Step 4: Dọn object test**: xoá `_smoke.txt` (qua dashboard hoặc DeleteObjectCommand). Không commit gì.

---

### Task 5: Server — scripts/backfill-r2.js (resumable + rewrite Mongo)

**Files:**
- Create: `247drama-worker/scripts/backfill-r2.js` (rồi rsync sang server để chạy)
- Create: `247drama-worker/test/backfill-rewrite.test.js`

**Interfaces:**
- Produces: `rewriteUploadsUrl(url, r2PublicBase, keyPrefix) -> string` (thuần); main() backfill.

- [ ] **Step 1: Test hàm rewrite URL (thuần)**

`test/backfill-rewrite.test.js`:
```js
const { test } = require("node:test");
const assert = require("node:assert");
const { rewriteUploadsUrl } = require("../scripts/backfill-r2");

test("rewrite /uploads -> r2 giữ nguyên filename", () => {
  assert.strictEqual(
    rewriteUploadsUrl("http://103.179.185.196/uploads/hg_123_ep5.mp4", "https://pub-x.r2.dev", "videos"),
    "https://pub-x.r2.dev/videos/hg_123_ep5.mp4",
  );
});
test("URL không phải /uploads -> giữ nguyên", () => {
  assert.strictEqual(
    rewriteUploadsUrl("https://pub-x.r2.dev/videos/hg_123_ep5.mp4", "https://pub-x.r2.dev", "videos"),
    "https://pub-x.r2.dev/videos/hg_123_ep5.mp4",
  );
});
```

- [ ] **Step 2: Chạy test — fail**

Run: `cd 247drama-worker && npm test`
Expected: FAIL (module chưa có).

- [ ] **Step 3: Viết scripts/backfill-r2.js**

```js
// Chạy TRÊN SERVER (/var/www/247drama/backend): đẩy uploads/*.mp4 lên R2 + rewrite Mongo.
// Resumable: HEAD trước, đã có thì skip. Đọc R2 creds + Mongo từ env/.env server.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const mongoose = require("mongoose");

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE;
const KEY_PREFIX = process.env.R2_KEY_PREFIX || "videos";
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(__dirname, "../uploads");
const OLD_BASE = process.env.OLD_UPLOADS_BASE || "http://103.179.185.196/uploads";

function rewriteUploadsUrl(url, r2PublicBase, keyPrefix) {
  if (!url || !url.includes("/uploads/")) return url;
  const name = url.split("/uploads/").pop();
  return `${r2PublicBase}/${keyPrefix}/${name}`;
}

function client() {
  return new S3Client({
    region: "auto", endpoint: R2_ENDPOINT, forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET },
  });
}

async function existsOnR2(c, key) {
  try { await c.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })); return true; }
  catch { return false; }
}

async function main() {
  const dry = process.argv.includes("--dry");
  const c = client();
  const files = fs.readdirSync(UPLOADS_DIR).filter((f) => f.endsWith(".mp4"));
  console.log(`[backfill] ${files.length} mp4 trong ${UPLOADS_DIR} (dry=${dry})`);
  let put = 0, skip = 0, fail = 0;
  for (const f of files) {
    const key = `${KEY_PREFIX}/${f}`;
    try {
      if (await existsOnR2(c, key)) { skip++; continue; }
      if (!dry) {
        const body = fs.readFileSync(path.join(UPLOADS_DIR, f));
        await c.send(new PutObjectCommand({
          Bucket: R2_BUCKET, Key: key, Body: body, ContentType: "video/mp4",
          CacheControl: "public, max-age=31536000, immutable",
        }));
      }
      put++;
      if (put % 20 === 0) console.log(`[backfill] đã put ${put} (skip ${skip})`);
    } catch (e) { fail++; console.error(`[backfill] fail ${f}:`, e.message); }
  }
  console.log(`[backfill] xong PUT: put=${put} skip=${skip} fail=${fail}`);

  // Rewrite Mongo videoUrl cho mọi tập còn trỏ /uploads.
  await mongoose.connect(process.env.MongoDb_Connection_String);
  const ShortVideo = mongoose.model("ShortVideo", new mongoose.Schema({}, { strict: false }), "shortvideos");
  const cur = ShortVideo.find({ videoUrl: new RegExp("/uploads/") }).cursor();
  let rew = 0;
  for (let d = await cur.next(); d; d = await cur.next()) {
    const nu = rewriteUploadsUrl(d.videoUrl, R2_PUBLIC_BASE, KEY_PREFIX);
    if (nu !== d.videoUrl) { if (!dry) await ShortVideo.updateOne({ _id: d._id }, { $set: { videoUrl: nu } }); rew++; }
  }
  console.log(`[backfill] rewrite videoUrl: ${rew} bản ghi`);
  await mongoose.disconnect();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { rewriteUploadsUrl };
```

> Lưu ý: collection name `shortvideos` cần khớp Mongo thật (kiểm tra trước khi chạy). Nếu khác, sửa tham số cuối `mongoose.model(...)`.

- [ ] **Step 4: Chạy test — pass**

Run: `cd 247drama-worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-r2.js test/backfill-rewrite.test.js
git commit -m "feat(r2): script backfill uploads->R2 + rewrite Mongo (resumable)"
```

---

### Task 6: Chạy backfill trên server + verify + xoá local (ops)

- [ ] **Step 1: Xác minh collection name** trên Mongo (`shortvideos`?) và số bản ghi videoUrl `/uploads`.
- [ ] **Step 2: Cài dep + đưa script + creds lên server**: đảm bảo `@aws-sdk/client-s3` có trên server (đã có — storageHelper dùng); rsync `scripts/backfill-r2.js` sang `/var/www/247drama/backend/scripts/`; set R2 env cho tiến trình (không ghi vào .env app nếu muốn tách; hoặc thêm R2_* vào .env server).
- [ ] **Step 3: Dry-run**: `node scripts/backfill-r2.js --dry` → xem số file + số bản ghi sẽ đổi. Kiểm tra hợp lý.
- [ ] **Step 4: Chạy thật**: `node scripts/backfill-r2.js` → theo dõi put/skip/fail = 0.
- [ ] **Step 5: Verify N=5 mẫu**: lấy 5 `videoUrl` mới → `curl -I` trả 200 + `content-type: video/mp4` + `accept-ranges: bytes`; mở 1 tập trong app → phát + tua được.
- [ ] **Step 6: Xoá mp4 local** (giữ dashboard + ảnh): `find /var/www/247drama/backend/uploads -maxdepth 1 -name '*.mp4' -delete`. Kiểm tra `du -sh uploads` giảm mạnh; app vẫn phát (chứng minh đã rời server).

---

### Task 7: Server Setting = R2 + CORS (ops)

- [ ] **Step 1: Set CORS bucket** (dashboard R2 hoặc PutBucketCors): cho `GET, HEAD`, `AllowedOrigins: ["*"]` (phòng web player).
- [ ] **Step 2: Cập nhật Setting Mongo**: `storage.awsS3=true`, `storage.local=false`, `awsHostname=<R2_ENDPOINT>`, `awsRegion="auto"`, `awsAccessKey/awsSecretKey=<token>`, `awsBucketName=<bucket>`, `awsEndpoint=<R2_PUBLIC_BASE>`. (Reload settingJSON: restart app hoặc endpoint reload.)
- [ ] **Step 3: Verify upload server-side** (nếu tiện): admin upload 1 ảnh test → URL trả về trỏ R2 + đọc được. (Không bắt buộc nếu không dùng upload server.)

---

### Task 8: Restart worker → tập mới lên R2 + acceptance (ops)

- [ ] **Step 1: Restart worker**: `kill <PID>`; `nohup node worker.js > /Volumes/BINGNET/247drama-render/worker.log 2>&1 &`.
- [ ] **Step 2: Xác nhận 1 tập MỚI**: log `[render] ✓ ...`; lấy `videoUrl` tập đó từ Mongo → trỏ `r2.dev` → `curl -I` 200 → phát trong app.
- [ ] **Step 3: Acceptance**: dashboard chạy bình thường; không còn mp4 mới nào ghi vào server `/uploads`; server disk ổn định.
- [ ] **Step 4: Cập nhật memory** `mac-render-farm-247drama.md` + tạo memory R2 (endpoint, bucket, public base, key scheme, cách đổi domain sau).

---

## Rủi ro / lưu ý
- ⚠️ **r2.dev rate-limit** — production nặng nên mua domain sớm; đổi = `R2_PUBLIC_BASE`/`awsEndpoint` + `updateMany` prefix.
- Backfill **resumable** (HEAD skip) — chạy lại an toàn.
- Giữ mp4 local tới khi verify R2 mới xoá.
- Creds **không commit** (repo này có lịch sử creds cũ — không push remote).
