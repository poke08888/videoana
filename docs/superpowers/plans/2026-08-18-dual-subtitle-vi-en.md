# Phụ đề song song vi/en — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tập render từ nay có 1 video sạch + 2 track phụ đề WebVTT (vi/en) trên R2, backend chọn track mặc định theo IP người xem.

**Architecture:** Worker Mac (`/Users/kevin/video/247drama-worker`, CommonJS, node:test) thêm nhánh `mode: "soft"`: dịch `zhSegs` sang vi và en song song, encode chỉ `drawbox` (không đốt chữ), up 2 file `.vtt` cạnh `.mp4`. Backend Express trên `103.179.185.196` (KHÔNG phải git repo — sửa qua bản mirror local rồi rsync) thêm `subTracks`/`burnedLang` vào model và `subDefault` theo geoip vào 3 API client.

**Tech Stack:** Node 20 CommonJS · `node --test` · ffmpeg/libass · Gemini `gemini-2.5-flash` · Cloudflare R2 (S3 SDK) · MongoDB/Mongoose · `geoip-lite` · pm2 (4 instance cluster tên `backend`)

**Spec:** `docs/superpowers/specs/2026-08-18-dual-subtitle-vi-en-design.md`

## Global Constraints

- Repo worker: `/Users/kevin/video`, nhánh `feat/mac-render-farm`. Commit sau mỗi task.
- Không đổi tham số encode hiện tại: `libx264 -preset veryfast -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart`.
- `mode` mặc định là `"burn"`. Khi `mode !== "soft"`, mọi hành vi hiện tại phải giữ nguyên từng chi tiết.
- 3.936 tập cũ không bị re-render; chỉ được `$set` thêm `burnedLang: "vi"`.
- Comment code viết tiếng Việt, khớp phong cách các file hiện có.
- Backend không có git và không có test runner cấu hình sẵn: dùng `node --test` trực tiếp, backup file trước khi ghi đè trên server.
- Giai đoạn app (đọc `subTracks`/`subDefault`/`burnedLang`) KHÔNG nằm trong plan này — chưa có đường dẫn source app. Task 8 dừng ở chỗ kiểm chứng API trả đúng dữ liệu.

---

### Task 1: `util/vtt.js` — chuyển segments sang WebVTT

**Files:**
- Create: `/Users/kevin/video/247drama-worker/util/vtt.js`
- Test: `/Users/kevin/video/247drama-worker/test/vtt.test.js`

**Interfaces:**
- Consumes: không có.
- Produces: `segsToVtt(segments, opts)` → `string`. `segments`: `[{start:number, end:number, text:string}]` (giây). `opts.offsetSec`: số giây cộng vào mọi mốc thời gian (mặc định 0). Mảng rỗng/không có dòng hợp lệ → trả `""`.

- [ ] **Step 1: Viết test trước**

Tạo `test/vtt.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { segsToVtt } = require("../util/vtt");

test("sinh header WEBVTT + timestamp đúng định dạng", () => {
  const out = segsToVtt([{ start: 0, end: 1.5, text: "Xin chào" }]);
  assert.strictEqual(out, "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nXin chào\n");
});

test("giờ/phút/giây > 60 quy đổi đúng", () => {
  const out = segsToVtt([{ start: 3661.25, end: 3662, text: "A" }]);
  assert.ok(out.includes("01:01:01.250 --> 01:01:02.000"), out);
});

test("offsetSec dịch toàn bộ mốc thời gian", () => {
  const out = segsToVtt([{ start: 1, end: 2, text: "A" }], { offsetSec: 0.5 });
  assert.ok(out.includes("00:00:01.500 --> 00:00:02.500"), out);
});

test("mốc âm sau khi dịch bị kẹp về 0", () => {
  const out = segsToVtt([{ start: 0.2, end: 1, text: "A" }], { offsetSec: -1 });
  assert.ok(out.includes("00:00:00.000 --> 00:00:00.000"), out);
});

test("bỏ dòng rỗng, giữ dòng có chữ", () => {
  const out = segsToVtt([
    { start: 0, end: 1, text: "  " },
    { start: 1, end: 2, text: "Có chữ" },
  ]);
  assert.ok(!out.includes("00:00:00.000 --> 00:00:01.000"), out);
  assert.ok(out.includes("Có chữ"), out);
});

test("mảng rỗng trả chuỗi rỗng", () => {
  assert.strictEqual(segsToVtt([]), "");
  assert.strictEqual(segsToVtt(null), "");
});

test("xuống dòng trong text giữ nguyên, dòng trắng bị gộp", () => {
  const out = segsToVtt([{ start: 0, end: 1, text: "Dòng 1\n\nDòng 2" }]);
  assert.ok(out.includes("Dòng 1\nDòng 2"), out);
});
```

- [ ] **Step 2: Chạy test cho thấy fail**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/vtt.test.js`
Expected: FAIL — `Cannot find module '../util/vtt'`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `util/vtt.js`:

```js
// Chuyển segment phụ đề ({start,end,text} theo giây) sang WebVTT để player nạp làm
// track ngoài. Dùng chung cho cả track vi lẫn en; timing lấy y hệt bản burn (buildAss)
// nên hai đường soft/burn không lệch nhau.

function vttTime(sec) {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

/**
 * segments: [{start,end,text}] (giây). offsetSec: dịch thời gian (giống subStartOffsetMs).
 * Trả chuỗi WebVTT, hoặc "" nếu không còn dòng nào có chữ.
 */
function segsToVtt(segments, opts = {}) {
  const offset = typeof opts.offsetSec === "number" ? opts.offsetSec : 0;
  const cues = (segments || [])
    .filter((s) => s && s.text && String(s.text).trim())
    .map((s) => {
      const text = String(s.text)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
      return `${vttTime(s.start + offset)} --> ${vttTime(s.end + offset)}\n${text}\n`;
    });
  if (!cues.length) return "";
  return `WEBVTT\n\n${cues.join("\n")}`;
}

module.exports = { segsToVtt };
```

- [ ] **Step 4: Chạy test cho thấy pass**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/vtt.test.js`
Expected: PASS — `# pass 7`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/util/vtt.js 247drama-worker/test/vtt.test.js
git commit -m "feat(worker): segsToVtt - xuất phụ đề WebVTT"
```

---

### Task 2: `transcodeCleanBox` — encode video sạch (chỉ che sub Trung)

**Files:**
- Modify: `/Users/kevin/video/247drama-worker/util/transcode.js` (thêm hàm mới, giữ nguyên `transcodeBurnSub`)
- Test: `/Users/kevin/video/247drama-worker/test/transcode.test.js`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `buildBoxFilter(box)` → `string`. `box`: `{yRatio, heightRatio, color, enabled}`. Trả chuỗi filter `drawbox=...` kết thúc bằng `,` để nối thêm filter phía sau; `enabled === false` → `""`.
  - `transcodeCleanBox(srcPath, box)` → `Promise<Buffer>` — encode H.264 chỉ che dải đáy, không phụ đề. Ném lỗi nếu ffmpeg ra file rỗng.

- [ ] **Step 1: Viết test trước**

Tạo `test/transcode.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { buildBoxFilter } = require("../util/transcode");

test("mặc định che dải đáy từ 0.66, cao 0.17, màu trắng", () => {
  assert.strictEqual(
    buildBoxFilter({}),
    "drawbox=x=0:y=ih*0.66:w=iw:h=ih*0.17:color=white@1:t=fill,",
  );
});

test("nhận yRatio/heightRatio/color tuỳ chỉnh", () => {
  assert.strictEqual(
    buildBoxFilter({ yRatio: 0.7, heightRatio: 0.2, color: "black@1" }),
    "drawbox=x=0:y=ih*0.7:w=iw:h=ih*0.2:color=black@1:t=fill,",
  );
});

test("enabled=false -> không che gì", () => {
  assert.strictEqual(buildBoxFilter({ enabled: false }), "");
});
```

- [ ] **Step 2: Chạy test cho thấy fail**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/transcode.test.js`
Expected: FAIL — `buildBoxFilter is not a function`

- [ ] **Step 3: Sửa `util/transcode.js`**

Trong `transcodeBurnSub`, thay đoạn tính `drawbox` hiện tại:

```js
  const drawbox = box.enabled === false ? "" : `drawbox=x=0:y=ih*${y}:w=iw:h=ih*${h}:color=${color}:t=fill,`;
  const vf = `${drawbox}ass=${assPath}`;
```

bằng:

```js
  const vf = `${buildBoxFilter(box)}ass=${assPath}`;
```

(Hai dòng khai báo `const y`, `const h`, `const color` ở đầu `transcodeBurnSub` giờ không còn dùng — xoá luôn.)

Thêm trước `module.exports`:

```js
/**
 * Chuỗi filter che dải sub Trung ở đáy. Kết thúc bằng "," để nối filter sau (ass=...).
 * box.enabled=false -> không che.
 */
function buildBoxFilter(box = {}) {
  if (box.enabled === false) return "";
  const y = typeof box.yRatio === "number" ? box.yRatio : 0.66;
  const h = typeof box.heightRatio === "number" ? box.heightRatio : 0.17;
  const color = box.color || "white@1";
  return `drawbox=x=0:y=ih*${y}:w=iw:h=ih*${h}:color=${color}:t=fill,`;
}

/**
 * Encode H.264 chỉ CHE sub Trung, KHÔNG đốt phụ đề (chế độ soft-sub: phụ đề đi kèm
 * file .vtt riêng). Tham số encode giữ y hệt transcodeBurnSub để chất lượng/dung lượng
 * không đổi giữa hai chế độ.
 */
async function transcodeCleanBox(srcPath, box = {}) {
  const id = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const outF = path.join(os.tmpdir(), `tc_clean_${id}.mp4`);
  const vf = buildBoxFilter(box).replace(/,$/, "") || "null";
  try {
    await run("ffmpeg", [
      "-y",
      "-loglevel", "error",
      "-nostats",
      "-i", srcPath,
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outF,
    ]);
    const out = fs.readFileSync(outF);
    if (!out || !out.length) throw new Error("clean-box ra file rỗng");
    return out;
  } finally {
    try { fs.unlinkSync(outF); } catch (x) {}
  }
}
```

Sửa dòng cuối:

```js
module.exports = { transcodeToH264, transcodeBurnSub, transcodeCleanBox, buildBoxFilter, probeVideoCodec };
```

- [ ] **Step 4: Chạy test cho thấy pass + kiểm tra hồi quy**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/`
Expected: PASS toàn bộ, `# fail 0` (các test cũ `config/r2/work/backfill-rewrite` vẫn xanh)

- [ ] **Step 5: Kiểm chứng ffmpeg thật với 1 video giả 2 giây**

```bash
cd /tmp && ffmpeg -y -loglevel error -f lavfi -i testsrc=size=720x1280:duration=2:rate=24 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a aac -shortest /tmp/cleanbox_src.mp4
cd /Users/kevin/video/247drama-worker && node -e "require('./util/transcode').transcodeCleanBox('/tmp/cleanbox_src.mp4',{}).then(b=>console.log('bytes',b.length))"
```
Expected: in ra `bytes <số > 0>`

- [ ] **Step 6: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/util/transcode.js 247drama-worker/test/transcode.test.js
git commit -m "feat(worker): transcodeCleanBox - encode video sạch không đốt phụ đề"
```

---

### Task 3: Cờ `mode` trong config

**Files:**
- Modify: `/Users/kevin/video/247drama-worker/config.js` (hàm `buildSubtitleConfig`)
- Test: `/Users/kevin/video/247drama-worker/test/config.test.js` (thêm test vào cuối file)

**Interfaces:**
- Consumes: không có.
- Produces: `buildSubtitleConfig(settingJSON)` trả thêm 2 khoá: `mode` (`"soft"` chỉ khi `settingJSON.subtitle.mode === "soft"`, còn lại `"burn"`) và `secondLang` (mặc định `"en"`, đọc từ `settingJSON.subtitle.secondLang`).

- [ ] **Step 1: Viết test trước**

Thêm vào cuối `test/config.test.js`:

```js
const { buildSubtitleConfig } = require("../config");

test("mode mặc định là burn", () => {
  assert.strictEqual(buildSubtitleConfig({}).mode, "burn");
  assert.strictEqual(buildSubtitleConfig({ subtitle: {} }).mode, "burn");
  assert.strictEqual(buildSubtitleConfig({ subtitle: { mode: "linh tinh" } }).mode, "burn");
});

test("mode soft khi setting ghi đúng chữ soft", () => {
  assert.strictEqual(buildSubtitleConfig({ subtitle: { mode: "soft" } }).mode, "soft");
});

test("secondLang mặc định en", () => {
  assert.strictEqual(buildSubtitleConfig({}).secondLang, "en");
  assert.strictEqual(buildSubtitleConfig({ subtitle: { secondLang: "th" } }).secondLang, "th");
});
```

Nếu `test/config.test.js` chưa require `test`/`assert`/`buildSubtitleConfig` ở đầu file thì dùng require sẵn có, đừng khai báo trùng biến.

- [ ] **Step 2: Chạy test cho thấy fail**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/config.test.js`
Expected: FAIL — nhận `undefined` thay vì `"burn"`

- [ ] **Step 3: Sửa `config.js`**

Trong `buildSubtitleConfig`, thêm 2 khoá vào object trả về (ngay sau `targetLang`):

```js
    // "burn" (mặc định) = đốt phụ đề Việt vào video như cũ.
    // "soft" = video sạch + 2 file .vtt (vi/en) rời -> app chọn theo quốc gia.
    mode: s.mode === "soft" ? "soft" : "burn",
    secondLang: s.secondLang || "en",
```

- [ ] **Step 4: Chạy test cho thấy pass**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/`
Expected: PASS, `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/config.js 247drama-worker/test/config.test.js
git commit -m "feat(worker): cờ subtitle.mode burn|soft"
```

---

### Task 4: Nhánh soft trong `autosub.js`

**Files:**
- Modify: `/Users/kevin/video/247drama-worker/util/autosub.js`
- Test: `/Users/kevin/video/247drama-worker/test/autosub.test.js`

**Interfaces:**
- Consumes: `segsToVtt` (Task 1), `transcodeCleanBox` (Task 2), `mode`/`secondLang` từ `buildSubtitleConfig` (Task 3).
- Produces:
  - `translateBoth(zhSegs, opts)` → `Promise<{viSegs, enSegs}>`. `opts`: `{apiKey, model, sourceLang, targetLang, secondLang, batchSize, translateFn}`. `translateFn` mặc định là `translateSegments` (chỉ để test tiêm hàm giả). Nhánh phụ (`secondLang`) lỗi → `enSegs: []`, không ném lỗi. Nhánh chính lỗi → ném lỗi.
  - `subtitleVideoBuffer` khi `cfg.mode === "soft"` trả thêm `enSegs: [...]` và `burned: false`; khi burn trả `burned: true`, `enSegs: []`.

- [ ] **Step 1: Viết test trước**

Tạo `test/autosub.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { translateBoth } = require("../util/autosub");

const ZH = [{ start: 0, end: 1, text: "你好" }];

test("dịch cả 2 nhánh từ tiếng Trung gốc, không dịch chuyền vi->en", async () => {
  const calls = [];
  const fake = async (segs, opts) => {
    calls.push({ src: opts.sourceLang, dst: opts.targetLang, text: segs[0].text });
    return [{ ...segs[0], text: `[${opts.targetLang}]` }];
  };
  const r = await translateBoth(ZH, { apiKey: "k", secondLang: "en", translateFn: fake });
  assert.strictEqual(r.viSegs[0].text, "[vi]");
  assert.strictEqual(r.enSegs[0].text, "[en]");
  assert.deepStrictEqual(calls.map((c) => c.src), ["zh", "zh"]);
  assert.deepStrictEqual(calls.map((c) => c.text), ["你好", "你好"]);
});

test("nhánh en lỗi -> vẫn có vi, enSegs rỗng", async () => {
  const fake = async (segs, opts) => {
    if (opts.targetLang === "en") throw new Error("Gemini 429");
    return [{ ...segs[0], text: "chào" }];
  };
  const r = await translateBoth(ZH, { apiKey: "k", secondLang: "en", translateFn: fake });
  assert.strictEqual(r.viSegs[0].text, "chào");
  assert.deepStrictEqual(r.enSegs, []);
});

test("nhánh vi lỗi -> ném lỗi cho caller fallback", async () => {
  const fake = async (segs, opts) => {
    if (opts.targetLang === "vi") throw new Error("Gemini 500");
    return [{ ...segs[0], text: "hi" }];
  };
  await assert.rejects(
    () => translateBoth(ZH, { apiKey: "k", secondLang: "en", translateFn: fake }),
    /Gemini 500/,
  );
});

test("secondLang rỗng -> chỉ dịch 1 nhánh", async () => {
  let n = 0;
  const fake = async (segs) => { n++; return [{ ...segs[0], text: "x" }]; };
  const r = await translateBoth(ZH, { apiKey: "k", secondLang: "", translateFn: fake });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(r.enSegs, []);
});
```

- [ ] **Step 2: Chạy test cho thấy fail**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/autosub.test.js`
Expected: FAIL — `translateBoth is not a function`

- [ ] **Step 3: Sửa `util/autosub.js`**

Thêm import ở đầu file (cạnh các require sẵn có):

```js
const { transcodeToH264, transcodeBurnSub, transcodeCleanBox } = require("./transcode");
```

Thêm hàm sau `cleanOcrSegs`:

```js
/**
 * Dịch zhSegs sang ngôn ngữ chính (targetLang) và ngôn ngữ phụ (secondLang) SONG SONG,
 * cả hai đều đi từ TIẾNG TRUNG GỐC (không dịch chuyền vi->en để khỏi tam sao thất bản).
 * Nhánh phụ lỗi thì bỏ qua (tập vẫn lên, chỉ thiếu track en); nhánh chính lỗi thì ném ra
 * cho subtitleVideoBuffer fallback.
 */
async function translateBoth(zhSegs, opts = {}) {
  const {
    apiKey,
    model = "gemini-2.5-flash",
    sourceLang = "zh",
    targetLang = "vi",
    secondLang = "en",
    batchSize = 40,
    translateFn = translateSegments,
  } = opts;
  const base = { apiKey, model, sourceLang, batchSize };
  const [viSegs, enSegs] = await Promise.all([
    translateFn(zhSegs, { ...base, targetLang }),
    secondLang
      ? translateFn(zhSegs, { ...base, targetLang: secondLang }).catch((e) => {
          console.error(`[autosub] dịch ${secondLang} lỗi, bỏ track phụ:`, e.message);
          return [];
        })
      : Promise.resolve([]),
  ]);
  return { viSegs, enSegs };
}
```

Trong `subtitleVideoBuffer`, đọc thêm `mode` và `secondLang` từ `cfg` (thêm vào khối destructure đầu hàm):

```js
    mode = "burn",
    secondLang = "en",
```

Thay đoạn từ `const viSegs = await translateSegments(...)` tới hết `return { buffer: out, subbed: true, ... }` bằng:

```js
    const { viSegs, enSegs } = await translateBoth(zhSegs, {
      apiKey,
      model: geminiModel,
      sourceLang,
      targetLang,
      secondLang: mode === "soft" ? secondLang : "",
      batchSize: translateBatchSize,
    });

    const boxCfg = {
      yRatio: coverBoxYRatio,
      heightRatio: coverBoxHeightRatio,
      color: coverBoxColor,
      enabled: coverEnabled,
    };

    // soft: video SẠCH (chỉ che sub Trung), phụ đề đi kèm file .vtt rời.
    if (mode === "soft") {
      const clean = await transcodeCleanBox(srcF, boxCfg);
      return { buffer: clean, subbed: true, segments: viSegs.length, viSegs, enSegs, burned: false, reason: "", codec: "h264", transcoded: true };
    }

    buildAss(viSegs, { width: dims.width, height: dims.height, assPath: assF, chineseBottomRatio });
    const out = await transcodeBurnSub(srcF, assF, boxCfg);
    return { buffer: out, subbed: true, segments: viSegs.length, viSegs, enSegs: [], burned: true, reason: "", codec: "h264", transcoded: true };
```

Trong cả hai nhánh `catch` fallback, thêm `enSegs: [], burned: false` vào object trả về để caller luôn thấy đủ khoá.

Sửa dòng cuối:

```js
module.exports = { subtitleVideoBuffer, translateBoth };
```

- [ ] **Step 4: Chạy test cho thấy pass**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/`
Expected: PASS, `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/util/autosub.js 247drama-worker/test/autosub.test.js
git commit -m "feat(worker): nhánh soft-sub dịch vi+en song song từ tiếng Trung"
```

---

### Task 5: `render.js` up 2 file .vtt và ghi `subTracks` vào Mongo

**Files:**
- Modify: `/Users/kevin/video/247drama-worker/render.js`
- Modify: `/Users/kevin/video/247drama-worker/config.js` (thêm `buildSubKey`, `buildSubUrl`)
- Modify: `/Users/kevin/video/247drama-worker/models/shortVideo.model.js` (thêm field để Mongoose không lọc mất)
- Test: `/Users/kevin/video/247drama-worker/test/config.test.js` (thêm test)

**Interfaces:**
- Consumes: `segsToVtt` (Task 1), `enSegs`/`burned` từ `subtitleVideoBuffer` (Task 4).
- Produces:
  - `buildSubKey(provider, sourceId, index, lang)` → `"videos/hg_123_ep0.vi.vtt"`
  - `buildSubUrl(provider, sourceId, index, lang)` → `"<R2_PUBLIC_BASE>/videos/hg_123_ep0.vi.vtt"`
  - Document `ShortVideo` có `subTracks: [{lang, url}]` và `burnedLang: "" | "vi"`.

- [ ] **Step 1: Viết test trước**

Thêm vào `test/config.test.js`:

```js
const { buildSubKey, buildSubUrl } = require("../config");

test("key phụ đề đi kèm tên file video, đổi đuôi theo lang", () => {
  process.env.R2_KEY_PREFIX = "videos";
  assert.strictEqual(buildSubKey("hg", "123", 0, "vi"), "videos/hg_123_ep0.vi.vtt");
  assert.strictEqual(buildSubKey("hm", "9", 4, "en"), "videos/hm_9_ep4.en.vtt");
});

test("url phụ đề ghép từ R2_PUBLIC_BASE", () => {
  process.env.R2_KEY_PREFIX = "videos";
  process.env.R2_PUBLIC_BASE = "https://pub-x.r2.dev";
  assert.strictEqual(buildSubUrl("hg", "123", 0, "en"), "https://pub-x.r2.dev/videos/hg_123_ep0.en.vtt");
});
```

- [ ] **Step 2: Chạy test cho thấy fail**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/config.test.js`
Expected: FAIL — `buildSubKey is not a function`

- [ ] **Step 3: Thêm 2 hàm vào `config.js`**

Trước `module.exports`:

```js
// Key phụ đề trên R2: cùng tên file video, đổi .mp4 -> .<lang>.vtt.
function buildSubKey(provider, sourceId, index, lang) {
  return buildR2Key(provider, sourceId, index).replace(/\.mp4$/, `.${lang}.vtt`);
}

function buildSubUrl(provider, sourceId, index, lang) {
  const base = process.env.R2_PUBLIC_BASE || env.r2.publicBase || "";
  return `${base}/${buildSubKey(provider, sourceId, index, lang)}`;
}
```

Sửa dòng cuối:

```js
module.exports = { env, buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig, buildSubKey, buildSubUrl };
```

- [ ] **Step 4: Chạy test cho thấy pass**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/config.test.js`
Expected: PASS, `# fail 0`

- [ ] **Step 5: Thêm field vào model của worker**

Trong `models/shortVideo.model.js`, thêm vào schema (Mongoose strict sẽ vứt field lạ nếu không khai):

```js
    subTracks: { type: [{ lang: String, url: String, _id: false }], default: undefined },
    burnedLang: { type: String, default: "" },
```

- [ ] **Step 6: Sửa `render.js`**

Thêm import:

```js
const { segsToVtt } = require("./util/vtt");
const { env, buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig, buildSubKey, buildSubUrl } = require("./config");
```

Thay khối `// 4b) Lưu sidecar segment tiếng Việt...` bằng:

```js
    // 4b) Sidecar .vi.json giữ nguyên cho nhánh lồng tiếng (dub đi từ SUB VIỆT).
    if (r.viSegs && r.viSegs.length) {
      try {
        const subKey = buildR2Key(provider, sourceId, ep.index).replace(/\.mp4$/, ".vi.json");
        await uploadToR2(Buffer.from(JSON.stringify(r.viSegs)), subKey, "application/json");
      } catch (e) {}
    }

    // 4c) Chế độ soft: up track WebVTT rời cho từng ngôn ngữ có bản dịch.
    const subTracks = [];
    if (!r.burned) {
      const offsetSec = (((global.settingJSON && global.settingJSON.subtitle) || {}).subStartOffsetMs || 0) / 1000;
      for (const [lang, segs] of [["vi", r.viSegs], ["en", r.enSegs]]) {
        const body = segsToVtt(segs, { offsetSec });
        if (!body) continue;
        try {
          await uploadToR2(Buffer.from(body, "utf8"), buildSubKey(provider, sourceId, ep.index, lang), "text/vtt; charset=utf-8");
          subTracks.push({ lang, url: buildSubUrl(provider, sourceId, ep.index, lang) });
        } catch (e) {
          console.error(`[render] up track ${lang} lỗi:`, e.message);
        }
      }
    }
```

Trong khối `$set` của `ShortVideo.updateOne`, thêm 2 dòng sau `subLang`:

```js
          subTracks,
          burnedLang: r.burned ? subLang : "",
```

- [ ] **Step 7: Chạy toàn bộ test + kiểm tra file không lỗi cú pháp**

Run: `cd /Users/kevin/video/247drama-worker && node --test test/ && node -e "require('./render.js'); console.log('render.js load OK')"`
Expected: PASS toàn bộ + in `render.js load OK`

- [ ] **Step 8: Commit**

```bash
cd /Users/kevin/video
git add 247drama-worker/render.js 247drama-worker/config.js 247drama-worker/models/shortVideo.model.js 247drama-worker/test/config.test.js
git commit -m "feat(worker): up track .vtt và ghi subTracks/burnedLang vào Mongo"
```

---

### Task 6: Mirror backend về máy local

**Files:**
- Create: `/Users/kevin/video/247drama-backend/` (bản sao từ server, KHÔNG commit `node_modules`)
- Create: `/Users/kevin/video/247drama-backend/.gitignore`

**Interfaces:**
- Consumes: không có.
- Produces: cây source backend sửa được ở local để Task 7-8 làm việc trên đó rồi rsync ngược lên server.

- [ ] **Step 1: Kéo source về (bỏ node_modules, uploads, .env)**

```bash
mkdir -p /Users/kevin/video/247drama-backend
rsync -avz --exclude node_modules --exclude uploads --exclude .env \
  -e "sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=no" \
  root@103.179.185.196:/var/www/247drama/backend/ /Users/kevin/video/247drama-backend/
```
Expected: rsync liệt kê `controllers/`, `models/`, `routes/`, `util/`, `index.js`

- [ ] **Step 2: Chặn rác vào git**

Tạo `/Users/kevin/video/247drama-backend/.gitignore`:

```
node_modules/
uploads/
.env
```

- [ ] **Step 3: Xác nhận bản local khớp server**

```bash
cd /Users/kevin/video/247drama-backend && ls models/shortVideo.model.js controllers/client/shortVideo.controller.js && grep -c "exports\." controllers/client/shortVideo.controller.js
```
Expected: hai file tồn tại, số `exports.` in ra > 5

- [ ] **Step 4: Commit**

```bash
cd /Users/kevin/video
git add 247drama-backend
git commit -m "chore(backend): mirror source 247drama backend về repo để sửa có vết"
```

---

### Task 7: Backend — model, geoip, API trả `subDefault`

**Files:**
- Modify: `/Users/kevin/video/247drama-backend/models/shortVideo.model.js`
- Create: `/Users/kevin/video/247drama-backend/util/geoLang.js`
- Modify: `/Users/kevin/video/247drama-backend/controllers/client/shortVideo.controller.js`
- Create: `/Users/kevin/video/247drama-backend/scripts/backfill-burnedlang.js`
- Test: `/Users/kevin/video/247drama-backend/test/geoLang.test.js`

**Interfaces:**
- Consumes: `subTracks`/`burnedLang` do worker ghi (Task 5).
- Produces: `resolveSubLang(req)` → `"vi" | "en"`; response của 3 API client có thêm `subDefault`.

- [ ] **Step 1: Viết test trước**

Tạo `/Users/kevin/video/247drama-backend/test/geoLang.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { resolveSubLang, pickClientIp } = require("../util/geoLang");

const req = (headers = {}, ip) => ({ headers, ip, socket: { remoteAddress: ip } });

test("lấy IP đầu tiên trong X-Forwarded-For", () => {
  assert.strictEqual(pickClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
});

test("không có header thì lấy remoteAddress, bỏ tiền tố IPv6-mapped", () => {
  assert.strictEqual(pickClientIp(req({}, "::ffff:5.6.7.8")), "5.6.7.8");
});

test("IP Việt Nam -> vi", () => {
  const lookup = () => ({ country: "VN" });
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "113.161.0.1" }), lookup), "vi");
});

test("IP nước ngoài -> en", () => {
  const lookup = () => ({ country: "US" });
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "8.8.8.8" }), lookup), "en");
});

test("không tra được -> vi (thị trường chính)", () => {
  assert.strictEqual(resolveSubLang(req({}), () => null), "vi");
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "rác" }), () => null), "vi");
});
```

- [ ] **Step 2: Chạy test cho thấy fail**

Run: `cd /Users/kevin/video/247drama-backend && node --test test/geoLang.test.js`
Expected: FAIL — `Cannot find module '../util/geoLang'`

- [ ] **Step 3: Cài geoip-lite và viết `util/geoLang.js`**

```bash
cd /Users/kevin/video/247drama-backend && npm install geoip-lite@1.4.10 --save
```

Tạo `util/geoLang.js`:

```js
const geoip = require("geoip-lite");

// IP thật của người xem: nginx set X-Forwarded-For (sites-enabled/default), phần tử ĐẦU
// là client, các phần tử sau là proxy.
function pickClientIp(req) {
  const xff = (req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"])) || "";
  const first = String(xff).split(",")[0].trim();
  const raw = first || req.ip || (req.socket && req.socket.remoteAddress) || "";
  return String(raw).replace(/^::ffff:/, "");
}

/**
 * Ngôn ngữ phụ đề mặc định theo quốc gia: VN -> vi, còn lại -> en.
 * Tra hụt (IP nội bộ, dải lạ) -> vi vì Việt Nam là thị trường chính.
 * lookupFn chỉ để test tiêm hàm giả.
 */
function resolveSubLang(req, lookupFn = geoip.lookup) {
  try {
    const geo = lookupFn(pickClientIp(req));
    if (!geo || !geo.country) return "vi";
    return geo.country === "VN" ? "vi" : "en";
  } catch (e) {
    return "vi";
  }
}

module.exports = { resolveSubLang, pickClientIp };
```

- [ ] **Step 4: Chạy test cho thấy pass**

Run: `cd /Users/kevin/video/247drama-backend && node --test test/geoLang.test.js`
Expected: PASS — `# pass 5`, `# fail 0`

- [ ] **Step 5: Thêm field vào model**

Trong `models/shortVideo.model.js`, thêm vào schema sau `releaseDate`:

```js
    // Track phụ đề rời (soft-sub). Rỗng = tập cũ có phụ đề cháy sẵn trong video.
    subTracks: { type: [{ lang: String, url: String, _id: false }], default: [] },
    burnedLang: { type: String, default: "" },
```

- [ ] **Step 6: Trả 3 field mới trong API client**

Trong `controllers/client/shortVideo.controller.js`, ở đầu file thêm:

```js
const { resolveSubLang } = require("../../util/geoLang");
```

Ba hàm `retrieveMovieSeriesVideosForUser`, `getVideosGroupedByMovieSeries`, `loadMovieSeriesVideosForUser`: ngay trước khi `res.status(200).json(...)`, tính một lần

```js
    const subDefault = resolveSubLang(req);
```

và thêm `subDefault` vào object JSON trả về (ngang hàng với `status`/`message`/`data`). Với mỗi video object trong `data`, đảm bảo có `subTracks` và `burnedLang` — nếu hàm đó đang `.select(...)` hoặc map thủ công thì bổ sung hai tên field này vào danh sách; nếu trả nguyên document Mongoose thì đã có sẵn sau Step 5.

- [ ] **Step 7: Script migration cho 3.936 tập cũ**

Tạo `scripts/backfill-burnedlang.js`:

```js
// Đánh dấu các tập render TRƯỚC khi có soft-sub: phụ đề tiếng Việt đã cháy vào video
// -> app phải ẩn nút chọn phụ đề. Chạy 1 lần, chạy lại cũng vô hại.
require("dotenv").config();
const mongoose = require("mongoose");
const ShortVideo = require("../models/shortVideo.model");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL);
  const r = await ShortVideo.updateMany(
    { burnedLang: { $exists: false } },
    { $set: { burnedLang: "vi", subTracks: [] } },
  );
  console.log("đã đánh dấu:", r.modifiedCount);
  await mongoose.disconnect();
})();
```

- [ ] **Step 8: Commit**

```bash
cd /Users/kevin/video
git add 247drama-backend
git commit -m "feat(backend): subTracks/burnedLang + subDefault theo geoip"
```

---

### Task 8: Deploy backend, render thử 1 tập, nghiệm thu

**Files:**
- Modify: server `103.179.185.196:/var/www/247drama/backend` (rsync từ local)
- Modify: `settingJSON.subtitle.mode` trong Mongo (bật soft cho lần render thử)

**Interfaces:**
- Consumes: toàn bộ Task 1-7.
- Produces: 1 tập thật trên R2 có `.mp4` + `.vi.vtt` + `.en.vtt`, API client trả `subTracks` 2 phần tử và `subDefault` đúng theo IP.

- [ ] **Step 1: Backup backend trên server**

```bash
sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=no root@103.179.185.196 \
  'cp -r /var/www/247drama/backend /root/backup_backend_$(date +%Y%m%d_%H%M%S) && ls -d /root/backup_backend_*'
```
Expected: in ra thư mục backup vừa tạo

- [ ] **Step 2: Đẩy code lên server**

```bash
rsync -avz --exclude node_modules --exclude uploads --exclude .env --exclude test \
  -e "sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=no" \
  /Users/kevin/video/247drama-backend/ root@103.179.185.196:/var/www/247drama/backend/
sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=no root@103.179.185.196 \
  'cd /var/www/247drama/backend && export NVM_DIR=/root/.nvm && . $NVM_DIR/nvm.sh && npm install geoip-lite@1.4.10 --save && node scripts/backfill-burnedlang.js && pm2 reload backend && pm2 list | head -12'
```
Expected: `đã đánh dấu: 3936`, 4 instance `backend` trạng thái `online`

- [ ] **Step 3: Bật soft-sub và render 1 tập thử**

```bash
sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=no root@103.179.185.196 \
  'mongosh "mongodb://admin:dbadmin123@127.0.0.1:27017/247drama?authSource=admin" --quiet --eval "db.settings.updateOne({}, {\$set: {\"subtitle.mode\": \"soft\"}}); printjson(db.settings.findOne({}, {subtitle: 1}).subtitle.mode)"'
cd /Users/kevin/video/247drama-worker && node scripts/redo-one.js <provider>_<sourceId>_ep<N>
```
Expected: mongosh in `soft`; worker chạy hết các pha `tải → sub → upload` không lỗi

(Nếu tên setting doc khác `settings`, kiểm bằng `db.getCollectionNames()` rồi chỉnh đúng collection.)

- [ ] **Step 4: Kiểm tra R2 và Mongo**

```bash
cd /Users/kevin/video/247drama-worker && node -e "
const {S3Client,ListObjectsV2Command}=require('@aws-sdk/client-s3');require('dotenv').config();
const c=new S3Client({region:'auto',endpoint:process.env.R2_ENDPOINT,credentials:{accessKeyId:process.env.R2_ACCESS_KEY,secretAccessKey:process.env.R2_SECRET}});
c.send(new ListObjectsV2Command({Bucket:process.env.R2_BUCKET,Prefix:'videos/<provider>_<sourceId>_ep<N>'})).then(r=>console.log((r.Contents||[]).map(o=>o.Key)));
"
sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=no root@103.179.185.196 \
  'mongosh "mongodb://admin:dbadmin123@127.0.0.1:27017/247drama?authSource=admin" --quiet --eval "printjson(db.shortvideos.findOne({videoUrl:/<provider>_<sourceId>_ep<N>/}, {videoUrl:1, subTracks:1, burnedLang:1}))"'
```
Expected: R2 có 4 key (`.mp4`, `.vi.json`, `.vi.vtt`, `.en.vtt`); Mongo có `subTracks` 2 phần tử, `burnedLang: ""`

- [ ] **Step 5: Kiểm tra video sạch và nội dung phụ đề**

```bash
curl -s "$(sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=no root@103.179.185.196 'mongosh "mongodb://admin:dbadmin123@127.0.0.1:27017/247drama?authSource=admin" --quiet --eval "print(db.shortvideos.findOne({videoUrl:/<provider>_<sourceId>_ep<N>/}).subTracks[1].url)"')" | head -12
```
Expected: in ra `WEBVTT` + vài cue tiếng Anh

Mở file `.mp4` mới trong QuickTime: dải đáy đã che sub Trung, KHÔNG có chữ Việt cháy trên hình.

- [ ] **Step 6: Kiểm tra API trả đúng theo IP**

```bash
curl -s -H "X-Forwarded-For: 113.161.0.1" "http://103.179.185.196/api/<đường-dẫn-route-client-lấy-tập>" | head -c 400
curl -s -H "X-Forwarded-For: 8.8.8.8"     "http://103.179.185.196/api/<đường-dẫn-route-client-lấy-tập>" | head -c 400
```
Expected: lần 1 có `"subDefault":"vi"`, lần 2 có `"subDefault":"en"`; cả hai đều có `subTracks` cho tập vừa render

(Route chính xác đọc trong `routes/client/shortVideo.route.js`; nếu route cần token thì thêm header auth của một tài khoản test.)

- [ ] **Step 7: Xác nhận tập cũ không hỏng**

```bash
sshpass -p 'Ngaymainha@1' ssh -o StrictHostKeyChecking=no root@103.179.185.196 \
  'mongosh "mongodb://admin:dbadmin123@127.0.0.1:27017/247drama?authSource=admin" --quiet --eval "printjson(db.shortvideos.findOne({burnedLang:\"vi\"}, {videoUrl:1, burnedLang:1, subTracks:1}))"'
```
Expected: `burnedLang: "vi"`, `subTracks: []`, `videoUrl` không đổi

- [ ] **Step 8: Commit và ghi lại trạng thái**

```bash
cd /Users/kevin/video
git add -A docs/superpowers 247drama-backend 247drama-worker
git commit -m "chore: nghiệm thu soft-sub vi/en trên 1 tập thật"
```

Ghi vào `247drama-worker/HANDOFF.md` một dòng: đã bật `subtitle.mode`, cách rollback là đặt lại `"burn"`.

---

## Sau plan này

Bật `mode: "soft"` toàn cục chỉ nên làm SAU khi app đọc được `subTracks` — nếu bật sớm, tập mới sẽ không có phụ đề nào hiển thị trên app cũ. Giai đoạn app cần đường dẫn source (Flutter hay React Native) rồi viết plan riêng.
