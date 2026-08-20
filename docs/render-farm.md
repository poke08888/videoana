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

## Chia nguồn giữa các máy

Phim nguồn `hm` phải tải qua VPS Hong Kong, và CDN Trung Quốc bóp băng thông **theo IP**. Hai
máy cùng kéo `hm` qua chung một VPS thì mỗi máy chỉ được một phần tốc độ, kết nối treo quá hạn
rồi bị tính là lỗi — tổng lượng tải về không hơn mà số lỗi thì tăng vọt.

Cách chia: mỗi máy nhận một nguồn, đặt trong `.env` của máy đó.

```bash
WORKER_PROVIDERS=hm    # máy có tunnel, kéo phim hm
WORKER_PROVIDERS=hg    # máy còn lại, tải thẳng từ CDN, không cần tunnel
```

Để trống hoặc gõ sai thì máy nhận cả hai nguồn — không bao giờ đứng im vì gõ nhầm.

Máy chỉ quét phim thuộc nguồn của mình, nên cũng tiết kiệm quota 52api: mỗi lượt gọi bị chặn
3,2 giây, quét phim mình không render là phí cả thời gian lẫn lượt gọi.

Trong một máy, số luồng tải qua proxy cũng bị giới hạn (mặc định 2, đổi bằng
`PROXY_DOWNLOAD_CONCURRENCY`) vì cùng lý do trên.

## Tunnel Hong Kong

Phim nguồn `hm` tải qua CDN cbread.cn, bị chặn từ Việt Nam nên phải đi vòng qua VPS Hong
Kong. **Bộ cài lo luôn phần này**: tạo khoá SSH riêng cho máy đó, cài khoá lên VPS bằng mật
khẩu trong `.env`, rồi dựng dịch vụ `com.nonelab.hk-tunnel` giữ tunnel sống (chết là bật lại
sau vài giây).

Mỗi máy có tunnel riêng của mình, không dùng chung — nên máy này tắt không ảnh hưởng máy kia.

Nếu `.env` không có `HK_HOST`, bộ cài bỏ qua bước này và báo rõ: máy đó vẫn render phim `hg`
bình thường, chỉ bỏ qua phim `hm`.

Kiểm tra tunnel trên một máy:

```bash
lsof -iTCP:1080 -sTCP:LISTEN      # có dòng ssh = đang chạy
tail -f ~/247drama-worker/logs/hk-tunnel.log
```

## Sao ảnh bìa về R2

Máy nào chạy cũng được, làm trùng cũng chỉ ghi đè cùng một file.

## Theo dõi

Mỗi máy đẩy file trạng thái riêng lên máy chủ: `render-status-<tên-máy>.json`. Bảng điều
khiển ở `http://103.179.185.196/uploads/ops.html` đọc các file này.

## Gỡ một máy khỏi hệ thống

```bash
bash 247drama-render-installer.sh --uninstall
```

Dịch vụ dừng ngay. Tập nào máy đó đang giữ sẽ được máy khác nhận lại sau 20 phút.
