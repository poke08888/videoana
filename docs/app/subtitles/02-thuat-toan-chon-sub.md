# 02 — Thuật toán chọn phụ đề

## Nguyên tắc

1. Server quyết định **mặc định** theo IP (`subDefault`).
2. Người dùng quyết định **cuối cùng** nếu họ đã tự chọn.
3. Dữ liệu của tập quyết định **có gì để chọn** (`subTracks`, `burnedLang`).

Thứ tự ưu tiên: lựa chọn người dùng đã lưu → `subDefault` → track còn lại → không phụ đề.

## Mã giả

```
function pickSubtitle(video, subDefault, savedChoice):
    tracks = video.subTracks or []

    # 1. Không có track rời
    if tracks is empty:
        if video.burnedLang is not empty:
            return { mode: "burned", showPicker: false }   # chữ đã in trong hình
        return { mode: "none", showPicker: false }         # tập chưa có phụ đề

    # 2. Người dùng đã tự chọn trước đó
    if savedChoice == "off":
        return { mode: "off", showPicker: true, tracks: tracks }
    if savedChoice is a language and tracks has savedChoice:
        return { mode: "track", track: find(tracks, savedChoice), showPicker: true }

    # 3. Mặc định theo IP
    if tracks has subDefault:
        return { mode: "track", track: find(tracks, subDefault), showPicker: true }

    # 4. Chỉ có một ngôn ngữ khác với mặc định thì vẫn hiện, còn hơn không có gì
    return { mode: "track", track: tracks[0], showPicker: true }
```

`showPicker: true` mà `tracks` chỉ có 1 phần tử thì menu chỉ gồm ngôn ngữ đó và "Tắt".

## Lưu lựa chọn của người dùng

- Lưu **theo thiết bị**, không theo từng tập, không theo từng phim. Người xem chọn English một lần thì cả app là English.
- Khoá gợi ý: `subtitle.lang` với giá trị `"vi" | "en" | "off"`; chưa có khoá này nghĩa là chưa từng chọn.
- Khi đã có lựa chọn lưu, **bỏ qua `subDefault`** ở mọi phản hồi sau. `subDefault` chỉ là mặc định lần đầu.
- Không đồng bộ lựa chọn này lên server ở giai đoạn này.

## Vì sao không tự đoán theo ngôn ngữ máy

Ngôn ngữ hệ điều hành không phản ánh vị trí người xem: rất nhiều máy ở Việt Nam để tiếng Anh. Quy tắc kinh doanh là theo **vị trí địa lý**, và chỉ server mới thấy IP thật, nên `subDefault` là nguồn duy nhất. Nếu phản hồi thiếu `subDefault` (server cũ), app dùng `"vi"`.

## Các trường hợp cần xử lý đúng

| Tình huống | Hành vi đúng |
| --- | --- |
| `subDefault` đổi giữa hai request (người dùng bật VPN, đi công tác) | Nếu người dùng đã tự chọn: giữ nguyên lựa chọn. Nếu chưa: cập nhật theo giá trị mới ở lần mở phim kế tiếp, không đổi giữa lúc đang phát. |
| Tập có `vi` nhưng thiếu `en`, người dùng ở nước ngoài | Hiện `vi`, menu chỉ có Tiếng Việt / Tắt. Không hiện menu rỗng, không báo lỗi. |
| Tải file `.vtt` thất bại (mạng, 404) | Phát tiếp video không phụ đề, thử lại tối đa 2 lần, không chặn phát. Không hiện popup lỗi. |
| Tập cũ `burnedLang = "vi"` | Ẩn hoàn toàn nút phụ đề để người dùng không tưởng app hỏng. |
| Chuyển tập trong lúc đang xem | Áp cùng lựa chọn cho tập mới; nếu tập mới không có ngôn ngữ đó thì rơi về quy tắc mã giả ở trên, không nhớ ngược lại. |
