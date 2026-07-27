# POC: Lồng tiếng Việt 1 tập bằng ElevenLabs TTS — Design

**Ngày:** 2026-07-27
**Mục tiêu:** Thử lồng tiếng (dub) tiếng Việt cho 1 tập short-drama bằng ElevenLabs TTS, tái dùng bản dịch của pipeline hiện có. Bản POC "nhanh" (giảm nhỏ audio gốc, KHÔNG tách nền demucs).

## Quyết định đã chốt
- Nguồn: **ElevenLabs TTS** (free tier), model `eleven_multilingual_v2`, tái dùng bản dịch Việt của mình (OCR+Gemini).
- Kiểu: **giảm audio gốc ~15%** rồi đè tiếng Việt lên (bản nhanh; full-dub tách nền để sau).
- Tập: `hg_7650805046258453528_ep0.mp4` (raw trên BINGNET, ~159s).

## Pipeline (script standalone `poc/`, KHÔNG đụng worker)
1. **Segment Việt**: `ocrSubtitles(ep)` (OCR hardsub Trung) → lọc rác → `translateSegments` (Gemini zh→vi) → `viSegs = [{start,end,text}]` → lưu `segments.json`. Gemini key + config lấy từ `db.loadSettings()`/`buildSubtitleConfig` như worker.
2. **TTS từng câu**: `poc/elevenlabs.js` `tts(text)` → mp3. ffprobe độ dài clip; nếu dài hơn khe `end-start` → `atempo` ép vừa (cap 1.6× tránh méo giọng).
3. **Trộn (ffmpeg 1 pass)**: `[0:a]volume=0.15` (audio gốc nhỏ) + mỗi clip `atempo,adelay=start` → `amix` → thay track audio, giữ nguyên video → `dubbed.mp4`.
4. Nghe + đánh giá.

## Cấu hình (.env, gitignored)
`ELEVEN_API_KEY` (cần quyền text_to_speech), `ELEVEN_VOICE_ID` (mặc định giọng premade multilingual).

## Rủi ro
- Free tier ~10k credit/tháng (~1 tập ~1-2k ký tự → đủ); có thể ràng buộc thương mại (chỉ thử).
- **Time-fit**: tiếng Việt dài hơn tiếng Trung → atempo có thể làm giọng nhanh. Chấp nhận cho POC.
- Còn nghe tiếng Trung mờ dưới nền (bản nhanh). Full-dub sạch cần demucs (giai đoạn sau).
- Giọng premade có thể hơi "Tây" khi đọc tiếng Việt — thử rồi đổi voice_id nếu cần.

## Verify
1. `segments.json` có N câu Việt hợp lý (timing khớp).
2. TTS 1 câu ra mp3 phát được.
3. `dubbed.mp4` phát: nghe tiếng Việt đúng thoại, nhạc nền còn, khẩu hình ~khớp.
