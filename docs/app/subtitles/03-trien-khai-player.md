# 03 — Triển khai ở player

## Định dạng file phụ đề

WebVTT, UTF-8, phục vụ với `Content-Type: text/vtt; charset=utf-8`. Ví dụ thật (tập 1 phim `hg:7428896824548674622`):

```
WEBVTT

00:00:02.240 --> 00:00:03.520 line:73% align:center
Long thủ mới nhậm chức.

00:00:03.520 --> 00:00:05.120 line:73% align:center
Sắp đến Giang Thành.
```

Đặc điểm phải tôn trọng:

- **`line:NN%` là bắt buộc giữ.** Video gốc vẫn còn dòng chữ Hán ở dưới; phụ đề của ta được tính toán để nằm ngay **dưới** dòng chữ Hán đó, cách khoảng 0,3 cm. Mỗi tập có giá trị riêng (thường 70–80%) vì vị trí chữ Hán khác nhau. Player **không được** ép vị trí phụ đề của riêng nó (kiểu "luôn dán đáy màn hình"), nếu ép thì chữ Việt sẽ chồng lên chữ Hán.
- `align:center` — căn giữa theo chiều ngang.
- Hai track `vi` và `en` có **cùng mốc thời gian, cùng số cue**, dịch từ cùng một câu gốc. Đổi ngôn ngữ giữa chừng không cần seek lại.
- Mốc thời gian khớp đúng file mp4 tương ứng, không có độ trễ cần bù.

Gợi ý trình bày: chữ trắng, viền đen 2px hoặc bóng đổ, cỡ chữ theo chuẩn của player. Không thêm nền đen đặc kín vì sẽ che dòng chữ Hán và làm khung hình rối.

## iOS (AVPlayer)

`AVPlayer` không nạp được file phụ đề rời từ URL khác. Hai cách:

1. **Tự vẽ (khuyến nghị cho giai đoạn này).** Tải file `.vtt`, tự phân tích, hiển thị bằng một `UILabel` phủ trên `AVPlayerLayer`, cập nhật theo `addPeriodicTimeObserver`. Vị trí dọc của label lấy từ `line:NN%` của cue: `y = videoRectHeight * NN/100`. Việc phân tích WebVTT đơn giản vì file chỉ dùng cue cơ bản.
2. **HLS server-side.** Nếu sau này chuyển sang HLS thì nhét track phụ đề vào master playlist rồi dùng `AVMediaSelectionGroup`. Chưa làm ở giai đoạn này vì kho đang là mp4 tiến bộ.

## Android (ExoPlayer / Media3)

ExoPlayer hỗ trợ sẵn phụ đề rời:

```kotlin
val subtitle = MediaItem.SubtitleConfiguration.Builder(Uri.parse(track.url))
    .setMimeType(MimeTypes.TEXT_VTT)
    .setLanguage(track.lang)          // "vi" hoặc "en"
    .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
    .build()

val item = MediaItem.Builder()
    .setUri(video.videoUrl)
    .setSubtitleConfigurations(listOf(subtitle))
    .build()
```

Chỉ gắn **một** track — track đã chọn — rồi tạo lại `MediaItem` khi người dùng đổi ngôn ngữ, hoặc gắn cả hai và chuyển bằng `TrackSelectionParameters`. Quan trọng: dùng `SubtitleView` mặc định và **không** gọi `setBottomPaddingFraction` hay ép `CaptionStyleCompat` che vị trí, để ExoPlayer áp đúng `line:` trong file.

## Web (thẻ video HTML5)

```html
<video src="...ep1.mp4" crossorigin="anonymous">
  <track kind="subtitles" src="...ep1.v1.vi.vtt" srclang="vi" label="Tiếng Việt" default>
</video>
```

**Chặn hiện tại: CDN chưa bật CORS.** Kiểm tra ngày 19/08/2026 trên `cdn.247tv.app`: request `OPTIONS` trả 403 và request `GET` kèm `Origin` không có header `Access-Control-Allow-Origin`. Trình duyệt vì vậy sẽ từ chối nạp `.vtt` qua `<track crossorigin>` hoặc `fetch`. Trước khi làm bản web phải thêm quy tắc CORS cho bucket R2 `247drama`: cho phép `GET`, `HEAD` từ origin của web, header `Origin` và `Range`. App native không bị ảnh hưởng.

## Bộ nhớ đệm

| Loại file | `Cache-Control` hiện tại | Ý nghĩa với app |
| --- | --- | --- |
| `.mp4` | `public, max-age=31536000, immutable` | Cache thoải mái, tên file đổi khi nội dung đổi |
| `.vtt` | `public, max-age=300, must-revalidate` | Không cache quá 5 phút; luôn lấy URL mới từ API thay vì nhớ URL cũ |

Khi một tập được render lại, số phiên bản trong tên file `.vtt` tăng (`.v1.` → `.v2.`) và bản ghi API trỏ sang file mới. App nào giữ URL cũ trong bộ nhớ vẫn phát được (file cũ không bị xoá), nhưng sẽ hiển thị bản dịch cũ — nên đọc lại danh sách tập khi mở phim là đủ.

## Đo lường nên gắn

- Sự kiện `subtitle_shown` kèm `lang`, `source` (`default_ip` / `user_choice` / `fallback`).
- Sự kiện `subtitle_load_failed` kèm mã HTTP — đây là tín hiệu sớm cho hỏng R2 hoặc render thiếu file.
