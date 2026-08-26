# Short Drama Demo — 52api + Whisper + Gemini

Demo nền tảng phim ngắn (short drama): lấy nội dung từ **52api.cn**, xem trực tiếp trong trình duyệt, và **tự tạo phụ đề tiếng Việt** bằng Whisper (nhận dạng tiếng Trung) + Gemini (dịch).

> Tài liệu này cho bộ file `server.js` / `public/index.html` / `subtitle.py` / `start.sh`.
> (Khác với `README.md` là của dự án "Nonelab Studio".)

---

## 1. Nghiên cứu API 52api.cn

52api.cn (我爱API) là cổng tổng hợp nhiều API. Nhóm liên quan short drama:

| API | Endpoint | Doc |
|---|---|---|
| **河马短剧 (Hippo)** | `https://www.52api.cn/api/hm_duanju` | [doc/98](https://www.52api.cn/doc/98) |
| **红果短剧 (Hongguo)** | `https://www.52api.cn/api/hg_duanju` | [doc/97](https://www.52api.cn/doc/97) |

Cả hai **dùng chung tham số**, chỉ cần một API là đủ dựng toàn bộ luồng.

### Ba thao tác (`type`)

| type | Tham số | Trả về |
|---|---|---|
| `search` | `keyword`, `page` | `data.lists[]`: `id`, `name`, `cover`, `introduction`, `tags`, `playNum` |
| `detail` | `id` | thông tin phim + `data.lists[]`: `{video_id, name}` (danh sách tập) |
| `video` | `id`, `video_id` | `data.chapterUrl` (**.mp4 phát trực tiếp**), `chapterCover`, `chapterName` |

Ví dụ:
```
https://www.52api.cn/api/hm_duanju?key=KEY&type=search&keyword=穿越&page=1
https://www.52api.cn/api/hm_duanju?key=KEY&type=detail&id=41000203479
https://www.52api.cn/api/hm_duanju?key=KEY&type=video&id=41000203479&video_id=613106194
```

### Giá & giới hạn
- Free: 10 lượt tổng · Trả phí: ~0.005 元/lượt (gói năm: 1 vạn = ¥50, 10 vạn = ¥450…)
- Rate limit free: **1 request / 3 giây** · trả phí: 20 req/s
- ⚠️ **Nạp ví ≠ mua lượt**: phải vào Console mua gói / bật trừ-ví cho *đúng* API, nếu không vẫn báo `超出免费总额度`.

---

## 2. Kiến trúc demo

```
Trình duyệt (public/index.html)
      │  fetch /api/*
      ▼
server.js  ── proxy ──►  52api.cn      (giấu key, tránh CORS)
      │
      └── /api/subtitle ──►  subtitle.py  ──►  Whisper + Gemini  ──►  public/subs/*.vi.vtt
```

| File | Vai trò |
|---|---|
| `server.js` | Node proxy (module built-in, **không cần `npm install`**) + serve UI + route phụ đề |
| `public/index.html` | Giao diện: tìm kiếm → grid poster → chi tiết + tập → player + nút tạo sub |
| `subtitle.py` | Pipeline phụ đề: tải mp4 → Whisper (zh) → Gemini (vi) → WebVTT |
| `start.sh` | Chạy nhanh (nạp env: key 52api, Gemini key, model Whisper) |

### Route của server
| Route | Việc |
|---|---|
| `GET /api/search?keyword=&page=&source=` | proxy `type=search` |
| `GET /api/detail?id=&source=` | proxy `type=detail` |
| `GET /api/video?id=&video_id=&source=` | proxy `type=video` |
| `GET /api/subtitle?id=&video_id=` | tạo (hoặc trả cache) phụ đề Việt `.vtt` |

`source`: `hm` (河马, mặc định) hoặc `hg` (红果).

---

## 3. Pipeline phụ đề tiếng Việt

```
mp4 URL
  │  urllib download            (KHÔNG dùng ffmpeg CLI)
  ▼
faster-whisper  (decode bằng PyAV, language="zh")
  │  → segments [start, end, text_trung]
  ▼
Gemini API  (batch 40 câu, giữ thứ tự/timing, zh → vi)
  │
  ▼
WebVTT  →  public/subs/<video_id>.vi.vtt  →  <track> trong <video>
```

- **Sub mềm (.vtt):** nạp qua `<track>`, **không re-encode** video, bật/tắt được.
- **Cache:** đã tạo lần nào thì lần sau trả ngay, không tốn quota/thời gian.
- **Không realtime:** mỗi tập mất ~15s (tiny) → vài phút (medium/large). Nên **pre-process** cả bộ khi làm thật.

---

## 4. Cách chạy

### Yêu cầu
- Node.js (đã test v20)
- Python 3 + `pip install faster-whisper` (kéo theo PyAV — **không cần ffmpeg**)
- (Tùy chọn) Gemini API key để dịch: https://aistudio.google.com/apikey

### Chạy
```bash
# 1. Sửa start.sh: điền API52_KEY và GEMINI_API_KEY
# 2. Khởi động
cd /Users/kevin/video && ./start.sh
# 3. Mở http://localhost:3000
```

Trong UI: gõ từ khoá (vd `穿越`, `战神`) → Tìm → chọn phim → chọn tập → **🇻🇳 Tạo sub Việt**.

### Biến môi trường
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `API52_KEY` | — | Key 52api.cn (bắt buộc) |
| `GEMINI_API_KEY` | rỗng | Thiếu → xuất phụ đề **tiếng Trung gốc** |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Model dịch |
| `WHISPER_MODEL` | `small` | `tiny`/`small`/`medium`/`large-v3` (đánh đổi tốc độ ↔ độ chuẩn) |

---

## 5. Các vấn đề đã gặp & cách xử lý

| Vấn đề | Nguyên nhân | Cách xử lý |
|---|---|---|
| `403 签名校验失败` | Tài khoản bật xác thực chữ ký (secret) | Tắt secret trong Console, hoặc thêm header `X-Api-Key/Timestamp/Sign` = `HMAC-SHA256("key=..&timestamp=..", secret)` |
| `400 超出免费总额度` | Nạp ví nhưng chưa mua gói cho API | Vào Console mua gói / bật trừ-ví cho đúng API |
| ffmpeg treo, không in gì | `/usr/local/bin/ffmpeg` là bản **Intel** trên máy **arm64** | Bỏ ffmpeg — faster-whisper decode bằng PyAV. (Cần ffmpeg thì `brew install ffmpeg`) |
| Field mapping | 52api trả `data.lists[]`, `name`, `cover`, `introduction`, `chapterUrl` | UI dò field phòng thủ + panel Raw JSON để chỉnh |

---

## 6. Lưu ý pháp lý

Nội dung lấy từ nền tảng short drama Trung Quốc (河马/红果). Tái phát tán có thể vi phạm **bản quyền** và **điều khoản dịch vụ** nền tảng gốc — cân nhắc kỹ trước khi thương mại hoá, đặc biệt ngoài thị trường Trung Quốc.

---

## 7. Việc có thể làm tiếp
- [ ] Pre-process hàng loạt: tạo sẵn `.vtt` cho cả bộ, hiển thị badge "đã có sub"
- [ ] Phân trang / load-more ở màn tìm kiếm
- [ ] Hỗ trợ chế độ signature (secret) cho an toàn
- [ ] So sánh chất lượng dịch Gemini vs LLM khác cho thoại phim
- [ ] Chọn model Whisper ngay trên UI
