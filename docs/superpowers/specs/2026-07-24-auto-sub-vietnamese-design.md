# Auto-sub tiếng Việt cho video hm (247drama)

**Ngày:** 2026-07-24
**Server:** 247drama, VN 103.179.185.196 (`/var/www/247drama`)

## Mục tiêu

Sau khi import 1 tập phim hm (河马) — video có **tiếng Trung + phụ đề Trung cháy cứng ở đáy** — tự động tạo phụ đề tiếng Việt và **đè lên che phần sub Trung**, để người xem Việt Nam xem hiểu được.

## Quyết định đã chốt với user

| Vấn đề | Quyết định |
|---|---|
| ASR | **faster-whisper** local, model **medium**, CPU int8, `language=zh` |
| Dịch | **Gemini API** (dùng chung key + model `gemini-2.5-flash` của video.nonelab.net) |
| Che sub Trung | Burn cứng: thanh đục phủ dải đáy + chữ Việt đè lên |
| Kích hoạt | **Tự động sau import** mỗi tập hm |
| Nơi chạy | **VN server** (HK VPS chỉ 1.6GB RAM, không chạy whisper được) |

## Kiến trúc & luồng dữ liệu

Tích hợp vào `process52apiEpisodes` hiện có (đã có: download qua proxy → transcode H.264 → upload). Chèn bước sub **trước bước encode cuối**, và **gộp burn-sub vào chung lần encode H.264** để chỉ encode 1 lần.

Luồng mỗi tập (provider = hm):
1. `downloadToBuffer(mp4Url, {useProxy:true})` → ghi file tạm nguồn (HEVC sạch).
2. **Tách audio**: `ffmpeg -i src -vn -ac 1 -ar 16000 -f wav audio.wav`.
3. **ASR** (module mới `util/asr.js` → gọi Python `scripts/asr_whisper.py`): faster-whisper medium, zh → JSON `[{start,end,text}]`.
4. **Dịch** (module mới `util/translate.js`): gộp toàn bộ segment 1 tập thành 1–vài lần gọi Gemini (giữ số thứ tự + ngữ cảnh thoại), zh→vi → gán lại text Việt cho từng segment, **giữ nguyên timestamp**.
5. **Sinh ASS** (`util/subtitle.js`): style chữ Việt (trắng, viền đen, cỡ theo chiều cao video, canh đáy). Vị trí nằm trong dải đáy sẽ được che.
6. **Encode 1 lần** (`util/transcode.js` mở rộng): `ffmpeg -i src -vf "drawbox=x=0:y=ih*0.82:w=iw:h=ih*0.18:color=black@1:t=fill, ass=vi.ass" -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart out.mp4`.
   - `drawbox` = thanh đen đục phủ dải đáy (nơi sub Trung nằm) → che sub Trung.
   - `ass` = render chữ Việt đè lên trên thanh đó.
   - Dải che (y-start, chiều cao) đọc từ Setting để tinh chỉnh.
7. `uploadBufferToStorage(out)` → `videoUrl` = file đã có sub Việt.

### Fallback (không làm hỏng import)
- Whisper lỗi / Gemini lỗi / timeout → **bỏ qua sub, chạy transcode H.264 thường** (hành vi hiện tại) → tập vẫn có video xem được (chỉ còn sub Trung). Log cảnh báo.
- Idempotent: tập đã có `subLang="vi"` thì bỏ qua.

## Thành phần (đơn vị tách bạch)

| Đơn vị | File | Trách nhiệm | Phụ thuộc |
|---|---|---|---|
| ASR CLI | `scripts/asr_whisper.py` (mới) | wav → segments zh JSON | faster-whisper (pip), model medium cache |
| ASR wrapper | `util/asr.js` (mới) | gọi python, parse JSON, timeout | child_process |
| Dịch | `util/translate.js` (mới) | segments zh → vi qua Gemini REST | axios, geminiApiKey |
| Phụ đề | `util/subtitle.js` (mới) | segments vi → file .ass + tách audio | ffmpeg |
| Encode+burn | `util/transcode.js` (sửa) | thêm `transcodeBurnSub(src, assPath, box)` | ffmpeg |
| Điều phối | `controllers/admin/movieSeries.controller.js` (sửa) | chèn bước sub vào `process52apiEpisodes` | các util trên |
| Config | `models/setting.model.js` + `setting.controller.js` (sửa) | thêm `subtitle` config | — |
| Model | `models/shortVideo.model.js` (sửa) | thêm `subLang` | — |

## Config mới (settingJSON.subtitle)

```
subtitle: {
  enabled: Boolean (default true),
  geminiApiKey: String,               // dùng chung key video.nonelab
  geminiModel: String (gemini-2.5-flash),
  whisperModel: String (medium),
  targetLang: String (vi),
  sourceLang: String (zh),
  coverBoxYRatio: Number (0.82),      // dải che bắt đầu ở 82% chiều cao
  coverBoxHeightRatio: Number (0.18), // cao 18% chiều cao
  translateBatchSize: Number (40)     // số segment/lần gọi Gemini
}
```

## Cài đặt phụ thuộc (một lần, trên VN server)
- `pip install faster-whisper` (Python 3.10 sẵn có). Model medium int8 tự tải lần đầu (~1.5GB) cache ở `~/.cache/huggingface`.
- ffmpeg đã cài sẵn.
- Không thêm npm SDK nặng — gọi Gemini bằng REST qua axios (đã có).

## Hiệu năng & tải
- Whisper medium CPU 4 core ≈ 1–1.5x realtime; tập ~90s ≈ 60–120s ASR. Cộng encode ~15s. → ~1.5–2.5 phút/tập.
- Chạy trong queue import sẵn có + `waitForViewerQuiet()` → nhường người xem. Import phim 60 tập kèm sub ≈ vài giờ nền — chấp nhận được vì auto/nền.
- Gemini Flash free tier đủ; 1 tập ~20–60 segment → 1–2 lần gọi.

## Rủi ro
- Dải che cố định có thể không khớp nếu sub Trung nằm cao bất thường → cho tinh chỉnh qua Setting; mặc định hợp short-drama (sub sát đáy).
- ASR sai với thoại chồng/nhạc nền → medium chấp nhận được; không cầu toàn.
- Timestamp whisper theo lời nói, khớp tốt với sub Trung (cùng bám thoại).

## Verify (end-to-end)
1. Cài faster-whisper, chạy `asr_whisper.py` trên 1 wav mẫu → ra segments zh.
2. `translate.js` dịch mẫu zh→vi qua Gemini → text Việt hợp lý.
3. Import 1 tập hm → kiểm tra file out: mở video thấy **thanh đáy che sub Trung + chữ Việt** đúng thời điểm thoại, codec h264, phát được.
4. `ShortVideo.subLang="vi"`. Chạy lại import không sub trùng.
5. Xem trên app: tập phát, có phụ đề Việt, không lộ sub Trung.
```
