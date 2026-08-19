# 01 — Hợp đồng dữ liệu

## Endpoint trả dữ liệu phụ đề

Cả ba endpoint dưới đây đều nằm sau middleware `checkAccessWithSecretKey`, tức mọi request phải có header `key: <secretKey>`.

| Method | Đường dẫn | Dùng ở đâu |
| --- | --- | --- |
| GET | `/api/client/shortVideo/retrieveMovieSeriesVideosForUser` | Màn xem tập trong app |
| GET | `/api/client/shortVideo/loadMovieSeriesVideosForUser` | Bản web |
| GET | `/api/client/shortVideo/getVideosGroupedByMovieSeries` | Danh sách "Dành cho bạn" (trailer) |

Base URL production: `http://103.179.185.196`.

## Trường mới ở cấp phản hồi

```json
{
  "status": true,
  "message": "Retrieved videos from a specific movie series for the user.",
  "userInfo": { "coin": 120, "episodeUnlockAds": 0 },
  "totalVideosCount": 78,
  "isAutoUnlockEnabled": false,
  "subDefault": "vi",
  "data": { "...": "..." }
}
```

**`subDefault`**: `"vi"` hoặc `"en"`. Server tra IP người xem bằng `geoip-lite` ngay trong request đó:

- quốc gia `VN` → `"vi"`
- quốc gia khác → `"en"`
- không tra được IP (IP nội bộ, dải lạ, lỗi) → `"vi"` vì Việt Nam là thị trường chính

IP được lấy từ phần tử **đầu tiên** của header `X-Forwarded-For` do nginx đặt, nếu không có thì lấy `req.ip`. Giá trị này tính lại theo từng request, nên cùng một tài khoản khi bay ra nước ngoài sẽ nhận `en`.

## Trường mới ở từng tập

Trong `data.videos[]` (và trong nhóm của `getVideosGroupedByMovieSeries`), mỗi tập có thêm:

```json
{
  "_id": "6a673ebbfc55dd19943ffccc",
  "episodeNumber": 1,
  "videoImage": "https://.../thumb.jpg",
  "videoUrl": "https://cdn.247tv.app/videos/hg_7428896824548674622_ep1.mp4",
  "isLocked": true,
  "coin": 10,
  "isLike": false,
  "totalLikes": 0,
  "burnedLang": "",
  "subTracks": [
    { "lang": "vi", "url": "https://cdn.247tv.app/videos/hg_7428896824548674622_ep1.v1.vi.vtt" },
    { "lang": "en", "url": "https://cdn.247tv.app/videos/hg_7428896824548674622_ep1.v1.en.vtt" }
  ]
}
```

### `subTracks: [{ lang, url }]`

- `lang`: `"vi"` hoặc `"en"`. Không có mã ngôn ngữ nào khác ở thời điểm này.
- `url`: URL tuyệt đối tới file WebVTT trên CDN, `Content-Type: text/vtt; charset=utf-8`.
- Mảng **rỗng** nghĩa là tập không có phụ đề rời — xem `burnedLang`.
- Thứ tự phần tử không phải hợp đồng. Luôn tìm theo `lang`, đừng lấy theo chỉ số.

**Bắt buộc: dùng nguyên `url` server trả về, không tự ghép chuỗi.** Tên file có nhiều dạng cùng tồn tại: bản render mới có số phiên bản (`..._ep1.v1.vi.vtt`), vài tập render thử trước đó thì không (`..._ep108.vi.vtt`). Số phiên bản tăng mỗi lần render lại một tập, để bộ phụ đề mới không đè lên bộ cũ đang phát dở. App tự đoán tên file sẽ lấy nhầm hoặc 404.

### `burnedLang`

- `""` — video sạch, phụ đề nằm ở `subTracks` (hoặc không có).
- `"vi"` — phụ đề tiếng Việt đã in vào khung hình, không tắt được. Người xem ở nước ngoài vẫn thấy tiếng Việt; đây là giới hạn đã biết của 3.840 tập cũ, không phải lỗi app.

Trường này luôn tồn tại (mặc định `""` trong schema), nhưng app vẫn nên đọc phòng thủ vì bản ghi cũ có thể thiếu.

## Tên và mô tả phim cũng theo quốc gia

Từ 19/08/2026, phim nhập từ 52api được dịch tên và mô tả ngay lúc nhập: `name` và `description` trả về là **bản tiếng Việt**, `nameEn` / `descriptionEn` giữ bản tiếng Anh, `nameOriginal` / `descriptionOriginal` giữ nguyên tiếng Trung của nguồn.

**App không phải làm gì thêm.** Backend tự đổi: người xem ngoài Việt Nam nhận luôn tên và mô tả tiếng Anh trong `name` / `description` của mọi endpoint client, dùng đúng quy tắc IP của `subDefault`. Cùng một phim:

| IP người xem | `name` trả về |
| --- | --- |
| `113.161.0.1` (VN) | Chiến Thần Phương Bắc 2 |
| `8.8.8.8` (ngoài VN) | God of War of the Northern Realm 2 |

Phim chưa dịch được (Gemini lỗi lúc nhập) vẫn giữ tên gốc cho tới khi người vận hành bấm "Dịch lại" — app cứ hiển thị những gì server trả về, không cần xử lý riêng.

Ảnh bìa và banner thì **chưa** xử lý: chữ trên ảnh vẫn là tiếng Trung. Việc này nằm ở giai đoạn sau.

## Tương thích ngược

Bản app hiện tại không biết hai trường này vẫn chạy bình thường: nó bỏ qua `subTracks` và phát video sạch không phụ đề. Vì vậy **tập soft-sub sẽ trông như mất phụ đề trên app cũ** — cần ép nâng cấp hoặc chỉ bật soft-sub cho phim mới cho tới khi app mới phủ hết người dùng.
