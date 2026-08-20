# Thêm một máy render

Hệ thống render chạy được trên nhiều máy Mac cùng lúc. Mỗi máy tự lấy việc từ kho chung và
tự chia phần với các máy khác, không cần máy chủ điều phối.

## Cài trên máy mới

1. Trên máy chính, dựng bộ cài:

   ```bash
   cd 247drama-worker && bash packaging/build-installer.sh
   # -> dist/247drama-render-installer.sh
   ```

2. Chép **hai file** sang máy mới: bộ cài và file `.env` của máy chính (chứa khoá Mongo, R2).

3. Trên máy mới:

   ```bash
   bash 247drama-render-installer.sh --env ~/Downloads/247drama.env --name mac-studio
   ```

   Không có `.env` thì chạy không tham số, bộ cài sẽ hỏi từng giá trị.

Máy mới bắt đầu nhận việc trong vòng 2 phút. Xem log: `tail -f ~/247drama-worker/logs/worker.log`.

## Máy mới cần gì

Bộ cài tự lo hết, chỉ cần **Homebrew** có sẵn. Nó cài ffmpeg, Node, Python 3.12, thư viện
Node, bộ OCR tiếng Trung, rồi dựng dịch vụ launchd chạy nền (bật cùng máy, chết tự bật lại).

Số luồng render đặt theo số nhân CPU của chính máy đó — mỗi tập ăn khoảng 2 nhân.

## Nhiều máy chia việc thế nào

Trước khi làm một tập, máy phải ghi một bản ghi "nhận phần" vào collection `renderclaims`,
khoá là `<nguồn>:<mã phim>:<số tập>`. Mongo bảo đảm chỉ một máy ghi được; máy còn lại thấy
trùng khoá thì bỏ qua tập đó và làm tập khác.

Phần nhận có hạn 20 phút. Máy nào tắt ngang thì phần nhận tự hết hạn và máy khác tiếp quản —
không cần ai dọn tay. Giới hạn 20 phút dài hơn hẳn mức 8 phút mà một tập được phép chạy, nên
không có chuyện hai máy cùng làm một tập vì hết hạn quá sớm.

## Việc riêng của máy chính

Hai thứ sau chỉ nên chạy trên **một** máy, mặc định là máy đầu tiên:

- **Tunnel Hong Kong** (`com.nonelab.hk-tunnel`): cần cho phim nguồn `hm`. Máy nào không có
  tunnel thì bỏ qua phim `hm`, vẫn render phim `hg` bình thường. Muốn máy đó làm được `hm`
  thì cài khoá SSH riêng cho nó theo `ops/hk-tunnel-daemon.sh`.
- **Sao ảnh bìa về R2**: máy nào chạy cũng được, làm trùng cũng chỉ ghi đè cùng một file.

## Theo dõi

Mỗi máy đẩy file trạng thái riêng lên máy chủ: `render-status-<tên-máy>.json`. Bảng điều
khiển ở `http://103.179.185.196/uploads/ops.html` đọc các file này.

## Gỡ một máy khỏi hệ thống

```bash
bash 247drama-render-installer.sh --uninstall
```

Dịch vụ dừng ngay. Tập nào máy đó đang giữ sẽ được máy khác nhận lại sau 20 phút.
