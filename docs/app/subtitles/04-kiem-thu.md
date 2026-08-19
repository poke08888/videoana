# 04 — Kiểm thử

## Tự kiểm chứng bằng curl

Thay `<KEY>` bằng `secretKey` của backend và `<SERIES_ID>` bằng `_id` của phim.

```bash
# 1. Xem phản hồi có subDefault và subTracks không
curl -s "http://103.179.185.196/api/client/shortVideo/retrieveMovieSeriesVideosForUser?movieSeriesId=<SERIES_ID>&start=1&limit=5" \
  -H "key: <KEY>" | jq '{subDefault, videos: .data.videos[0:2]}'

# 2. Giả lập người xem ngoài Việt Nam (server đọc phần tử đầu của X-Forwarded-For)
curl -s "...cùng URL..." -H "key: <KEY>" -H "X-Forwarded-For: 8.8.8.8" | jq .subDefault   # -> "en"
curl -s "...cùng URL..." -H "key: <KEY>" -H "X-Forwarded-For: 113.161.0.1" | jq .subDefault # -> "vi"

# 3. Kiểm tra file phụ đề thật
curl -s "https://cdn.247tv.app/videos/hg_7428896824548674622_ep1.v1.vi.vtt" | head -6
```

File `.vtt` hợp lệ phải bắt đầu bằng dòng `WEBVTT`, mỗi cue có `line:NN% align:center`, và số cue của bản `vi` bằng bản `en`.

## Bảng ca kiểm thử

| # | Tình huống | Dữ liệu để dựng | Kết quả mong đợi |
| --- | --- | --- | --- |
| 1 | Người xem ở VN, tập soft-sub | `subDefault: "vi"`, 2 track | Hiện phụ đề Việt, menu có 3 mục |
| 2 | Người xem ngoài VN, tập soft-sub | `subDefault: "en"`, 2 track | Hiện phụ đề Anh |
| 3 | Người dùng đổi sang English rồi mở phim khác | đã lưu `subtitle.lang = "en"` | Vẫn English dù `subDefault = "vi"` |
| 4 | Người dùng chọn Tắt | đã lưu `"off"` | Không phụ đề, menu vẫn hiện |
| 5 | Tập chỉ có `vi`, người xem nước ngoài | `subTracks` 1 phần tử | Hiện tiếng Việt, menu 2 mục, không lỗi |
| 6 | Tập cũ cháy sẵn phụ đề | `subTracks: []`, `burnedLang: "vi"` | Không nạp gì, ẩn nút phụ đề |
| 7 | Tập không phụ đề | `subTracks: []`, `burnedLang: ""` | Không nạp gì, ẩn nút phụ đề, video vẫn phát |
| 8 | URL `.vtt` trả 404 | sửa URL trong dữ liệu giả | Video phát tiếp, không popup, ghi log `subtitle_load_failed` |
| 9 | Chữ Hán còn trong hình | tập soft-sub bất kỳ | Chữ Việt nằm **dưới** chữ Hán, không chồng, không bị cắt ở cạnh dưới |
| 10 | Xoay ngang / toàn màn hình | tập soft-sub | Vị trí phụ đề vẫn theo tỉ lệ `line:`, không dán đáy màn hình |
| 11 | Đổi ngôn ngữ giữa lúc đang phát | tập 2 track | Đổi ngay tại vị trí đang xem, không tua lại, không đứng hình |
| 12 | App bản cũ (chưa đọc `subTracks`) | tập soft-sub | Video phát không phụ đề — dùng để quyết định có ép nâng cấp hay không |

Ca 9 là ca dễ sai nhất và chỉ phát hiện được bằng mắt: chụp màn hình một tập soft-sub và so vị trí hai dòng chữ.

## Phim mẫu để test

- Phim soft-sub: `北境战神第2部`, `bookId = hg:7428896824548674622` — các tập đang được render dần, có đủ `vi` + `en`.
- Phim cháy sẵn phụ đề: bất kỳ phim tiếng Việt nào đã có trên app trước 18/08/2026, ví dụ *Ba anh em kính mẹ*.
