# Phụ đề 247drama — tài liệu cho đội làm app

Bộ tài liệu này mô tả cách một tập phim mang phụ đề và cách app phải chọn phụ đề nào để hiện.

| Tài liệu | Nội dung |
| --- | --- |
| [01-hop-dong-du-lieu.md](01-hop-dong-du-lieu.md) | API trả về gì: `subTracks`, `burnedLang`, `subDefault` |
| [02-thuat-toan-chon-sub.md](02-thuat-toan-chon-sub.md) | Quy tắc chọn phụ đề, ghi đè của người dùng, các trường hợp thiếu dữ liệu |
| [03-trien-khai-player.md](03-trien-khai-player.md) | Nạp file `.vtt` trên iOS / Android / Web, định dạng và vị trí dòng chữ |
| [04-kiem-thu.md](04-kiem-thu.md) | Bảng ca kiểm thử và cách tự kiểm chứng bằng `curl` |

## Tóm tắt trong 30 giây

Kho phim đang có **hai thế hệ tập phim**, app phải xử lý được cả hai:

1. **Tập cũ — phụ đề cháy sẵn trong hình.** Video đã có chữ tiếng Việt in vào khung hình. `subTracks` rỗng, `burnedLang = "vi"`. App không làm gì cả, không hiện nút chọn phụ đề.
2. **Tập mới — phụ đề rời (soft-sub).** Video sạch (chỉ còn chữ Hán gốc của bản gốc), kèm hai file WebVTT: `vi` và `en`. `subTracks` có 2 phần tử, `burnedLang = ""`. App tự nạp file `.vtt` và vẽ phụ đề.

Mỗi phản hồi API kèm trường **`subDefault`** (`"vi"` hoặc `"en"`) — server đã tra IP người xem: ở Việt Nam trả `vi`, ngoài Việt Nam trả `en`. App chỉ việc dùng giá trị này làm lựa chọn mặc định, **không tự đoán theo ngôn ngữ máy**.

Tên và mô tả phim cũng đi theo quy tắc IP đó, nhưng **server tự đổi trước khi trả về** nên app không cần code gì thêm — chi tiết ở [01-hop-dong-du-lieu.md](01-hop-dong-du-lieu.md).

## Bảng quyết định

| `subTracks` | `burnedLang` | App phải làm gì | Nút chọn phụ đề |
| --- | --- | --- | --- |
| có `vi` và `en` | `""` | Nạp track theo `subDefault` (hoặc lựa chọn người dùng đã lưu) | Hiện: Tiếng Việt / English / Tắt |
| chỉ có 1 track | `""` | Nạp track đó, bất kể `subDefault` | Hiện: track đó / Tắt |
| rỗng | `"vi"` | Không nạp gì, phụ đề đã nằm trong hình | Ẩn |
| rỗng | `""` | Không có phụ đề nào (lỗi dữ liệu đã biết) | Ẩn |

## Hiện trạng kho phim (19/08/2026)

- 3.975 tập trong hệ thống.
- 3.840 tập phụ đề cháy tiếng Việt (thế hệ cũ).
- 40 tập soft-sub đủ cả `vi` + `en`, con số này đang tăng theo tiến độ render.
- 95 tập không có phụ đề nào (OCR bản gốc không ra chữ) — đang chờ render lại, app cứ coi như tập không có phụ đề.

Từ nay mọi tập render mới đều là soft-sub, tập cũ **không** được render lại nên `burnedLang = "vi"` sẽ tồn tại lâu dài. Đừng viết code với giả định "sớm muộn gì cũng chỉ còn soft-sub".
