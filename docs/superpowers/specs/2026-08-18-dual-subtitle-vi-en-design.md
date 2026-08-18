# Phụ đề song song vi/en theo quốc gia — Design

**Ngày:** 2026-08-18 · **Repo:** `/Users/kevin/video` (worker) + `103.179.185.196:/var/www/247drama` (backend/app)

## Mục tiêu

Người xem ở Việt Nam thấy phụ đề tiếng Việt, người xem ngoài Việt Nam thấy phụ đề tiếng Anh, trên cùng một file video. Người dùng đổi được thủ công.

## Quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Kiến trúc sub | **Soft-sub**: 1 video "sạch" + 2 file WebVTT | Render 1 lần, R2 không tăng gấp đôi; đổi lại phải sửa backend + app |
| Nguồn bản dịch EN | Dịch từ **tiếng Trung gốc** (`zhSegs`) | Dịch zh→vi→en tam sao thất bản; `zhSegs` đã có sẵn trong RAM, chỉ thêm 1 lượt Gemini |
| Ai quyết định ngôn ngữ | **Backend**, theo IP | Server thấy IP thật; app chỉ hiển thị, không tự đoán |
| 3.936 tập cũ | **Giữ nguyên** (sub Việt cháy sẵn) | Backfill tốn ~15-20 giờ máy; kho cũ vẫn phục vụ tốt thị trường chính |

## Kiến trúc

```
Worker (Mac)                    R2                      Backend                 App
─────────────                   ──                      ───────                 ───
tải mp4 (52api)
  → OCR sub Trung  ──zhSegs──┐
                             ├─ Gemini zh→vi ─→ ep.vi.vtt ─┐
                             └─ Gemini zh→en ─→ ep.en.vtt ─┤
  → drawbox che sub Trung                                  ├→ subTracks[] ──→ hiện track
     (KHÔNG đốt chữ)          ─→ ep.mp4 ──────────────────┘   subDefault ───→ theo IP
                                                              (geoip: VN→vi)
```

## 1. Worker — `/Users/kevin/video/247drama-worker`

### 1.1 `util/translate.js` — không đổi
Đã nhận `targetLang`, gọi được cho cả `vi` lẫn `en`.

### 1.2 `util/vtt.js` — file mới
Một hàm `segsToVtt(segments)`: `[{start,end,text}]` → chuỗi WebVTT (`HH:MM:SS.mmm --> HH:MM:SS.mmm`). Áp dụng cùng `subStartOffsetMs` mà `buildAss` đang dùng để timing khớp với bản burn.

### 1.3 `util/transcode.js` — thêm `transcodeCleanBox(srcPath, box)`
Bằng `transcodeBurnSub` nhưng `vf` chỉ có `drawbox`, bỏ `ass=`. Giữ nguyên tham số encode hiện tại (libx264, veryfast, crf 24, aac 128k, faststart) để chất lượng/dung lượng không đổi.

### 1.4 `util/autosub.js` — nhánh `mode`
`buildSubtitleConfig` (trong `config.js`) đọc thêm `settingJSON.subtitle.mode` (`"burn"` mặc định | `"soft"`).

- `mode === "burn"`: giữ nguyên đường đi hiện tại, không đổi một dòng nào về hành vi.
- `mode === "soft"`: sau khi có `zhSegs`, gọi `translateSegments` **hai lần song song** (`Promise.all`) cho `vi` và `en`; encode bằng `transcodeCleanBox`; trả về `{buffer, subbed: true, viSegs, enSegs, burned: false}`.

Xử lý lỗi:
- Dịch EN lỗi → vẫn trả `viSegs`, `enSegs = []`. Tập vẫn lên, chỉ thiếu track EN.
- Dịch VI lỗi → coi như thất bại phụ đề, rơi vào fallback `transcodeToH264` hiện có.
- OCR không ra chữ → như hiện tại (fallback H.264, `subbed: false`).

### 1.5 `render.js`
- Upload `<key>.vi.vtt` và `<key>.en.vtt` (chỉ khi mảng segs không rỗng), cạnh `<key>.mp4`. Giữ `.vi.json` cho nhánh lồng tiếng.
- Ghi Mongo thêm:
  - `subTracks: [{lang: "vi", url}, {lang: "en", url}]` (bỏ phần tử nào không có file)
  - `burnedLang: ""` khi soft, `"vi"` khi burn.

## 2. Backend — `/var/www/247drama/backend`

### 2.1 `models/shortVideo.model.js`
Thêm:
```js
subTracks: [{ lang: String, url: String, _id: false }],
burnedLang: { type: String, default: "" },
```

### 2.2 Migration một lần
Script `scripts/backfill-burnedlang.js`: `updateMany({burnedLang: {$exists: false}}, {$set: {burnedLang: "vi"}})` — đánh dấu 3.936 tập cũ để app ẩn nút chọn phụ đề.

### 2.3 `util/geoLang.js` — file mới
`resolveSubLang(req)`: lấy IP đầu tiên trong `X-Forwarded-For` (nginx đã set, `sites-enabled/default:25`), tra `geoip-lite` (offline, thêm vào `package.json`); `country === "VN"` → `"vi"`, ngược lại `"en"`; không tra được → `"vi"` (thị trường chính).

### 2.4 `controllers/client/shortVideo.controller.js`
Ba hàm trả danh sách tập cho app — `retrieveMovieSeriesVideosForUser`, `getVideosGroupedByMovieSeries`, `loadMovieSeriesVideosForUser` — trả thêm trong mỗi video object:
- `subTracks` (nguyên văn từ DB)
- `burnedLang`
- `subDefault`: kết quả `resolveSubLang(req)`

Tập cũ: `subTracks` rỗng + `burnedLang: "vi"` → app hiểu là phụ đề cháy sẵn.

## 3. App người dùng

Hợp đồng API app cần theo:

| Field | Ý nghĩa | Hành vi app |
|---|---|---|
| `subTracks` | mảng `{lang, url}` WebVTT | Nạp vào player làm track ngoài |
| `subDefault` | `"vi"` \| `"en"` | Track bật sẵn khi mở tập |
| `burnedLang` | `"vi"` = phụ đề cháy sẵn | Ẩn nút chọn phụ đề, không nạp track |

Thêm nút CC: vi / en / tắt. Lựa chọn của người dùng lưu local và **đè** `subDefault` ở các tập sau, cho tới khi họ đổi lại.

## Kiểm thử

- Unit (worker): `segsToVtt` — định dạng timestamp, escape xuống dòng, mảng rỗng trả chuỗi rỗng.
- Unit (backend): `resolveSubLang` — IP Việt Nam → `vi`, IP Mỹ → `en`, IP rác/không có header → `vi`.
- E2E 1 tập: đặt `mode: "soft"`, render 1 tập bằng `scripts/redo-one.js`, kiểm tra R2 có đủ 3 file, Mongo có `subTracks` 2 phần tử, mở app thấy đúng track theo IP.
- Đối chứng: 1 tập cũ vẫn phát bình thường, không hiện nút CC.

## Triển khai

1. Deploy worker + backend (model + migration + geoip).
2. Bật `mode: "soft"` cho **một series thử** → xem 3 tập trên app thật (1 IP VN, 1 IP nước ngoài qua VPN).
3. Đạt thì bật soft toàn cục. Có sự cố thì đổi `mode` về `"burn"` — tập render sau đó quay lại y như cũ, không cần rollback code.

## Ngoài phạm vi

- Không backfill 3.936 tập cũ (có thể làm sau: tái dùng `.vi.json` trên R2 để bỏ khâu OCR, ~40-60s/tập).
- Không đụng nhánh lồng tiếng (`poc/subdub.js`).
- Không thêm ngôn ngữ thứ ba; cấu trúc `subTracks` mảng nên mở rộng được sau.
