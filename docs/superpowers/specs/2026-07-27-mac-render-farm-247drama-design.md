# Thiết kế: Render farm trên Mac cho 247drama (tải + OCR + dịch cục bộ, up lên server)

Ngày: 2026-07-27
Trạng thái: đã duyệt (chờ review spec → writing-plans)

## Bối cảnh & vấn đề

App **247drama** (server `103.179.185.196`) import short-drama tiếng Trung từ 52api.cn (nguồn `hg`/红果, `hm`/河马), tự tạo phụ đề tiếng Việt bằng pipeline **OCR sub Trung cháy sẵn → dịch Gemini → burn sub Việt** rồi lưu file vào `/uploads`, stream cho app.

Nút thắt: server chỉ **4 nhân Xeon E5-2670 v2 (2013)**, chạy 2 process OCR đã đẩy load average lên ~7.5 (quá tải). Không thể tăng số luồng import trên server.

Máy Mac của user là **Apple M4, 10 nhân (4P+6E), 24 GB RAM** — mạnh hơn server nhiều lần và đang rảnh. Mục tiêu: chuyển toàn bộ việc CPU nặng (tải + OCR + dịch + burn) sang Mac, server chỉ còn chứa file + Mongo + stream.

## Quyết định đã chốt với user

1. **Đưa kết quả về server bằng**: `rsync` file mp4 lên `/uploads/` + **ghi thẳng MongoDB** server (không thêm code/endpoint server). Mongo bind IP public + auth bật → Mac kết nối trực tiếp bằng connection string sẵn có.
2. **Nguồn danh sách phim**: đọc **pending từ Mongo server** — phim `sourceProvider ~ /^52api-/` có số `ShortVideo` < `sourceEpisodeCount` → tự tải nốt tập thiếu. Không nhập tay.
3. **Tắt hẳn pipeline OCR trên server**: Mac là worker duy nhất → không tranh chấp tập. Server load về gần 0.
4. **Số luồng**: mặc định **4** (an toàn, vẫn dùng máy được), config chỉnh lên tối đa **6** (đẩy công suất). Trần thực tế ~8, quá mức OCR bão hoà nhân.
5. **Lưu trữ file nặng**: ổ ngoài **`/Volumes/BINGNET/`** (exFAT, 3.3 TB trống). Ổ chính chỉ còn 20 GB (đầy 91%) nên bắt buộc. Code worker + Python venv giữ trên ổ chính (exFAT không hỗ trợ symlink/permission tốt cho venv).

## Kiến trúc

```
┌─ Mac M4 (10 nhân, 24GB) ───────────────────────┐        ┌─ Server 103.179.185.196 ─┐
│  worker.js (Node)                               │        │                          │
│   1. Mongo query → phim thiếu tập               │◀──────▶│  MongoDB (bind public,   │
│   2. duanjuProvider.resolveVideo → tải mp4      │        │   auth) :27017           │
│      (qua SOCKS5 127.0.0.1:1080 → HK VPS)       │        │                          │
│   3. subtitleVideoBuffer: OCR→dịch→burn         │        │  /uploads/*.mp4          │
│      (file tạm + output trên BINGNET)           │──rsync▶│                          │
│   4. rsync mp4 → /uploads + insert ShortVideo   │        │  node index.js           │
│      + update sourceEpisodeCount                │        │   (importConcurrency=0,  │
│                                                 │        │    CHỈ stream)           │
│  Python venv OCR + ffmpeg (ổ chính)             │        │  nginx → app             │
│  Media: /Volumes/BINGNET/247drama-render/       │        │                          │
└─────────────────────────────────────────────────┘        └──────────────────────────┘
```

Server sau khi cắt OCR chỉ làm: lưu file, Mongo, stream. CPU về gần 0.

## Thành phần

### 1. Thư mục worker — `/Users/kevin/video/247drama-worker/` (ổ chính)

Bê từ server (rsync 1 chiều, đọc-only nguồn):
- `util/duanjuProvider.js` (có `hg_decrypt`, resolveVideo, proxy)
- `util/asrOcr.js`, `scripts/ocr_subs.py`
- `util/subtitle.js`, `util/transcode.js`, `util/translate.js`, `util/autosub.js`
- `models/movieSeries.model.js`, `models/shortVideo.model.js`, `models/setting.model.js`
- `package.json` deps: `mongoose`, `axios`, `socks-proxy-agent`, `https-proxy-agent`, `dotenv`, `fluent-ffmpeg` (nếu autosub/probe dùng)

Thêm mới:
- `worker.js` — orchestrator (mô tả ở §4)
- `.env` — `MongoDb_Connection_String`, đường dẫn `WORK_DIR`, `RENDER_CONCURRENCY`, `OCR_THREADS`, `SERVER_SSH` (user@host + password path). Gemini key / 52api key / proxyUrl **đọc từ `settingJSON` trong Mongo** (không hardcode), giống server.

### 2. Môi trường Mac (setup 1 lần)

- **Python venv** (ổ chính, vd `~/.venvs/247drama-ocr`): `pip install rapidocr-onnxruntime==1.4.4 onnxruntime opencv-python-headless numpy`. `ocr_subs.py` chạy y nguyên, onnxruntime có wheel arm64.
- **ffmpeg + ffprobe**: cài lại đầy đủ qua brew (`ffmpeg` hiện có nhưng **thiếu `ffprobe`** → bản lỗi). Font **DejaVu Sans** cho libass burn chữ Việt (chữ Trung đã cháy trong pixel, không cần font CJK).
- **SOCKS5 tunnel** tới HK VPS: `ssh -fN -D 127.0.0.1:1080 root@47.76.79.169`. Dùng lại `proxyUrl=socks5://127.0.0.1:1080` có sẵn trong `settingJSON`. hg thử tải direct trước, hm bắt buộc qua proxy (CDN cbread.cn chặn từ VN).
- **BINGNET workdir**: `/Volumes/BINGNET/247drama-render/{download,tmp,output}`. Set `TMPDIR=/Volumes/BINGNET/247drama-render/tmp` khi chạy worker → `os.tmpdir()` trong autosub tự ghi file tạm ra ổ ngoài, không cần sửa code.

### 3. Tắt pipeline server (1 lần, lúc Mac bắt đầu)

- Kill `reimport_all_hm.js` (đang chạy) + mọi process `ocr_subs.py` / `ffmpeg` đang render.
- Set `chineseDramaApi.importConcurrency = 0` trong Mongo → **restart `node index.js`** để auto-resume không spawn OCR.
- Kiểm chứng: `ps` không còn ocr/ffmpeg; load average tụt.

### 4. `worker.js` — vòng lặp chính

Khởi động:
- `mongoose.connect(MongoDb_Connection_String)`; load `settingJSON = Setting.findOne().lean()` → gán `global.settingJSON` (các module `duanjuProvider`/`autosub` đọc từ đây).
- Đảm bảo tunnel SOCKS + workdir BINGNET tồn tại.

Tìm việc:
- Query `MovieSeries` `sourceProvider ~ /^52api-/`. Với mỗi phim: đếm `ShortVideo` đã có + đọc `sourceVideoId` đã có; so với `sourceEpisodeCount` (và danh sách tập từ `duanjuProvider.detail`) → ra **danh sách tập còn thiếu** (dedup theo `sourceVideoId` → idempotent, chạy lại không nhân đôi).

Xử lý mỗi tập (song song `RENDER_CONCURRENCY` luồng, dùng `p-limit`):
1. `resolveVideo(provider, sourceId, videoId)` → URL mp4.
2. `downloadToBuffer(url, {useProxy})` → buffer (proxy cho hm).
3. `subtitleVideoBuffer(buffer, cfg)` → `{buffer: outMp4, subbed, segments, reason}`. cfg lấy từ `settingJSON` (apiKey Gemini, model, batch, OCR params). `OCR_THREADS` giới hạn thread mỗi process để nhiều luồng không giành nhân.
4. Ghi `outMp4` ra `BINGNET/output/<tên file>.mp4`.
5. **rsync/scp** file đó lên `server:/var/www/247drama/backend/uploads/<tên file>.mp4`.
6. `ffprobe` lấy `duration`.
7. **Insert `ShortVideo`** vào Mongo — **sao y đúng shape** mà `process52apiEpisodes` trên server đang tạo: `videoUrl` (đúng base URL server đang dùng — sẽ đọc 1 record hiện có để khớp, không đoán), `videoImage`/thumbnail, `isLocked`/`coin` (theo `freeEpisodesForNonVip`), `sourceProvider`, `sourceVideoId`, `subLang`, `duration`, `movieSeries`, `episodeNumber`.
8. `MovieSeries.updateOne(... $inc source/hoặc set sourceEpisodeCount)` cho khớp.

Tuỳ chọn: giữ bản mp4 gốc (chưa burn) trên `BINGNET/download` làm backup, hoặc xoá sau khi insert thành công (config).

Kết thúc phim → log tiến độ (đã X/Y tập). Hết phim pending → dừng (hoặc chờ & quét lại nếu bật chế độ daemon — mặc định chạy 1 lượt rồi dừng).

### 5. Luồng dữ liệu

```
Mongo(pending) → resolveVideo → download(→BINGNET) → OCR+dịch+burn(BINGNET tmp)
→ output(BINGNET) → rsync(→server /uploads) → ffprobe → insert ShortVideo(Mongo)
→ update MovieSeries.sourceEpisodeCount
```

## Xử lý lỗi & an toàn

- **Idempotent**: bỏ qua tập đã có `sourceVideoId` trong Mongo → chạy lại worker an toàn, không trùng.
- **Tập lỗi** (tải/OCR/dịch fail): log + skip, không làm hỏng cả phim; lượt sau tự thử lại (vì vẫn nằm trong "tập thiếu").
- **Mac tắt/mất mạng giữa chừng**: chỉ mất tập đang render dở (file tạm trên BINGNET); Mongo chưa insert → lượt sau tính lại từ Mongo, tiếp tục đúng chỗ.
- **rsync fail**: không insert Mongo cho tập đó → tránh record trỏ file không tồn tại. Thứ tự bắt buộc: **rsync xong mới insert**.
- **`videoUrl` base**: đọc 1 record `ShortVideo` 52api hiện có để lấy đúng format, không đoán.
- **Không sửa code server**: mọi thay đổi ở phía Mac + 1 lần set `importConcurrency=0` trong DB.

## Mặc định đã chốt

- **Giữ bản mp4 gốc** (chưa burn) trên `BINGNET/download` làm backup (ổ còn 3.3 TB, dư sức). Không xoá.
- Worker **chạy 1 lượt hết pending rồi dừng** (không daemon ở bản đầu).
- **1 máy** (M4) ở bản đầu — không có claim/lock.

## Đường mở rộng đa máy (tương lai, KHÔNG làm bản này)

User đã chốt làm 1 máy trước. Khi cần scale catalog lớn, chạy song song nhiều máy (Mac/PC) bằng cách thêm:
- Collection **`RenderJob`** trong Mongo: `{movieSeries, provider, sourceId, videoId, episodeNumber, status: pending|processing|done|failed, workerId, leaseAt, attempts}`.
- Mỗi máy **claim nguyên tử** `findOneAndUpdate({status:"pending"}, {status:"processing", workerId, leaseAt: now})` → Mongo đảm bảo 1 tập chỉ 1 máy lấy. Lease hết hạn (máy chết) → tập quay lại `pending`.
- Mỗi máy: cùng code + venv + ffmpeg + tunnel HK riêng + scratch dir riêng + rsync riêng lên `/uploads`.
- **Nút thắt chung khi nhiều máy = rate limit 52api** (`resolveVideo`, gói free ~1 req/3s tính theo API key, KHÔNG theo máy) → nên nạp gói trả phí 52api (tới 20 QPS). OCR/burn thì scale tuyến tính theo số máy, không nghẽn.
- Cấu trúc `worker.js` bản 1-máy nên tách hàm "tìm tập thiếu" và "render 1 tập" rời nhau để sau bọc claim dễ dàng.

## Không làm (YAGNI)

- Không thêm endpoint/API server.
- Không mirror S3 (dùng rsync /uploads như pipeline hiện tại).
- Không làm UI. Worker chạy bằng lệnh terminal.
- Không `RenderJob`/claim ở bản này (chỉ 1 máy).

## Kiểm thử (end-to-end)

1. Setup venv OCR + ffmpeg/ffprobe + tunnel SOCKS trên Mac → verify OCR chạy 1 file mẫu, tunnel `curl --socks5` ra IP HK.
2. Chạy worker chế độ **1 tập** (limit) trên 1 phim pending (vd Trọng Sinh 52/76) → kiểm tra: file xuất hiện trong `/uploads` server, record `ShortVideo` mới trong Mongo, `videoUrl` mở phát được, sub Việt khớp sub Trung.
3. So sánh record mới vs record cũ do server tạo → cùng shape (isLocked/coin/videoImage/subLang/duration).
4. Mở app/admin → tập mới hiện, phát được.
5. Bật full concurrency, chạy hết pending → theo dõi load Mac + throughput. Verify server load ~0 (không còn OCR).
6. Chạy lại worker lần 2 → không tạo tập trùng (idempotent).

## Rủi ro / lưu ý

- exFAT không có quyền Unix (noowners) — ok cho media, **không đặt venv ở đó**.
- Mac là máy cá nhân: 4 luồng để còn dùng máy; 6 luồng thì nên để chạy riêng.
- Mongo ghi thẳng từ Mac = quyền ghi DB prod trên máy cá nhân → giữ connection string cẩn thận; chỉ insert/update đúng collection.
- 52api rate limit (free ~1 req/3s) — `duanjuProvider` đã có throttle dùng chung, giữ nguyên.
