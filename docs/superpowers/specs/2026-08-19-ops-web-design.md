# Web vận hành nhập phim 52api — Design

**Ngày:** 2026-08-19 · **Repo:** `/Users/kevin/video` · **Server:** `103.179.185.196`

## Mục tiêu

Một trang web đơn giản để: duyệt kho phim 52api (tên + mô tả + ảnh bìa), chọn phim là hệ thống tự tải, dịch phụ đề Việt và Anh, upload R2; kèm bảng trạng thái realtime và bảng sức khoẻ cho biết phim nào đã dịch xong, tập nào lệch.

## Quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Nơi chạy web | Server `103.179.185.196` | Vào được từ điện thoại; máy Mac không phải mở cổng |
| Cách giao việc | Tạo bản ghi `MovieSeries` trong Mongo | `findPendingWork` đã quét `sourceProvider: /^52api-/` — không cần bảng hàng đợi riêng |
| Phạm vi khi chọn phim | Tạo phim trong app + render toàn bộ tập | Đúng luồng nhập phim đang làm tay |
| Kiểu phụ đề | `soft`: video sạch + `.vi.vtt` + `.en.vtt` | Lựa chọn của chủ dự án |
| Nguồn duyệt phim | Provider 52api (`hg`/`hm`) | Trang admin hiện gọi `api.sansekai.my.id` — khác nguồn với worker, không dùng lại |

**Rủi ro đã biết và chấp nhận:** app hiện chưa đọc `subTracks`, nên phim nhập qua web sẽ không có phụ đề trên app cho tới khi app cập nhật. Web hiện cảnh báo thường trực dòng này.

## Kiến trúc

```
Trình duyệt (điện thoại/máy)
   │  ops.html  ── nginx (tĩnh)
   │  /api/ops/*  ── backend Express sẵn có (thêm route, không thêm process)
   ▼
MongoDB  ◄──────────── worker trên Mac (poll mỗi vòng)
   │ MovieSeries (bookId, sourceProvider)      │ tải mp4 → OCR → dịch vi + en
   │ ShortVideo  (episodeNumber, sourceVideoId)│ → encode sạch → R2 → upsert
   ▼                                            │
render-status.json (worker đẩy lên /uploads mỗi 3s) ──► web poll 2s
```

## 1. Worker — `/Users/kevin/video/247drama-worker`

### 1.1 Neo tập theo `videoId` (`work.js`)

`detail()` gán số tập theo **vị trí** trong danh sách nguồn (`lists.map((ep, i) => ({ index: i }))`), nên nguồn chèn/xoá/đảo một tập là mọi số tập sau đó trỏ sai. Định danh ổn định duy nhất là `video_id`, và ta đã lưu nó trong `ShortVideo.sourceVideoId`.

`computeMissingEpisodes(detailEpisodes, existingRows)` đổi chữ ký: nhận mảng bản ghi `{episodeNumber, sourceVideoId}` thay vì tập hợp số, rồi phân loại từng tập nguồn:

- **missing** — chưa có bản ghi nào ở vị trí đó → render.
- **ok** — có bản ghi, `sourceVideoId` khớp → bỏ qua.
- **drift** — có bản ghi nhưng `sourceVideoId` khác → **không render, không ghi đè**, đưa vào danh sách lệch để web hiển thị.

Bản ghi cũ chưa có `sourceVideoId` (nhập trước khi worker ghi field này) coi là **ok**, không phải drift — nếu không, cả kho cũ sẽ bị báo lệch giả.

`findPendingWork()` trả thêm `drift: [{index, storedVideoId, sourceVideoId}]` cho mỗi phim.

### 1.2 Nghi thức nghiệm thu bản dịch (`util/autosub.js`, `render.js`)

Ngưỡng `hanRatio > 0.5` hiện tại chỉ bắt được trường hợp dịch chết hoàn toàn; một lô dịch hụt (mỗi lô 20-40 dòng) vẫn lọt. Siết lại: một tập chỉ được publish khi đạt **cả ba**:

1. `hanRatio(viSegs) < 0.05` và `hanRatio(enSegs) < 0.05`.
2. Số cue `vi` = số cue `en` = số dòng OCR đưa vào dịch.
3. Cả hai `.vtt` upload xong đọc lại được từ R2 đúng kích thước (đã có `uploadAndVerify`).

Không đạt bất kỳ điều nào → `renderEpisode` trả `{ok:false, reason}`, không upsert Mongo, tập tự nằm lại trong danh sách thiếu để lần sau render lại.

### 1.3 Tên file phụ đề mang phiên bản (`config.js`, `render.js`)

`buildSubKey(provider, sourceId, index, lang, version)` → `videos/hg_<id>_ep5.v2.vi.vtt`. `version` lấy từ `ShortVideo.subVersion` hiện có cộng 1 (chưa có thì bằng 1), ghi lại vào bản ghi cùng lúc với `subTracks`.

Mục đích: render lại mà upload `.vtt` hỏng giữa chừng thì bản ghi Mongo vẫn trỏ vào bộ file cũ nhất quán, không bao giờ có cảnh video mới nằm cạnh sub cũ. Key `.mp4` giữ nguyên để `videoUrl` trong app không đổi.

File `.vtt` phiên bản cũ thành mồ côi trên R2 — chấp nhận (mỗi file vài KB), dọn bằng tay sau nếu cần.

## 2. Backend — `/Users/kevin/video/247drama-backend`

Thêm route `/api/ops/*` vào backend sẵn có. Không thêm process pm2, không sửa API mà app đang gọi.

### 2.1 Bảo vệ

`util/opsAuth.js`: middleware so header `ops-key` với `process.env.OPS_PASSWORD` (thêm vào `.env` trên server, không commit). Sai hoặc thiếu → 401. Trang web lưu mật khẩu trong `localStorage`, gửi kèm mọi request.

Tách khỏi `secretKey` của app: lộ khoá ops không mở được API người dùng và ngược lại.

### 2.2 Client 52api phía server — `util/duanju52.js`

Bản rút gọn của `247drama-worker/util/duanjuProvider.js`, chỉ phần đọc: `search`, `topCategories`, `topList`, `detail`. Đọc key từ `Setting.chineseDramaApi.apiKey` (nơi worker đang dùng). Hai cơ chế bắt buộc:

- **Throttle 3.2s/request** giống worker — cùng một key, hai tiến trình gọi song song sẽ dính rate limit.
- **Cache RAM 10 phút** theo (endpoint + tham số). Mỗi lần duyệt là một lượt API mất tiền thật; bấm tới lui trang không được đốt quota.

### 2.3 Endpoint

| Endpoint | Việc |
|---|---|
| `GET /api/ops/ping` | Kiểm mật khẩu đúng chưa (trang dùng để mở khoá) |
| `GET /api/ops/options` | Danh sách category + language để chọn khi nhập phim |
| `GET /api/ops/catalog?provider&type=top\|search&keyword&cellId&page` | Duyệt kho: trả `{sourceId, name, description, cover, imported}`; `imported` đối chiếu `MovieSeries.bookId` |
| `GET /api/ops/detail?provider&sourceId` | Xem trước: mô tả đầy đủ + số tập |
| `POST /api/ops/import` | Tạo `MovieSeries`; body `{provider, sourceId, categoryId, languageId, type}` |
| `GET /api/ops/queue` | Bảng sức khoẻ mọi phim 52api (chỉ đọc Mongo, không gọi 52api) |
| `GET /api/ops/health?bookId` | Đối chiếu `videoId` của một phim với nguồn (tốn 1 lượt 52api) |
| `DELETE /api/ops/series/:id` | Xoá phim — chỉ khi `createdByOps === true` và chưa có tập nào |

### 2.4 Tạo phim (`POST /api/ops/import`)

Gọi `detail(provider, sourceId)` rồi tạo `MovieSeries`:

```js
{
  name: info.title,
  description: info.description,
  thumbnail: info.cover,
  banner: info.cover,
  bookId: `${provider}:${sourceId}`,       // worker đọc qua extract52apiSource
  sourceProvider: `52api-${provider}`,      // findPendingWork lọc theo field này
  sourceEpisodeCount: info.episodes.length,
  category: categoryId,
  language: languageId,
  type,                                     // theo enum CONTENT_TYPE sẵn có
  maxAdsForFreeView: 0,
  isActive: true,
  createdByOps: true,
}
```

Không tạo tập nào — worker phát hiện phim thiếu tập ở vòng quét kế tiếp và render dần.

Chống trùng: `bookId` đã có unique index; trùng thì trả 409 kèm tên phim đang có.

Model thêm hai field: `MovieSeries.createdByOps` (Boolean, mặc định false), `MovieSeries.sourceProvider` + `sourceEpisodeCount` nếu chưa khai (worker đang ghi nhưng schema server chưa có → Mongoose strict sẽ vứt khi tạo từ backend).

### 2.5 Bảng sức khoẻ (`GET /api/ops/queue`)

Mỗi phim một dòng, gộp bằng aggregate trên `ShortVideo`:

```
tên | tổng tập nguồn (sourceEpisodeCount) | đã render | có sub vi | có sub en | burnedLang="vi" (tập cũ) | cập nhật gần nhất
```

"Có sub vi/en" đếm theo `subTracks.lang`. Nhìn một bảng là biết phim nào chưa dịch xong.

## 3. Trang web — `247drama-worker/web/ops.html`

Một file HTML tĩnh, không build, không framework — giống `render-status.html` đang chạy. Deploy bằng cách copy lên `/var/www/247drama/backend/uploads/ops.html`, truy cập `http://103.179.185.196/uploads/ops.html`.

Ba khối:

1. **Duyệt & nhập phim** — chọn provider (`hg`/`hm`), chọn bảng xếp hạng hoặc gõ từ khoá; lưới thẻ phim có ảnh bìa, tên, mô tả rút gọn, nút **Nhập** (hỏi category + language trước khi gửi). Phim đã nhập hiện nhãn "đã có" và tắt nút.
2. **Đang chạy (realtime)** — poll `/uploads/render-status.json` mỗi 2 giây: worker sống hay chết (theo mốc thời gian trong file), tập đang render + pha (tải / sub / upload), tiến độ từng phim, tốc độ, ETA, số tập lỗi.
3. **Sức khoẻ kho phim** — poll `/api/ops/queue` mỗi 15 giây, hiện bảng ở mục 2.5, kèm nút "Kiểm lệch" gọi `/api/ops/health` cho từng phim.

Đầu trang có dải cảnh báo cố định: *"Chế độ soft — app chưa đọc subTracks, phim nhập mới sẽ chưa có phụ đề trên app."*

## Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| 52api hết hạn mức | Endpoint trả 502 kèm nguyên văn `超出免费总额度`; web hiện đúng câu đó, không nuốt lỗi |
| Nguồn đổi thứ tự tập | Không ghi đè; hiện ở cột "lệch" trong bảng sức khoẻ để người quyết |
| Dịch hụt / còn chữ Hán | Bỏ tập, không upsert; tập tự vào danh sách render lại |
| Upload R2 hụt | `uploadAndVerify` ném lỗi, tập tính là thất bại |
| Worker tắt | `render-status.json` cũ quá 60 giây → web hiện "worker đang tắt", bảng sức khoẻ vẫn dùng được |
| Nhập trùng phim | 409 kèm tên phim đang có |

## Kiểm thử

- **Unit (worker):** `computeMissingEpisodes` phân loại đúng ba nhóm missing/ok/drift, kể cả bản ghi cũ thiếu `sourceVideoId`; `buildSubKey` sinh đúng key có phiên bản; nghi thức nghiệm thu bắt được từng trường hợp (hanRatio cao, lệch số cue).
- **Unit (backend):** chuẩn hoá dữ liệu catalog từ hai provider; cache trả lại kết quả cũ trong 10 phút và gọi lại sau đó; `import` chặn trùng `bookId`.
- **E2E:** nhập một phim ít tập qua web → thấy trong bảng sức khoẻ với 0/N tập → chạy worker một vòng → tập đầu xuất hiện, `subTracks` có 2 phần tử, trạng thái realtime đổi trên web.
- **Đối chứng:** phim cũ (`burnedLang: "vi"`, không có `subTracks`) vẫn hiện đúng trong bảng, không bị báo lệch.

## Triển khai

1. Sửa + test worker ở máy Mac (mục 1), commit.
2. Sửa backend trong bản mirror, rsync lên server, `pm2 reload backend` (đã có backup theo quy trình cũ).
3. Copy `ops.html` vào `/var/www/247drama/backend/uploads/`.
4. Thêm `OPS_PASSWORD` vào `.env` server.
5. Nhập thử một phim ít tập, chạy worker, nghiệm thu theo mục E2E.

## Ngoài phạm vi

- **Sửa ảnh bìa (xoá chữ Trung, vẽ chữ Việt/Anh, hiển thị theo IP)** — hệ thống riêng, sẽ có spec riêng sau khi web này chạy.
- Sửa app để đọc `subTracks` — thuộc giai đoạn 2 của tính năng phụ đề song ngữ.
- Xoá phim đã có tập, sửa thông tin phim — làm ở trang admin sẵn có.
- Dọn file `.vtt` mồ côi của các phiên bản cũ.
