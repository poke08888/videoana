# Sổ tay máy render 247drama

Tài liệu này dành cho người (hoặc agent) đang ngồi trên **một máy render**, không phải máy chủ.
Đọc xong là tự cài, tự kiểm, tự sửa được mà không cần hỏi máy khác.

---

## 1. Máy này làm gì

Hệ thống lấy phim ngắn Trung Quốc từ 52api, dịch phụ đề sang 4 thứ tiếng rồi đẩy lên CDN cho
app xem. Máy render là nơi làm phần nặng:

```
tải video → OCR chữ Hán cháy trong hình → dịch (Gemini) → mã hoá video sạch
   → upload R2 → ghi bản ghi vào MongoDB
```

Nhiều máy chạy song song, **cùng một kho MongoDB**. Không có máy chủ điều phối: mỗi máy tự quét
việc còn thiếu và tự nhận phần.

Hai nguồn phim:

| Nguồn | Tải thế nào | Cần gì |
| --- | --- | --- |
| `hg` | thẳng từ CDN | không cần gì thêm |
| `hm` | CDN cbread.cn chặn từ Việt Nam | bắt buộc qua tunnel SOCKS sang VPS Hong Kong |

---

## 2. Mọi thứ nằm ở đâu

| Thứ | Đường dẫn |
| --- | --- |
| Mã nguồn | `~/247drama-worker` |
| Cấu hình | `~/247drama-worker/.env` |
| Log worker | `~/247drama-worker/logs/worker.log` |
| Log tunnel | `~/247drama-worker/logs/hk-tunnel.log` |
| Thư mục render | đọc `WORK_DIR` trong `.env` |
| Dịch vụ worker | launchd `com.nonelab.247drama-worker` |
| Dịch vụ tunnel | launchd `com.nonelab.hk-tunnel` |
| Bộ cài | file `247drama-render-installer.sh` (Kevin gửi qua Telegram) |

---

## 3. Kiểm tra sức khoẻ (chạy theo thứ tự)

```bash
# 1. Worker có chạy không
launchctl list | grep 247drama-worker          # có dòng = đã nạp dịch vụ
pgrep -fl "node.*worker.js"                    # có PID = đang chạy thật

# 2. Nó đang làm gì
tail -20 ~/247drama-worker/logs/worker.log

# 3. Máy này nhận nguồn nào
grep -E "WORKER_PROVIDERS|WORKER_NAME" ~/247drama-worker/.env

# 4. Mã nguồn đã là bản mới chưa (phải ra 1)
grep -c "env.providers.includes" ~/247drama-worker/work.js

# 5. Tunnel (chỉ cần nếu máy này làm nguồn hm)
lsof -iTCP:1080 -sTCP:LISTEN
```

**Log khoẻ mạnh trông như thế này:**

```
[worker] DAEMON máy "Mac-mini-10" concurrency=6, ocrThreads=2, poll=120s, tmp=...
[worker] quét: 20 phim, 1554 tập cần render
[render] ✓ hg:7642677762196524057 ep12 sub=vi 54 câu, 126s
```

Dòng `quét: N phim` cho biết máy đang nhận nguồn nào: chỉ `hg` thì khoảng 20 phim, chỉ `hm` thì
khoảng 25 phim, cả hai thì khoảng 45 phim.

---

## 4. Chia nguồn giữa các máy (QUAN TRỌNG)

CDN Trung Quốc bóp băng thông **theo địa chỉ IP**. Hai máy cùng kéo phim `hm` qua chung một VPS
Hong Kong thì mỗi máy chỉ được một phần tốc độ, kết nối treo quá hạn rồi bị tính là lỗi — đo
thật: 0,93 MB/s khi một máy, tụt còn 0,2 MB/s khi hai máy, kèm 10 lỗi `Proxy connection timed
out` trong một tiếng.

Vì vậy mỗi máy chỉ nhận **một** nguồn. Đặt trong `.env` của máy đó:

```bash
WORKER_PROVIDERS=hg    # máy tải thẳng, không cần tunnel
WORKER_PROVIDERS=hm    # máy có tunnel Hong Kong
```

Đổi xong phải khởi động lại thì mới đọc cấu hình mới:

```bash
launchctl kickstart -k gui/$(id -u)/com.nonelab.247drama-worker
```

Bỏ trống hoặc gõ sai mã nguồn thì máy nhận **cả hai** nguồn (thiết kế như vậy để không máy nào
đứng im vì gõ nhầm) — nên "không thấy lỗi gì" không có nghĩa là cấu hình đã đúng, phải xem log.

---

## 5. Cài mới hoặc cập nhật

```bash
# Cài lần đầu (cần file .env do Kevin gửi kèm)
bash 247drama-render-installer.sh --env ~/Downloads/247drama.env --name <tên-máy>

# CẬP NHẬT mã nguồn cho máy đã cài — KHÔNG kèm --env
bash 247drama-render-installer.sh
```

**Kèm `--env` là ghi đè `.env` đang có.** Máy đã cài rồi mà chạy lại kèm `--env` thì mất hết
tuỳ chỉnh riêng của máy đó, đầu tiên là `WORKER_PROVIDERS`. Đây là lỗi dễ mắc nhất.

Bộ cài tự lo: ffmpeg, Node, Python 3.12, thư viện, môi trường OCR, tunnel Hong Kong, dịch vụ
launchd. Máy chỉ cần có sẵn Homebrew.

Sau khi cập nhật, kiểm lại bằng mục 3 — đặc biệt lệnh số 4 phải ra `1`.

---

## 6. Sự cố thường gặp

### Worker không chạy
```bash
tail -30 ~/247drama-worker/logs/worker.log
launchctl kickstart -k gui/$(id -u)/com.nonelab.247drama-worker
```
Log báo `chưa mount ổ ngoài` nghĩa là `WORK_DIR` trỏ vào ổ ngoài chưa gắn. Đây là chốt chặn cố ý
để media không đổ nhầm vào ổ chính — sửa `WORK_DIR` trong `.env` sang thư mục có thật.

### Toàn lỗi `Proxy connection timed out` hoặc `ECONNREFUSED 127.0.0.1:1080`
Tunnel chết hoặc máy này đang tranh nguồn `hm` với máy khác.
```bash
lsof -iTCP:1080 -sTCP:LISTEN                       # trống = tunnel chết
launchctl kickstart -k gui/$(id -u)/com.nonelab.hk-tunnel
tail -20 ~/247drama-worker/logs/hk-tunnel.log
```
Log tunnel đầy dòng `channel N: open failed` nghĩa là VPS ra được internet nhưng không nối được
tới CDN — thường do quá nhiều luồng chung một IP. Xem lại mục 4.

### Lỗi `chưa xác định được vị trí chữ Hán`
Bình thường, không phải hỏng. OCR không đo được vị trí dòng chữ Hán của tập đó nên hệ thống bỏ
tập, vòng sau làm lại. Chỉ đáng lo khi một phim lỗi liên tục nhiều tập.

### Máy báo đang giữ tập nhưng không làm gì
Tiến trình cũ bị kết thúc giữa chừng để lại "phần nhận" mồ côi. Chúng tự hết hạn sau 20 phút và
máy khác nhận lại. Không cần can thiệp.

---

## 7. Luật bắt buộc khi có nhiều máy

Kho MongoDB, R2 và VPS Hong Kong là **của chung**. Ba việc sau làm hỏng cả hệ thống chứ không
riêng máy mình:

1. **Không xoá `renderclaims` của máy khác.** Đó là phần việc máy khác đang làm; xoá đi là hai
   máy cùng render một tập, cùng upload đè nhau. Chỉ xoá khi máy đó tự báo `inflight` rỗng.
2. **Không sửa `settings` trong MongoDB** (khoá Gemini, danh sách ngôn ngữ, chế độ phụ đề). Mọi
   máy đọc chung; đổi ở đây là đổi hành vi của cả đàn.
3. **Không xoá phim hay tập trong MongoDB, không xoá file trên R2.** Máy render chỉ có quyền
   thêm. Muốn xoá thì báo Kevin.

Máy này được toàn quyền với: `.env` của mình, thư mục render của mình, dịch vụ launchd của mình.

---

## 8. Xem cả đàn máy

```bash
curl -s "http://103.179.185.196/api/ops/render-status" -H "ops-key: <khoá vận hành>" | python3 -m json.tool
```

Hoặc mở trang http://103.179.185.196/uploads/ops.html — khu "Máy render" hiện từng máy: số luồng,
tốc độ, số lỗi, đang làm tập nào. Khoá vận hành hỏi Kevin.

Máy im quá 60 giây sẽ hiện chấm đỏ "mất tín hiệu".

---

## 9. Việc cần làm ngay trên Mac-mini-10 (tính đến 20/08/2026)

Máy này phải nhận nguồn `hg`, nhưng đang vẫn bốc phim `hm` — tức tranh băng thông với
Mac-mini-2. Cần làm theo thứ tự:

```bash
grep -c "env.providers.includes" ~/247drama-worker/work.js   # phải ra 1; ra 0 -> chạy lại bộ cài KHÔNG kèm --env
grep -n "WORKER_PROVIDERS" ~/247drama-worker/.env            # phải thấy WORKER_PROVIDERS=hg
```

Thiếu dòng nào thì thêm rồi khởi động lại:

```bash
echo "WORKER_PROVIDERS=hg" >> ~/247drama-worker/.env
launchctl kickstart -k gui/$(id -u)/com.nonelab.247drama-worker
sleep 90 && grep "quét:" ~/247drama-worker/logs/worker.log | tail -1
```

**Xong là đúng khi**: dòng `quét:` báo khoảng 20 phim, và log chỉ hiện dòng `[render] ✓ hg:…`,
không còn dòng nào bắt đầu bằng `hm:`.

---

## 10. Cổng lên app và cách sửa tập hỏng (từ 21/08/2026)

Phim **chỉ hiện trên app khi đủ tập và không tập nào hỏng**. Backend tự chấm lại cả kho mỗi 2
phút và ghi vào từng phim: cờ `isComplete` + `completeness.reason` (lý do bị giữ) +
`completeness.badEps` (danh sách số tập hỏng). Máy render xong tập cuối thì phim tự lên app
trong vòng 2 phút, không ai phải bấm gì.

**Tập hỏng** = mất link video, hoặc không có lấy một dòng phụ đề Việt (không track `vi`, cũng
không `burnedLang`). Những tập này đã có bản ghi nên vòng quét cũ coi như xong và không bao giờ
làm lại — phim vì thế kẹt ngoài app vĩnh viễn. Nay `work.js` đọc `completeness.badEps` và đưa
chúng vào danh sách cần render lại.

Sửa ngay, không chờ vòng quét:

```bash
cd ~/247drama-worker
node scripts/redo-bad.js --dry                    # xem sẽ sửa những tập nào
node scripts/redo-bad.js                          # sửa hết (2 luồng)
node scripts/redo-bad.js hm:41000147903           # chỉ một phim
```

Điểm quan trọng: script **không tải lại từ nguồn**. Bản mp4 của những tập đó đã nằm trên R2 của
mình và còn nguyên chữ Trung, nên chỉ cần OCR lại. Nhờ vậy sửa được cả phim nguồn `hg` dù 52api
đã hết quota `hg_play` và luồng hg giờ chỉ còn bytevc1 không giải mã nổi. Script cũng nhận phần
qua `renderclaims` như worker nên chạy song song với daemon không đụng nhau.

Xem phim nào đang bị giữ và vì sao: mở http://103.179.185.196/uploads/ops.html — cột **"Trên
app"** ghi rõ từng phim ("mới có 21/52 tập", "3 tập lỗi (tập 24, 27, 61)"...).
