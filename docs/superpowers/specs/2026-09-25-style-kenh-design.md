# Thiết kế: Style kênh (Channel Style Profile → Skill)

**Ngày:** 2026-09-25
**Dự án:** Nonelab Studio (videoana) — video.nonelab.net
**Trạng thái:** Đã brainstorm, chờ review spec

## 1. Mục tiêu

Người dùng dán **link một kênh** TikTok/Douyin. Hệ thống chọn **30 video chỉ số tốt**
(ưu tiên 90 ngày gần nhất), phân tích **phong cách dựng** của từng video theo **6 lớp**
(cấu trúc & nhịp · hình ảnh · text & đồ hoạ · âm thanh · nội dung & giọng điệu · nhận
diện thương hiệu) bằng **số đo thật** (ffmpeg) + **mô tả định tính** (Gemini xem video),
rồi **tổng hợp bằng code** thành một **Style Profile JSON** và xuất ra **skill Claude Code**
(`SKILL.md` + `references/`) tải về dạng `.zip`. Mỗi kênh = 1 skill. JSON lưu lại trong
hệ thống để sau này Xưởng đọc làm tham số dựng clip cùng phong cách.

Nguyên tắc xuyên suốt: **mô tả bằng số đo thay vì tính từ** ("cut mỗi 1,5–2,0 s, caption
từng câu, chữ trắng viền đen ở 1/3 trên" thay cho "nhanh, chữ to"); **bám vào cái lặp
lại**, không học video viral tình cờ; **ghi cả những gì kênh không bao giờ làm**.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Đầu ra | **Phương án B**: zip skill Claude Code (mỗi kênh 1 skill) **và** lưu Style Profile JSON trong DB |
| Chọn video | **Tự động**: 100 video gần nhất → top 30 view trong 90 ngày (nới 180 → 365 nếu thiếu, báo rõ); top 5 = **mẫu chuẩn**; người dùng xem trước và bỏ video lạc style |
| Brand guideline | **Ngoài phạm vi v1** — không có ô nhập/đối chiếu guideline |
| Cách đo | **Hướng 2 — lai**: ffmpeg đo số (độ dài, cut, loudness, màu, loop), Gemini tả chất và nhận sẵn số đo trong prompt; tổng hợp 30 phiếu bằng code, Gemini chỉ viết lời cho SKILL.md |
| Quyền | `requireEditor` (Biên tập + Quản trị), owner-scoping như các module khác |
| Nền tảng | TikTok + Douyin (tái dùng `resolveAccount`/`fetchAccountVideos`) |
| Model | `STYLE_MODEL` (mặc định = `GEMINI_MODEL`), fps lấy mẫu 3 (video > 60 s hạ 2), lượt timeline fps 5 |

## 3. Luồng tổng thể

1. **Chọn video** — `POST /api/style/pick {url}` → `resolveAccount` + `fetchAccountVideos(100)`
   → `pickStyleVideos()` (thuần code) → trả danh sách đề xuất 30 + 5 mẫu chuẩn. Chưa ghi DB.
2. **Tạo profile** — `POST /api/style/create {account, videos[], exemplarIds[]}` → tạo
   `style_profiles` (status `running`) + 30 dòng `style_videos` (status `pending`) → đẩy mỗi
   video vào **hàng đợi nền sẵn có** (`queue.ts`) với `queue_meta.kind = 'style'`.
3. **Worker mỗi video** (`server/style/pipeline.ts`):
   tải video (TikTok/Douyin, tái dùng) → `measure()` (ffmpeg) → `analyze()` (Gemini + số đo
   → Phiếu style JSON, validate enum) → nếu là mẫu chuẩn: `timeline()` (Gemini lượt 2) →
   lưu `measure/analysis/timeline/frames` vào `style_videos` → xoá video tạm.
   Video đã có phiếu style (cùng `link`) ở profile khác của **cùng owner** → copy phiếu, không gọi lại.
4. **Tổng hợp** — khi số phiếu `done` ≥ `STYLE_MIN_VIDEOS` (mặc định 15) và không còn
   `pending/processing`: `aggregate()` (code) → Style Profile JSON → `writeSkill()` (Gemini 1
   lượt chữ viết 3 đoạn văn) → lưu `profile` + `skill_md`, status `done`.
   Có thể **tổng hợp lại** bất cứ lúc nào từ phiếu đã lưu (không gọi Gemini xem video).
5. **Xem & tải** — UI hiển thị 6 lớp + bảng số đo + 5 timeline + outlier; `GET .../skill.zip`
   dựng zip lúc tải.

Video tải về xoá sau khi phân tích; chỉ giữ 6 ảnh khung nhỏ/video (JPEG ~360 px, data-URL).

## 4. Đo bằng ffmpeg — `server/style/measure.ts`

Không AI. Đầu vào: đường dẫn MP4. Đầu ra `StyleMeasure`:

```
duration, width, height, aspect ("9:16"|"1:1"|"16:9"|khác), fps
cuts[]            mốc giây đổi cảnh: select='gt(scene,T)' + showinfo, T = STYLE_SCENE_THRESHOLD (0.35)
cutsPerMin, medianShotLen, shotLenP10, shotLenP90, cutsIn3s
loudness          { integratedLufs, first3sLufs }  (ebur128)
silenceStart      giây im lặng đầu video (silencedetect, ngưỡng -35 dB)
color             { y, u, v, saturation, contrast } trung bình trên 8 khung lấy đều (signalstats)
                  → nhãn: tone warm|cool|neutral, saturation low|mid|high, contrast low|mid|high
loopLikely        độ giống khung đầu–cuối (so histogram) ≥ 0.9
frames[]          6 JPEG: 0 s, 1.5 s, 3 mốc cut giữa (đều), khung cuối
```

Mỗi phép đo chạy độc lập; phép nào lỗi → trường đó `null`, không fail cả video. Tất cả
ngưỡng nằm trong `server/style/config.ts` (đọc env, có mặc định).

## 5. Phiếu style từng video — `server/style/analyze.ts`

Gemini xem video (`videoMetadata.fps`) + prompt chứa **số đo ở mục 4** + yêu cầu JSON đúng
schema 6 lớp. Mọi trường liệt kê dùng **enum cố định**; text tự do chỉ ở các trường đánh dấu *.

```
structure: hookType (text-big|question|curiosity-scene|result-first|talk-direct|other)
           hookText*, hookVisual*, layout (hook-problem-content-cta|vlog|list|story|other)
           hasLoop, transitions[] {at, type: hard|zoom|whip|jump|match|fade|other}
           cutSync (beat|speech|none)
visual:    shooting (static|handheld|mixed), angles[] (eye|low|high), shotSizes[] (ECU|CU|MCU|MS|FS|WS)
           talkingHeadRatio (0–1), brollRatio (0–1), punchIn (bool)
           frame (none|border|split|pip), grade {tone, saturation, contrast, preset*}
           quality (clean|raw|grainy)
text:      captionStyle (word-pop|sentence|none), font {family*, weight: regular|bold|black,
           sizeRel: small|med|large}, color*, stroke (bool), shadow (bool), box (bool)
           position (top-third|center|lower-third|bottom|varies), highlight (color|emoji|icon|none)
           stickers[] (arrow|circle|meme|lower-third|emoji|other), animIn/animOut (pop|bounce|typewriter|fade|none)
audio:     music {genre*, source: trending|original|none, levelVsVoice: under|equal|over}
           voice {mode: direct|voiceover|tts|none, gender: male|female|mixed, pace: slow|normal|fast}
           sfx[] {at, type: whoosh|ding|pop|boom|other}, sfxDensity (none|sparse|dense), beatSync (bool)
content:   genre (review|compare|story|pov|tutorial|unbox|comedy|other), persona (friendly|expert|sassy|serious|other)
           openingFormula*, closingFormula*, cta*, productPresentation[] (handheld|macro|before-after|demo|none)
brand:     watermark {has, position}, intro (bool), outro (bool), mainColors[]*, recurringOpeningFrame (bool)
notes:     oddities[]*  — điểm khác thường so với video "chuẩn" (dùng để loại nhiễu khi tổng hợp)
```

`font.family` ghi dạng phỏng đoán ("Montserrat-like"), không khẳng định. Trường có số đo
sẵn (cutsPerMin, transitions.at…) lấy từ ffmpeg; nếu `measure` null thì Gemini tự ước lượng và
phiếu đánh `estimated: true`.

`validateStyle(raw)` (giống `validateScript` ở Xưởng): enum sai → giá trị mặc định + đẩy cảnh
báo vào `warnings[]`; thiếu lớp → lớp rỗng + cảnh báo; không throw.

**Lượt timeline (5 mẫu chuẩn)** — `timeline.ts`: Gemini nhận `cuts[]` và trả
`timeline[] {from, to, shot*, textOnScreen*, textAnim, sfx*, music*, voice*}` — mỗi shot đúng một
đoạn giữa 2 mốc cut (code ghép lại theo `cuts[]`, model chỉ điền nội dung).

## 6. Tổng hợp — `server/style/aggregate.ts`

Thuần code, có test, chạy lại được.

- **Trọng số thời gian**: video ≤ 90 ngày = 1,0; cũ hơn = 0,5.
- **Loại outlier**: video lệch ≥ 3 lớp so với mode của tập (vd. `cutsPerMin` ngoài P10–P90
  **và** `captionStyle` khác mode **và** `persona` khác mode) → bỏ khỏi thống kê, ghi
  `outliers[] {videoId, reasons[]}`. Ngưỡng số lớp trong config (`STYLE_OUTLIER_LAYERS = 3`).
- **Số**: trung vị + P25–P75 cho `duration, cutsPerMin, medianShotLen, integratedLufs,
  talkingHeadRatio, brollRatio`. Viết thành câu: "cut mỗi 1,5–2,0 s (trung vị 1,7)".
- **Enum**: tần suất có trọng số từng giá trị →
  - ≥ 70 % → `hard[]` (quy tắc cứng)
  - 40–69 % → `soft[]` (quy tắc mềm, kèm %)
  - 0 % ở các trường "phủ định có ý nghĩa" (danh sách trong config: transition ≠ hard, intro,
    outro, stickers, frame ≠ none, captionStyle=word-pop, sfxDensity=dense, music=over…) → `never[]`
- **Text tự do** (`hookText, openingFormula, closingFormula, cta`): 1 lượt Gemini chữ gom nhóm
  → 3–5 công thức lặp lại + số lần + trích nguyên văn.

**Style Profile JSON** (cột `style_profiles.profile`):

```
{ channel: {platform, handle, nickname, avatar}, analyzedAt, model,
  videos: { total, used, failed, outliers[] },
  metrics: { duration, cutsPerMin, shotLen, loudness, talkingHeadRatio, brollRatio },  // {median, p25, p75}
  layers: { structure, visual, text, audio, content, brand },   // mỗi trường {value, share, rule: hard|soft|none}
  rules: { hard[], soft[], never[] },                             // câu hoàn chỉnh có số đo
  formulas: { opening[], closing[], cta[] },                      // {text, count, examples[]}
  exemplars: [ {videoId, link, views, duration, timeline[]} ],   // 5 mẫu chuẩn
  evidence: { <ruleId>: [frameDataUrl…] } }
```

## 7. Skill xuất ra — `server/style/skill.ts` + `zip.ts`

```
style-<handle>/
  SKILL.md              frontmatter name, description; tổng quan; 6 lớp; quy tắc cứng / mềm / KHÔNG BAO GIỜ;
                        cách dựng clip mới theo kênh; con số lấy thẳng từ JSON
  references/
    profile.json        Style Profile nguyên bản
    timelines.md        5 mẫu chuẩn — bảng from–to · shot · text · SFX · nhạc · voice
    formulas.md         công thức mở / chốt / CTA + trích nguyên văn
    evidence/*.jpg      ≈ 20 ảnh khung minh hoạ
```

- Khung `SKILL.md` do **code** dựng từ JSON (số và danh sách quy tắc không qua AI). Gemini viết
  đúng 3 đoạn: tổng quan phong cách, persona/giọng điệu, hướng dẫn dựng clip mới — trả JSON
  `{overview, persona, howTo}`.
- `description` theo mẫu: *"Dựng/biên tập video theo phong cách kênh @<handle>: <genre>, cut
  <shotLen> s, caption <captionStyle>. Dùng khi cần làm clip giống kênh này."*
- `name` = `style-<handle-slug>`.
- Zip dựng trong bộ nhớ lúc tải bằng thư viện JS thuần (không native addon, để build
  `node:22-alpine` không kẹt) — chọn `fflate` hoặc `archiver`; quyết ở task code đầu tiên sau khi
  kiểm `npm view` trên máy Kevin.

## 8. Data model — `server/db.ts`

```sql
CREATE TABLE IF NOT EXISTS style_profiles (
  id TEXT PRIMARY KEY, owner TEXT, platform TEXT, handle TEXT, nickname TEXT, avatar TEXT,
  status TEXT DEFAULT 'running',       -- running | aggregating | done | failed
  picked_ids TEXT, exemplar_ids TEXT,  -- JSON []
  profile TEXT, skill_md TEXT, message TEXT,
  created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS style_videos (
  id TEXT PRIMARY KEY, profile_id TEXT, aweme_id TEXT, link TEXT, title TEXT, cover TEXT,
  views INTEGER, likes INTEGER, create_time INTEGER, is_exemplar INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',       -- pending | processing | done | failed
  measure TEXT, analysis TEXT, timeline TEXT, frames TEXT, warnings TEXT, error TEXT,
  updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_style_videos_profile ON style_videos(profile_id);
```

`history` **không** chứa phiếu style. Hàng đợi: `queue.ts` thêm một nhánh
`if (meta.kind === 'style') return runStyleJob(...)` — logic nằm trọn trong `server/style/`.
Resume sau restart: `style_videos.status='processing'` → `pending` khi khởi động (cùng chỗ với
cơ chế hiện có).

## 9. API — `server/style/routes.ts` (mount `/api/style`, `requireEditor`)

| Route | Việc |
|---|---|
| `POST /pick` `{url, count?=30, exemplars?=5}` | resolve + fetch + chọn; trả `{account, videos[], exemplarIds[], windowDays, note}` |
| `POST /create` `{account, videos[], exemplarIds[]}` | tạo profile + xếp hàng; `{profileId}` |
| `GET /profiles` | danh sách theo owner (Quản trị: tất cả) |
| `GET /profile/:id` | tiến độ, phiếu từng video, profile |
| `POST /profile/:id/aggregate` | tổng hợp lại từ phiếu đã có |
| `POST /profile/:id/retry-failed` | đẩy lại video `failed` vào hàng đợi |
| `GET /profile/:id/skill.zip` | dựng zip, `Content-Disposition: attachment` |
| `DELETE /profile/:id` | chủ sở hữu hoặc Quản trị |

## 10. Frontend — `src/style/*.tsx`

Tab **"Style kênh"** (nav desktop + mobile, gating như Phân tích tài khoản). Không thêm logic
vào `App.tsx` ngoài đăng ký tab; màn hình nằm ở `src/style/StyleView.tsx` + component con:

- `PickForm` — link kênh, "Lấy video" → bảng 30 video (bìa, view, ngày, tick bỏ, tick mẫu chuẩn),
  dòng cảnh báo nếu `windowDays > 90` → "Phân tích style".
- `ProgressPanel` — poll 5 s, n/30, video lỗi + lý do, nút "Chạy lại video lỗi".
- `ProfileView` — 6 thẻ lớp (cứng / mềm / không bao giờ + ảnh bằng chứng), bảng số đo,
  5 timeline, outlier + lý do, nút **Tải skill .zip**, **Tổng hợp lại**.
- `ProfileList` — profile đã tạo.
- `src/style/styleApi.ts` — hàm gọi API; `src/style/types.ts` — type dùng chung với server
  (import từ `server/style/types.ts` như Xưởng đang làm).

## 11. Xử lý lỗi

- Kênh riêng tư / không video / link sai → `pick` trả 400 tiếng Việt.
- Video lỗi tải/Gemini → `style_videos.failed` + `error`; profile vẫn tổng hợp khi đủ
  `STYLE_MIN_VIDEOS`; dưới ngưỡng → status `failed` + message "chỉ n/30 video phân tích được".
- ffmpeg lỗi 1 phép đo → trường null; lỗi toàn bộ → `measure=null`, phiếu `estimated=true`.
- Gemini JSON sai enum → validator sửa + `warnings[]`; JSON không parse được → retry 1 lần rồi `failed`.
- Restart → resume (mục 8). 429/503 → `withRetry` sẵn có.

## 12. Chi phí & hiệu năng

gemini-2.5-flash, video 30–45 s, fps 3: 30 lượt phiếu ≈ 0,15 USD; 5 lượt timeline ≈ 0,05;
2 lượt chữ ≈ 0,01 → **≈ 0,2–0,3 USD/kênh**, 5–8 phút với `QUEUE_CONCURRENCY=10`. ffmpeg thêm
~15–20 s/video (chạy trong worker, không chặn event loop — spawn như `frames.ts`).
RapidAPI: 2–3 lời gọi/kênh. Video tạm ghi ra `STYLE_TMP_DIR` (prod: `/app/data/style-tmp` mount từ `/data`).

## 13. Kiểm thử (`node --test`, Node 22, hermetic — cùng cách Xưởng)

- `measure.test.ts` — parse output `showinfo`/`ebur128`/`signalstats` mẫu → cuts, cutsPerMin,
  P10/P90, nhãn màu, loop; 1 test tích hợp chạy ffmpeg thật trên clip 5 s sinh bằng `lavfi`
  (`testsrc` 2 đoạn màu khác nhau → phải ra đúng 1 cut).
- `validate.test.ts` — enum sai, thiếu lớp, `estimated`.
- `aggregate.test.ts` — ngưỡng 70/40/0 %, trọng số 90 ngày, outlier ≥ 3 lớp, P25–P75, `never[]`
  chỉ với trường trong danh sách phủ định.
- `skill.test.ts` — SKILL.md có frontmatter hợp lệ, mọi số trong `rules[]` xuất hiện nguyên văn,
  không có chuỗi "TBD"/rỗng; zip chứa đủ 4 loại file.
- `pick.test.ts` — top 30 view trong 90 ngày, nới 180/365 khi thiếu, exemplar = top 5, ghi `windowDays`.
- `routes.test.ts` — quyền (Khách 403), owner-scoping, `retry-failed` chỉ đẩy video `failed`.
- Engine fake cho Gemini (`STYLE_ENGINE=fake`) trả phiếu cố định để test pipeline không tốn tiền.

## 14. Deploy (chặn đường, làm trước)

1. Ổ `/` server 163.44.193.87 còn 1,4 GB → chuyển `data.old.*` (12 GB) + 2 file `.tgz` (2 GB)
   sang `/data/backups`, vacuum journal, prune build cache — xem [[videoana-deploy]].
2. `/var/www/videoana` không phải git → deploy bằng **rsync** từ local (loại `data/`, `.env`,
   `node_modules`, `dist`); lần này đưa cả Xưởng lên; thêm mount `/data/videoana-studio` và
   `/data/videoana-style-tmp` vào `docker-compose.yml`; `docker compose up -d --build`.
3. Kiểm `/api/health`, chạy 1 kênh thật nhỏ (10 video) trước khi mở cho Biên tập.

## 15. Ngoài phạm vi (YAGNI)

- Đối chiếu brand guideline; OCR/Whisper/nhận diện font (Hướng 3); Instagram/YouTube;
  Xưởng đọc Style Profile để render (bản sau — JSON đã sẵn); lịch tự phân tích lại theo tháng.
