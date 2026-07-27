# 247drama — Handoff (chuyển máy làm tiếp)

**Cập nhật:** 2026-07-27. Repo: `/Users/kevin/video` (nhánh `feat/mac-render-farm`). Worker: `/Users/kevin/video/247drama-worker`.
⚠️ **KHÔNG push nhánh này lên remote công khai** (lịch sử git có mật khẩu root). Chỉ chuyển file/repo qua kênh riêng.

---

## 1. Toàn cảnh hệ thống

**247drama** = nền tảng short-drama (server `103.179.185.196`). Nội dung import từ **52api.cn** (hg=红果, hm=河马).

Kiến trúc hiện tại (đã dựng xong hôm nay):
```
52api (hg/hm)  ──►  Mac render farm (worker daemon)  ──►  Cloudflare R2 (video)
                     │ tải + OCR chữ Trung + dịch Việt (Gemini) + burn sub + up R2
                     └ đọc phim pending từ Mongo server, upsert ShortVideo
Server 103.179.185.196: chỉ giữ Mongo + phục vụ app (KHÔNG render, KHÔNG lưu video)
```

### Trạng thái đang chạy (trên máy Mac này)
- **Worker daemon**: `node worker.js` (nohup, log `/Volumes/BINGNET/247drama-render/worker.log`). Vòng lặp: quét pending → render → chờ 120s → lặp. Concurrency **6**, OCR_THREADS **3**.
- **Tunnel HK SOCKS5 :1080**: `ssh -D 1080 root@47.76.79.169` (cần cho tải `hm` + fallback hg douyinvod). Hay rớt → mở lại `./ops/hk-tunnel.sh`.
- **Server backend**: pm2 **cluster 4 instance** (name `backend` id 2-5). Quản lý: `export HOME=/root; /root/.nvm/versions/node/v20.19.6/bin/pm2`.
- **Dashboard**: http://103.179.185.196/uploads/render-status.html

---

## 2. Storage = Cloudflare R2 (video KHÔNG còn trên server)

- Bucket `247drama`, account `00106d0da3e1eeda8d9b71ed371bdf68`.
- S3 endpoint: `https://00106d0da3e1eeda8d9b71ed371bdf68.r2.cloudflarestorage.com`
- Public base (r2.dev, tạm — chưa có domain): `https://pub-06eced512b4848c898c480a37a67ac47.r2.dev`
- Key video: `videos/<provider>_<sourceId>_ep<index>.mp4`. Sidecar sub Việt: `videos/<...>.vi.json`.
- Dùng slot `awsS3` (R2 tương thích S3). `videoUrl = <publicBase>/videos/<file>`.
- ⚠️ **r2.dev bị rate-limit** — production nặng nên **mua domain đưa về Cloudflare** (đổi = `R2_PUBLIC_BASE` + 1 `updateMany` prefix Mongo `shortvideos`).
- Backfill 8.3GB cũ đã xong, mp4 local trên server đã xóa (disk 42%→27%).

---

## 3. Server config quan trọng (đã set)

- **`DISABLE_SERVER_RENDER=1`** trong backend `.env` → server KHÔNG render 52api (Mac lo). Guard tại `controllers/admin/movieSeries.controller.js`: `resumeIncomplete52apiImports` (~d.1399) + `process52apiEpisodes` (~d.1659). **BẮT BUỘC khi cluster** (nếu không 4 instance cùng resume → 4 OCR → server sập tải 14/4 nhân).
  - **Thêm phim**: admin duyệt 52api (KHÔNG chặn 52api) + tạo MovieSeries (0 tập) → Mac daemon tự nhặt render trong ~2 phút.
- Setting Mongo `chineseDramaApi.hgDefinition = "1080p"` (vừa đổi từ 720p → **hg tập mới nét hơn**; tập cũ 720p giữ nguyên).
- Backup guard code: `movieSeries.controller.js.bak-r2`.

---

## 4. Pipeline render (worker) — các file

- `worker.js` — daemon vòng lặp (findPendingWork → render → sleep → lặp).
- `work.js` — findPendingWork, extract52apiSource, computeMissingEpisodes.
- `render.js` — 1 tập: resolve+tải (proxy fallback hg douyinvod) → OCR+dịch+burn (`autosub`) → up R2 → **lưu sidecar `.vi.json`** → upsert Mongo.
- `config.js` — env, buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig.
- `util/`: `duanjuProvider.js` (52api hg/hm), `asrOcr.js` (OCR chữ Trung → segments), `translate.js` (Gemini **zh→vi**), `subtitle.js` (buildAss), `transcode.js` (ffmpeg burn), `autosub.js` (ghép: trả `{buffer, viSegs, ...}`), `r2.js` (uploadToR2).
- `status.js` — dashboard realtime (đã fix bug >100%: done tính từ số thật của phim, cap target).
- `ops/hk-tunnel.sh` — mở SOCKS5 1080 tới HK.

**Test**: `npm test` (node --test, `test/*.test.js`).

---

## 5. POC LỒNG TIẾNG (dub) — đang làm dở

**Lộ trình chốt:** `Trung sub ──Gemini(zh→vi)──► vietsub (.vi.json) ──ElevenLabs TTS──► vietdub`.
- Dub **đọc vietsub** (không dịch lại từ Trung). Đã verify: 0/60 câu Hán gửi lên ElevenLabs.

**File POC** (`poc/`):
- `elevenlabs.js` — `tts(text, {voiceId, model, languageCode, stability})`. Hiện: **model `eleven_v3`**, `language_code="vi"`, `stability=0.3`.
- `emotion.js` — Gemini gán **tag cảm xúc từng câu** (`[angry]`,`[sad]`,`[shouting]`...) → chèn vào text v3 (Plan A). Cache `emotions.json`.
- `subdub.js` — **bản tốt nhất hiện tại**: 1 video CÓ CẢ vietsub (burn) + vietdub. Lấy video có sub từ R2 + tách nền **Demucs** (`no_vocals.wav`) + TTS từng câu (time-fit atempo≤1.3, khe tới câu kế) + **giọng ×2.5, nền ×0.55, limiter** chống méo.
- `dub-episode.js`, `dub-demucs.js` — bản cũ hơn (giữ tham khảo).

**ElevenLabs**: gói **trả phí** (dùng library voice + v3). Giọng đang dùng: `Tr84Gom1NKJwoYZT55td` (Thế Minh, nam Bắc). Có 15 giọng Việt library (Giang/Thuy Tien nữ, Phuc Anh nam...). API key trong `.env` (`ELEVEN_API_KEY`) — key phải có quyền **text_to_speech**.

**Demucs**: venv `/Volumes/BINGNET/247drama-render/demucs-venv` (python 3.12 + torch + **numpy**). Chạy: `demucs-venv/bin/python -m demucs --two-stems=vocals -n htdemucs`.

**Chạy dub 1 tập**: `node poc/subdub.js hg_7650805046258453528_ep0` → output `/Volumes/BINGNET/247drama-render/dub-poc/<base>_subdub.mp4` (chỉ LOCAL, không up R2).

### ⚠️ VẤN ĐỀ CÒN LẠI của dub (cần xử lý tiếp)
1. **sub ≠ dub cho ep0**: `segments.json` (dùng cho dub) đến từ bản dịch POC riêng, KHÁC bản dịch worker burn trong video (vd "chôn theo" vs "chôn cùng"). **Fix đúng**: render lại ep0 để sidecar = đúng chữ burn → dub đọc sidecar → khớp 100%. Từ giờ tập mới tự khớp (render đã lưu sidecar).
2. **Cảm xúc**: Plan A (emotion tag) đã làm — chờ user đánh giá "tức đủ tức chưa".
3. **Chưa phân vai** (1 giọng cho mọi nhân vật) — bước sau: gán giọng nam/nữ theo nhân vật (cần diarization).
4. **Chưa tích hợp vào worker** — dub mới là POC thủ công. Bước cuối: mỗi tập render xong tự sinh cả bản sub + bản dub.

---

## 6. Setup máy MỚI để làm tiếp

1. **Repo**: copy `/Users/kevin/video` (hoặc clone nhánh `feat/mac-render-farm`).
2. **`.env`** (gitignored — copy thủ công từ máy này): `247drama-worker/.env` chứa:
   `MongoDb_Connection_String, baseURL, WORK_DIR, OCR_PYTHON, RENDER_CONCURRENCY, OCR_THREADS, KEEP_ORIGINAL, SERVER_*, HK_PASSWORD, HK_HOST, R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET, R2_BUCKET, R2_PUBLIC_BASE, R2_KEY_PREFIX, ELEVEN_API_KEY, ELEVEN_VOICE_ID`.
3. **Ổ ngoài BINGNET** (exFAT) mount tại `/Volumes/BINGNET/247drama-render` (media + venv demucs). Nếu máy khác không có ổ này → đổi `WORK_DIR` + tạo lại demucs-venv.
4. **Prereq**: Node ≥20, `npm install`; ffmpeg có **libass** (`brew install homebrew-ffmpeg/ffmpeg/ffmpeg`); OCR venv python **3.12** + rapidocr (`OCR_PYTHON`); demucs venv (torch+numpy+demucs) cho dub.
5. **Chạy**: `./ops/hk-tunnel.sh` (mở tunnel) → `nohup node worker.js > .../worker.log 2>&1 &`.
6. **Chỉ 1 worker chạy 1 lúc** (nhiều worker sẽ render trùng — dedup Mongo cứu phần lớn nhưng lãng phí).

---

## 7. Memory (Claude) liên quan
`/Users/kevin/.claude/projects/-Users-kevin-video/memory/`: `247drama-server.md`, `mac-render-farm-247drama.md`, `r2-storage-247drama.md`, `52api-duanju-integration.md`.

## 8. Spec/Plan
`docs/superpowers/specs|plans/2026-07-27-*` (r2-storage, mac-render-farm, elevenlabs-dub-poc).

---

## 9. Việc tiếp theo (ưu tiên)
1. **Dub**: user đánh giá bản v3+emotion; fix sub=dub (render lại tập demo); thử giọng khác; phân vai; tích hợp vào worker.
2. **Domain cho R2** (gỡ rate-limit r2.dev) — mua domain → Cloudflare → đổi publicBase + updateMany.
3. **Auto-reconnect tunnel HK** (hay rớt).
4. **hg 1080p**: theo dõi tập mới ra 1080p OK; cân nhắc re-render kho cũ nếu muốn.
