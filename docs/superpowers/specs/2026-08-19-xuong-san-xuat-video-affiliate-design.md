# Xưởng — Sản xuất video affiliate từ ảnh sản phẩm

**Ngày:** 19/08/2026 **Trạng thái:** Thiết kế đã duyệt, chờ lập kế hoạch triển khai **Đích triển khai:** `video.nonelab.net` (module mới trong Nonelab Studio)

---

## 1. Mục tiêu

Cho vào ảnh sản phẩm và ảnh bối cảnh, nhận về một clip review 9:16 đã có giọng đọc tiếng Việt, phụ đề, nhạc nền, ảnh bìa và caption — đăng TikTok Shop được ngay.

Đây là module thứ hai của Nonelab Studio, đứng cạnh module `Mổ xẻ` hiện có. Một bên đọc vị video bùng nổ, một bên sản xuất ra chúng.

**Bối cảnh:** thiết kế này dựng lại (bằng API, không phụ thuộc Google Flow) một tool tự tạo trong Flow mà chủ dự án đang dùng: ảnh sản phẩm + ảnh bối cảnh → 3 khung cảnh (bao bì / sản phẩm / nhãn) → clip 8s 9:16 → nối bằng hiệu ứng Fade.

## 2. Quyết định đã chốt

| Hạng mục | Quyết định | Lý do |
| --- | --- | --- |
| Nơi đặt | Module trong Nonelab Studio, cùng gốc `video.nonelab.net/xuong` | Dùng lại nguyên JWT, không CORS, không sửa nginx, không xin SSL mới |
| Dạng clip giai đoạn 1 | Sản phẩm + bàn tay, voice-off. Không có mặt người | Dễ giữ nhận diện sản phẩm nhất, rẻ nhất, không lo lệch khẩu hình |
| Engine ảnh | Nano Banana Pro (Gemini 3 Pro Image) | Trộn tới 5 ảnh tham chiếu, giữ đúng nhận diện, xuất 2K |
| Engine video mặc định | Veo 3.1 Lite (nháp) → Veo 3.1 Fast (chốt) | Một key, một SDK (`@google/genai` đã có trong repo), cùng nhà với engine ảnh |
| Engine video thứ hai | Kling 3.0 — cắm adapter, bật sau khi bench | #1 ELO tổng thể, thắng rõ ở chuyển động và vật lý (cảnh tay-đồ ăn) |
| Engine video thứ ba | Seedance 2.0 — viết adapter, **không bật** | Rẻ nhất nhưng API quốc tế đang đóng băng vì kiện tụng bản quyền |
| Giọng đọc preset | FPT.AI (chốt) · edge-tts vi-VN (nháp, miễn phí, có timestamp từng từ) | FPT.AI cho chất lượng; edge-tts là API không chính thức của Edge Read-Aloud, chỉ dùng nháp nội bộ, không đem bán. Dự phòng Gemini TTS |
| Nhân bản giọng + đo nhịp | Blaze.vn chính, MiniMax Speech 2.8 dự phòng | Blaze chuyên tiếng Việt, bao cả tách nhạc + STT + nhân bản. ElevenLabs bị loại (xem mục 6.1) |
| Nguồn kịch bản | Cả 4: AI tự viết · Phiếu mổ xẻ · Mẫu ngành hàng · Nhập tay | Đều đổ về cùng một phiếu kịch bản sửa tay được |
| Mức tự động | Có chốt duyệt ảnh trước khi render + chạy lô hàng loạt | Ảnh rẻ hơn video 10 lần — sai thì sửa ở chỗ rẻ |
| Đầu ra | mp4 9:16 + voice-off + phụ đề burn cứng + nhạc nền + ảnh bìa + caption/hashtag | Đăng được ngay, không cần dựng thêm |
| Kinh doanh | Nội bộ trước, chỗ cắm credit để sẵn, chưa xây ví | YAGNI, nhưng không đập đi làm lại khi mở bán |

### 2.1 Vì sao không lấy Veo Standard làm mặc định

Lợi thế lớn nhất của Veo 3.1 so với phần còn lại là **audio đồng bộ và thoại khớp khẩu hình**. Giai đoạn 1 dùng voice-off ghép ngoài, không có mặt người — nên trả giá Veo Standard là trả tiền cho tính năng bị vứt đi. Veo chỉ thật sự đáng giá ở giai đoạn 3, khi làm avatar có mặt nói tiếng Việt.

### 2.2 Vì sao chọn Veo dù Kling cho chuyển động tốt hơn

Đây là đánh đổi có ý thức: đổi một phần chất lượng chuyển động lấy **sự đơn giản vận hành** ở giai đoạn 1 — một key, một hoá đơn, một SDK đã nằm trong repo, ảnh và clip cùng nhà nên ít lệch màu. Kling được viết adapter ngay từ giai đoạn 1 và bật lên nếu bench Bước 0 cho thấy nó thắng ở cảnh tay-đồ ăn.

### 2.3 Vì sao gánh nặng khó nhất không nằm ở model video

Bài toán "giữ đúng chữ trên bao bì, đúng logo, đúng màu nhãn" là bài toán **ảnh**, và được giải xong ở chặng 2. Model video chỉ nhận một khung hình sạch và làm nó chuyển động — hẹp hơn nhiều. Giới hạn chung của mọi model video là chúng phân bố lại pixel giữa các khung chứ không hiểu logo là gì, nên chữ nhỏ vẫn có thể méo. Ba chốt chặn được đưa thẳng vào pipeline:
1. Ảnh nguồn sạch — ảnh do model sinh thường ổn định hơn ảnh chụp thật
2. `motion_level = 'low'` cho mọi cảnh có nhãn mác chữ nhỏ
3. Sinh 2 lượt, chọn 1 ở màn chốt duyệt

## 3. Kiến trúc — pipeline 5 chặng

```
[1] KỊCH BẢN   Gemini nhìn ảnh sản phẩm → Phiếu kịch bản (hook + N cảnh)
                nguồn: AI tự viết | Phiếu mổ xẻ | Mẫu ngành hàng | Nhập tay
                       ↓  (sửa tay được ở mọi ô)
[2] ẢNH KHOÁ   Mỗi cảnh → 1 ảnh 9:16 · Nano Banana Pro
                tham chiếu bắt buộc: ảnh sản phẩm + ảnh bối cảnh
                       ↓
[3] CHỐT DUYỆT (người)   Lưới ảnh: duyệt / loại / sinh lại / sửa prompt
                       ↓  (chỉ ảnh approved mới đi tiếp)
[4] CLIP       Mỗi ảnh đã duyệt → clip 4-8s, ảnh khoá là KHUNG HÌNH ĐẦU
                       ↓
[5] GHÉP       TTS tiếng Việt → phụ đề bám timestamp từng từ của giọng đọc
                (engine không trả timestamp → forced alignment trên chính file giọng, xem 3.3)
                ffmpeg: nối không re-encode + Fade/Dissolve/Wipe/Slide/Zoom + nhạc nền chìm + burn sub
                       ↓
               MP4 9:16 + ảnh bìa + caption/hashtag
```

**Cơ chế giữ nhận diện sản phẩm** — điểm sống còn của tool. Ảnh sản phẩm gốc luôn là tham chiếu cứng ở chặng 2, và **ảnh khoá đã duyệt trở thành khung hình đầu tiên** của chặng 4. Model video không có cơ hội vẽ lại bao bì cho sai; nó chỉ được làm khung hình đó chuyển động. Đây cũng là lý do chốt duyệt nằm giữa chặng 2 và 4, không nằm ở cuối.

### 3.1 Bốn lớp engine cắm-rút

| Lớp | Việc | Bản dùng ngay | Dự phòng |
| --- | --- | --- | --- |
| `ImageEngine` | Ảnh khoá | Nano Banana Pro | Seedream, Flux |
| `VideoEngine` | Ảnh → clip | Veo 3.1 Lite / Fast | Kling 3.0, Seedance (tắt) |
| `VoiceEngine` | Giọng đọc preset | FPT.AI (chốt) · edge-tts (nháp) | Gemini TTS |
| `AlignEngine` | Mốc thời gian phụ đề | Timestamp từ TTS | Forced alignment whisper (đã biết văn bản) |
| `CloneEngine` | Nhân bản giọng + đo nhịp | Blaze.vn | MiniMax Speech 2.8 |

Đổi engine là đổi một dòng cấu hình, không đụng pipeline. Giá thị trường đang tụt nhanh và các nguồn báo giá lệch nhau, nên bảng giá **nằm trong cấu hình, không hard-code**.

### 3.2 Vị trí file

`server/index.ts` đã 911 dòng. Module mới đứng riêng, `index.ts` chỉ thêm hai dòng (`app.use` và `resumeStudioJobs`):

```
server/studio/
  db.ts        CREATE TABLE studio_*
  routes.ts    mount /api/studio — mỏng, chỉ kiểm tra đầu vào rồi gọi service
  pipeline.ts  5 chặng + máy trạng thái của shot
  script.ts    4 nguồn kịch bản → cùng 1 schema
  assemble.ts  ffmpeg: nối, chuyển cảnh, nhạc nền, burn phụ đề
  pricing.ts   bảng giá + máy tính chi phí
  voices.ts    Kho giọng: bóc tiếng, tách nhạc, STT, đo nhịp, nhân bản (GĐ 1.5)
  engines/     image.ts · video.ts · voice.ts · align.ts · clone.ts · fake.ts
```

### 3.3 Đồng bộ thoại–clip và bài học ghép từ MoneyPrinterTurbo

Đã đọc kỹ [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (108k sao, MIT, Python/moviepy). **Không mượn code, không chạy kèm**: nó ghép video từ *kho footage stock* (Pexels/Pixabay) — gõ "gà rán" ra clip gà rán của người lạ, đúng bài toán Xưởng đang thay thế; 3/5 chặng của nó vô dụng với mình, chỉ chặng ghép là trùng và ffmpeg trong Node làm được. Mượn 5 bài học:

**a. Thoại phải vừa clip — chặn từ chặng 1, không chặn ở chặng 5.** MoneyPrinterTurbo kéo video theo độ dài audio (lặp/cắt clip cho vừa giọng). Mình ngược lại: clip Veo cố định 4/6/8s, không co được. Nên ràng buộc ngay ở kịch bản:

```
số_âm_tiết(dialog) ≤ syllables_per_sec × clip_len
ví dụ: 4.8 âm tiết/giây × 8s ≈ 38 âm tiết tối đa một cảnh
```

Màn Phiếu kịch bản hiện bộ đếm *"32/38"* realtime, đỏ khi vượt, và AI sinh kịch bản nhận đúng ngưỡng này trong prompt. `syllables_per_sec` lấy từ hồ sơ giọng (mục 6) hoặc, ở Giai đoạn 1, từ preset của giọng FPT.AI/edge-tts đã đo sẵn. Đây là chỗ phép đo nhịp trả giá trị ngay từ Giai đoạn 1, chưa cần nhân bản giọng. Thoại ngắn hơn clip thì được (im lặng + nhạc); dài hơn thì **không render** cho tới khi sửa.

**b. Phụ đề: timestamp từ TTS, hỏng thì forced alignment.** Vì mình *biết sẵn văn bản*, khi engine giọng không trả mốc thời gian từng từ (FPT.AI — cần xác minh; edge-tts và ElevenLabs có), chỉ cần **forced alignment** trên chính file giọng bằng whisper — chính xác hơn nhiều so với nhận dạng tự do, kể cả tiếng Việt. Không bao giờ để phụ đề lệch giọng vì thiếu timestamp.

**c. Nhạc nền:** volume nhân hệ số, **fade-out 3 giây cuối**, loop khi nhạc ngắn hơn video, biên an toàn 0.1s giữa audio và video.

**d. Ghép:** concat bằng ffmpeg trực tiếp, **không re-encode** từng clip lẻ; chỉ encode một lần ở bước cuối khi burn phụ đề.

**e. Chuyển cảnh + phụ đề:** enum thêm `slide` / `zoom` / `shuffle` cạnh Fade/Dissolve/Wipe; phụ đề có **nền bo góc** kiểu TikTok, canh dưới, chỉnh được font/màu/viền.

## 4. Mô hình dữ liệu

Nguyên tắc: **mỗi cảnh là một dòng độc lập, mang trạng thái và chi phí riêng.** Mọi thứ đắt tiền xảy ra ở cấp cảnh, nên duyệt, chạy lại và tính tiền cũng ở cấp cảnh.

```
studio_projects   id · owner · name · industry · ratio · clip_len
                  tier ('draft'|'final') · script_source · autopsy_id · batch_id
                  stage ('script'|'keyframe'|'review'|'clip'|'assemble'|'done'|'failed')
                  cost_usd · message · created · updated

studio_assets     id · project_id · kind ('product'|'background'|'style') · path

studio_shots  ★   id · project_id · idx
                  purpose ('hook'|'packaging'|'product'|'label'|'interaction'|'cta')
                  camera ('wide'|'medium'|'close') · dialog
                  image_prompt · motion_prompt · motion_level ('low'|'medium'|'high')
                  image_path · image_status · approved
                  clip_path · clip_status · engine · attempts · cost_usd · error

studio_renders    id · project_id · mp4_path · cover_path · srt_path
                  caption · hashtags · voice · music · duration · cost_usd

studio_batches    id · owner · name · config(JSON) · status
```

**Giá trị enum trong DB dùng tiếng Anh, nhãn tiếng Việt chỉ nằm ở giao diện.** Trộn hai ngôn ngữ trong cùng tập giá trị là nguồn lỗi so sánh chuỗi kinh điển. Bảng tra nhãn nằm một chỗ ở frontend: `wide→Góc xa`, `medium→Góc trung`, `close→Góc cận`, `low→Biên độ thấp`, `packaging→Bao bì`, `label→Nhãn`, `interaction→Tương tác`.

Ba cột đáng chú ý:
- **`motion_level`** — chốt chặn méo chữ, phải nằm trong dữ liệu để lần chạy lại vẫn giữ
- **`approved`** — cổng chặn tiền. Không có cờ này thì không lệnh render nào được phát
- **`attempts`** — chặn vòng lặp tự thử lại đốt tiền vô hạn

Bảng dùng nếp có sẵn của `server/db.ts`: `runQuery` / `allQuery` / `getQuery`, migration bằng `ensureColumn` chạy **sau** `CREATE TABLE`.

### 4.1 Luật lưu trữ: không một byte nhị phân nào vào sqlite

`db.sqlite` trên prod đã phình tới **215MB** vì frame ảnh được nhúng base64 vào chính DB. Với ảnh 2K và mp4, làm theo nếp đó thì DB chết trong một tuần. **File nằm trên đĩa, DB chỉ giữ đường dẫn.**

## 5. Lưu trữ — số thật đo được trên `163.44.193.87` (19/08/2026)

| Hạng mục | Đo được |
| --- | --- |
| CPU / RAM | 8 lõi, load 0.97, 15GB RAM (13GB trống) |
| Ổ hệ thống `/dev/vda2` | 50G, còn trống **21G** — volume videoana hiện tại nằm đây |
| Ổ dữ liệu `/dev/vdb1` → `/data` | 150G (147G khả dụng), dùng 13G, **còn trống 127G** |
| `/data` đang chứa | `nonelab-store/costs.db` **13GB** của app khác, WAL 305MB ghi liên tục |
| ffmpeg trong container | **8.1.2 có sẵn** — không cần sửa Dockerfile |
| Cùng box | 10 container: 2 WordPress + 2 MySQL + livescope + gms + ai + cloudflared… |

**Quyết định:** Xưởng lưu tại `/data/videoana-studio/`, mount vào container thành `/app/data/studio`. Ở mức ~64MB/dự án thì 127GB ≈ **2.000 dự án**.

**Tuyệt đối không dùng `server/uploads`** — thư mục đó không được mount (đo được: rỗng 0 file), rebuild container là mất sạch mp4.

**Trần dung lượng `STUDIO_MAX_DISK_GB`** cộng một endpoint báo dung lượng còn lại: vì `costs.db` của app khác dùng chung ổ và đang phình nhanh, hai bên không được phép ăn thịt nhau.

Ước lượng một dự án 5 cảnh: 5 ảnh khoá 2K (15MB) + 5 clip cảnh (32MB) + mp4 cuối (15MB) + giọng đọc/srt/bìa (2MB) ≈ **64MB**. Xoá clip lẻ sau khi ghép còn ~32MB.

## 6. Kho giọng — bóc giọng và nhịp nói từ clip (Giai đoạn 1.5)

Bóc giọng từ một clip có sẵn, rồi đọc kịch bản bằng **đúng giọng đó, đúng tốc độ đó**. Khớp sẵn với repo: `server/tiktok.ts` đã tải được video từ link (đang dùng cho Phiếu mổ xẻ), `ffmpeg` 8.1.2 đã nằm trong container. Nó đóng được một vòng tròn: **mổ xẻ clip đối thủ → bóc luôn giọng và nhịp nói của nó → áp vào clip của mình.**

### 6.1 ElevenLabs bị loại khỏi vai trò nhân bản

Với tiếng Việt, ElevenLabs **đọc tự nhiên nhất nhưng giống giọng gốc kém nhất** — cho ra một giọng hay, không phải giọng của người cần nhân bản. Chất lượng tụt rõ ở ngôn ngữ có thanh điệu, và phát âm sai kiểu đặc trưng của model không chuyên tiếng Việt. Với tính năng mà mục đích *chính* là giống giọng gốc, đó là loại thẳng.

| Engine | Mẫu cần | Tiếng Việt | Ghi chú |
| --- | --- | --- | --- |
| **Blaze.vn** | cần xác minh | **Chuyên tiếng Việt.** Giữ nguyên timbre người gốc | Có cả **tách giọng khỏi nhạc** + **STT** + phân định người nói |
| **MiniMax Speech 2.8** | **5 giây** | Hỗ trợ Á Đông tốt, xử lý thanh điệu ổn | Có trên fal.ai và Replicate — dễ cắm |
| Fish Audio S2 | 10 giây | Kém MiniMax ở ngôn ngữ Á Đông | Rẻ nhất, có open weights |
| ElevenLabs | ~1 phút | **Yếu — giống giọng gốc kém nhất** | Loại khỏi vai trò nhân bản |

**Chốt: Blaze.vn chính, MiniMax dự phòng.** Lý do quyết định không phải chất lượng giọng, mà là **Blaze bao trọn cả ba khâu** — tách giọng khỏi nhạc, chuyển giọng thành chữ có mốc thời gian, rồi nhân bản. Ghép từ ba nhà khác nhau là ba lần tích hợp, ba tài khoản, ba chỗ hỏng.

*Bẫy giá:* Fish Audio tính **$15/1 triệu byte UTF-8**, mà chữ tiếng Việt có dấu chiếm 3 byte — tính theo ký tự thành ~$45/1M, gấp ba con số trên bảng giá.

### 6.2 Tách làm hai nửa dùng riêng được

**Nửa A — Nhịp giọng.** Đo từ clip nguồn: **âm tiết/giây**, tỉ lệ khoảng lặng, độ dài câu trung bình. Áp được lên *bất kỳ* giọng nào. Đây là nhịp điệu, **không mang danh tính ai**.

**Nửa B — Nhân bản giọng.** Dựng lại đúng timbre người trong clip.

Lý do tách: nhân bản timbre từ clip người khác mà không có phép là chỗ điều khoản các nhà cung cấp đều siết, và bị khoá tài khoản là mất luôn cả pipeline. Còn xét hiệu quả nội dung thì **thứ làm nên tỷ lệ giữ người xem là nhịp** — tốc độ dồn dập, chỗ ngắt, mật độ chữ trên giây — chứ không phải chất giọng. Tách thế này thì phần "đảm bảo hiệu quả" lấy được từ mọi clip đối thủ, còn phần cần giấy phép gói riêng.

**Cột `clone_consent` là BẮT BUỘC** trước khi phát lệnh nhân bản: không tick thì API nhân bản không được gọi, chỉ đo nhịp. Cột này cùng `source_url` để về sau luôn tra được hồ sơ giọng nào có phép, lấy từ đâu.

### 6.3 Đo nhịp — tiếng Việt cho không một lợi thế

Một chặng độc lập, chạy trước, kết quả tái dùng cho nhiều dự án:

```
1. Bóc tiếng      ffmpeg → wav 16k mono           (đã có sẵn trong container)
2. Tách nhạc      Blaze voice separation           ← bắt buộc: clip TikTok luôn có nhạc
3. Chữ + mốc giờ  Blaze STT có timestamp   (dự phòng miễn phí: faster-whisper / PhoWhisper chạy tại chỗ trên box 8 lõi)
4. ĐO NHỊP        âm tiết/giây · tỉ lệ lặng · độ dài câu
5. Nhân bản       Blaze/MiniMax → clone_voice_id   (CHỈ khi clone_consent = 1)
```

Bước 4 là chỗ tiếng Việt cho không một lợi thế: **tiếng Việt đơn âm tiết, nên đếm âm tiết chính là đếm chữ.** Ở tiếng Anh phải suy ra âm tiết bằng heuristic đầy sai số; ở đây tách theo khoảng trắng là ra số đúng. Phép đo nhịp vì thế chính xác gần như tuyệt đối, không cần model nào.

Khi sinh giọng đọc, đặt tốc độ khớp âm tiết/giây đã đo. **Sinh xong đo lại** — lệch quá 10% thì tinh chỉnh và sinh lần hai. Đúng một vòng, không lặp vô hạn.

### 6.4 Dữ liệu

```
studio_voices     id · owner · name
                  source_kind ('upload'|'tiktok'|'record') · source_url · audio_path
                  transcript · clone_engine · clone_voice_id
                  clone_consent (0|1)          ← BẮT BUỘC trước khi nhân bản
                  syllables_per_sec · pause_ratio · avg_sentence_syllables
                  status · created
```

`studio_projects` thêm hai cột: `voice_id` (trỏ `studio_voices`) và `tempo_only` — bật lên nghĩa là chỉ lấy nhịp, đọc bằng giọng preset FPT.AI.

Một hồ sơ giọng dựng một lần rồi dùng cho hàng trăm video — nên nó là **kho**, không phải một bước trong luồng.

## 7. Xử lý lỗi

Nguyên tắc: **hỏng ở đâu chạy lại đúng chỗ đó.** Video 5 cảnh mà cảnh 3 hỏng thì chỉ chạy lại cảnh 3; bốn cảnh kia đã có `clip_path`, không đụng vào.

Lỗi phải được **phân loại**, vì mỗi loại xử lý ngược nhau:

| Loại | Xử lý |
| --- | --- |
| Vượt quota / 429 | Chờ theo backoff rồi thử lại — không tính là hỏng |
| Nội dung bị chặn | **Không thử lại.** Báo người dùng sửa prompt |
| Mạng / 5xx | Thử lại, tối đa 2 lần |
| Hết tiền / khoá key | **Dừng cả hàng đợi**, báo admin |

Phân loại "nội dung bị chặn" thành "mạng/5xx" là kịch bản đốt tiền kinh điển — chỗ này phải có test.

**Phục hồi sau restart** theo đúng nếp `search_jobs` (commit `9acb766`): job đang dở tự chạy lại lúc khởi động. Khác biệt bắt buộc: **shot nào đã có `clip_path` thì bỏ qua tuyệt đối.** Bên `history`, chạy lại một video chỉ tốn thêm một lượt Gemini; bên này, chạy lại một cảnh là mất tiền thật không lấy lại được.

**Trần chi tiêu ngày `STUDIO_DAILY_BUDGET_USD`**: vượt là hàng đợi tự khoá. Một vòng lặp lỗi lúc 2 giờ sáng không được phép ăn hết tài khoản.

## 8. Hàng đợi

Giữ nguyên **khuôn** của `server/queue.ts` — poll 3 giây, giành việc bằng cách lật trạng thái, biến môi trường điều khiển số luồng, phục hồi lúc khởi động — nhưng chạy **vòng lặp riêng trên `studio_shots`** với núm riêng `STUDIO_CONCURRENCY`.

Lý do phải tách: giới hạn tốc độ của Veo/Kling khác xa Gemini, và quan trọng hơn — một lô 20 sản phẩm đổ vào không được phép làm nghẽn hàng đợi mổ xẻ đang chạy. Hai công việc, hai đường ống, hỏng cái này không kéo sập cái kia.

**`STUDIO_FFMPEG_CONCURRENCY=2`** (8 lõi, load hiện tại 0.97 nên an toàn), chạy dưới `nice`, và **tuyệt đối không ghép trong tiến trình xử lý request**.

## 9. Tính tiền

Bảng giá nằm gọn trong `server/studio/pricing.ts`, **một chỗ duy nhất**. Mỗi lần gọi API ghi `cost_usd` vào đúng dòng shot, cộng dồn lên project rồi lên render.

Giao diện hiện **hai con số**: ước tính trước khi bấm, và số thật sau khi chạy. Chênh lệch giữa chúng là tín hiệu bảng giá đã lỗi thời — tự giám sát, không cần ai nhớ đi kiểm tra.

**Bảng giá tham chiếu (19/08/2026, tỷ giá tạm 26k đ/USD) — cần xác minh lại trước khi khoá:**

| Engine | $/giây | 1 cảnh 8s | Video 24s (3 cảnh × 8s) | + ảnh & giọng | Tổng/video |
| --- | --- | --- | --- | --- | --- |
| Seedance 2.0 Fast | ~$0.022 | 4.6k đ | 14k đ | 12.5k đ | ~27k đ |
| **Veo 3.1 Lite** | ~$0.05 | 10k đ | 31k đ | 12.5k đ | **~44k đ** |
| Kling 3.0 Standard | ~$0.084 | 17k đ | 52k đ | 12.5k đ | ~65k đ |
| Kling 3.0 Pro | ~$0.112 | 23k đ | 70k đ | 12.5k đ | ~83k đ |
| **Veo 3.1 Fast** | ~$0.15 | 31k đ | 94k đ | 12.5k đ | **~107k đ** |
| Veo 3.1 Standard | ~$0.40 | 83k đ | 250k đ | 12.5k đ | ~263k đ |

Ảnh: Nano Banana Pro $0.134/ảnh 2K, $0.24/ảnh 4K.

**Chỗ cắm sẵn cho lúc mở bán:** chưa xây ví hay credit (YAGNI). Nhưng vì mọi đồng chi phí đều gắn `owner` ngay từ đầu, lúc mở bán chỉ cần thêm một bảng ví và một hàm trừ tiền — **không phải sửa pipeline.**

## 10. Giao diện

Tab **Xưởng**, bốn màn nối tiếp cộng một màn chạy lô:
1. **Dự án mới** — kéo thả 1–10 ảnh sản phẩm + 1 ảnh bối cảnh; tên sản phẩm, ngành hàng, nguồn kịch bản, tỉ lệ (9:16 mặc định), thời lượng cảnh (4/6/8s), hạng nháp hay chốt. Bấm *Dựng kịch bản*.
2. **Phiếu kịch bản** — bảng từng cảnh: mục đích · góc máy · lời thoại · prompt ảnh · prompt chuyển động · biên độ chuyển động. **Mọi ô sửa tay được** — bốn nguồn kịch bản hội tụ về một mặt bằng duy nhất. Bấm *Dựng ảnh khoá*.
3. **Chốt duyệt** — màn quan trọng nhất. Lưới ảnh 9:16, mỗi ảnh có *duyệt · loại · sinh lại · sửa prompt tại chỗ*. Góc màn hiện chi phí đã tiêu và ước tính render. Nút *Render clip* chỉ sáng khi có ít nhất một ảnh được duyệt.
4. **Bản dựng** — player dọc 9:16, mp4 tải về, ảnh bìa, caption + hashtag copy một nhát, chi phí thật đặt cạnh ước tính ban đầu.
5. **Lô sản xuất** — bảng nhiều dự án, duyệt ảnh hàng loạt trong một lưới, tiến trình realtime. Dùng lại cơ chế tiến trình đã làm cho campaign.
6. **Kho giọng** (GĐ 1.5) — đứng riêng, không nhét vào luồng 4 màn. Dán link TikTok hoặc tải file lên, xem nhịp đo được (*"4.8 âm tiết/giây — nhanh"*), nghe thử, tick `clone_consent` nếu muốn nhân bản timbre, đặt tên, lưu. Màn *Dự án mới* chỉ việc chọn từ danh sách.

## 11. Kiểm thử

`engines/fake.ts` là mảnh ghép quan trọng nhất: một **engine giả trả về file mẫu**, cho phép chạy trọn 5 chặng pipeline **không tốn một đồng**. Nhờ nó, test tự động chạy được trong CI và sửa code lúc nửa đêm không sợ mất tiền.
- **Đơn vị:** máy tính chi phí · phân loại lỗi · dựng chuỗi filter ffmpeg · kiểm tra schema kịch bản
- **Tích hợp:** full pipeline với engine giả, gồm kịch bản restart giữa chừng để chứng minh không sinh lại clip đã có
- **Thật, chạy tay, một lần:** phép thử 3 model ở Bước 0

## 12. Chia giai đoạn

**Kế hoạch triển khai sinh ra từ spec này chỉ bao gồm Bước 0 và Giai đoạn 1.** Giai đoạn 2 và 3 được ghi lại ở đây để thiết kế không chặn đường chúng, nhưng mỗi giai đoạn sẽ có spec và kế hoạch riêng.

**Bước 0 — Phép thử engine (~$5, làm trước khi viết dòng code nào).** Một ảnh khoá gà rán → Veo 3.1 Lite, Veo 3.1 Fast, Kling 3.0 Pro, mỗi thằng 2 lượt. Chấm 4 tiêu chí: *chữ trên bao bì có méo không · bàn tay có dị dạng không · chuyển động có ra chất người thật không · có bám đúng khung hình đầu không*. Kết quả ghi thẳng vào cấu hình engine mặc định. Bảng điểm này đáng tin hơn mọi benchmark trên mạng vì nó chấm đúng ngành hàng thật.

**Giai đoạn 1 — Xưởng chạy được, một sản phẩm một lần.** Kịch bản AI + nhập tay · ảnh khoá · chốt duyệt · clip · ghép VO + phụ đề + nhạc · xuất mp4 + bìa + caption. Engine Veo (Lite/Fast) với adapter Kling cắm sẵn. `engines/fake.ts` để test không mất tiền. Giọng đọc dùng preset FPT.AI.

**Giai đoạn 1.5 — Kho giọng (mục 6).** Bóc tiếng → tách nhạc → STT → đo nhịp → nhân bản (có `clone_consent`). Tích hợp Blaze.vn, dự phòng MiniMax. Chỉ thay nguồn giọng ở chặng 5, không đụng 4 chặng kia — nên tách riêng để Giai đoạn 1 ra được video sớm nhất.

**Giai đoạn 2 — Nhân bản.** Phiếu mổ xẻ → kịch bản (đòn đánh riêng, không đối thủ nào có) · thư viện mẫu theo ngành hàng · lô sản xuất hàng loạt.

**Giai đoạn 3 — Mở bán & nâng cấp.** Ví/credit (chỗ cắm đã có sẵn từ giai đoạn 1) · tự đăng TikTok/IG/YT qua Upload-Post hoặc API chính thức · **avatar có mặt nói tiếng Việt** · **hook có mặt + thân bài sản phẩm** (công thức dân chạy ads dùng nhiều nhất 2026). Đây cũng là lúc Veo mới thật sự đáng giá tiền.

## 13. Ngoài phạm vi — phiếu riêng

Chủ dự án đã chốt lần này **chỉ làm tính năng**. Những việc sau đã phát hiện nhưng không nằm trong phạm vi:
- **Siết CORS.** Prod đang trả `Access-Control-Allow-Origin: *`. Với module mổ xẻ đã là rủi ro; với Xưởng thì nặng hơn vì mỗi lệnh ở đây tiêu tiền thật — bất kỳ trang web nào cũng gọi được API và đốt hộ. **Nên siết trước khi bật Xưởng cho người ngoài dùng.**
- **Model prod lệch repo.** `/api/health` báo `gemini-2.5-flash`, code mặc định `gemini-3-flash-preview`. Khâu sinh kịch bản phải *nhìn ảnh* để viết thoại nên chất lượng model ảnh hưởng trực tiếp — cần chốt biến môi trường tường minh.
- **Tự động dọn đĩa** (xoá clip cảnh lẻ sau khi ghép, xoá dự án quá 30 ngày).
- **Dọn ~245MB backup sqlite cũ** từ tháng 6–7 trong `/var/www/videoana/data`.
- **Chuyển `db.sqlite` 215MB** từ ổ hệ thống `vda2` (còn 21G) sang ổ dữ liệu `/data`.

Ngoại lệ: **thêm volume mount `/data/videoana-studio` vào `docker-compose.yml` nằm trong phạm vi** — không có nó thì file sinh ra không có chỗ bền vững để ở, tính năng không chạy được.

## 14. Rủi ro và điều cần xác minh

| Rủi ro | Ứng phó |
| --- | --- |
| Bảng giá lệch giữa các nguồn, đổi liên tục | Giá trong cấu hình một chỗ; ghi chi phí thật từng shot; đối chiếu ước tính vs thật |
| Veo 3.1 Lite $0.05/s chưa xác minh trên trang giá chính thức | Kiểm tra trước khi khoá làm hạng nháp; nếu sai, tụt về Kling Standard |
| Chữ trên bao bì bị méo ở chặng 4 | `motion_level='thấp'` cho cảnh có nhãn; sinh 2 lượt chọn 1; ảnh nguồn sạch |
| Seedance API quốc tế đóng băng vì kiện tụng | Không đặt xương sống lên nó; adapter viết sẵn, cờ tắt |
| `costs.db` app khác phình chiếm hết `/data` | `STUDIO_MAX_DISK_GB` + endpoint báo dung lượng |
| ffmpeg giành lõi với API mổ xẻ | `STUDIO_FFMPEG_CONCURRENCY=2`, `nice`, không ghép trong request |
| Deploy Xưởng kéo theo commit campaign chưa lên prod (bản prod 29/07) | Biết trước, kiểm tra lại 3 commit `9acb766`, `82f82ba`, `85bcbf8` sau deploy |
| Blaze.vn: chưa xác minh giá API, độ dài mẫu tối thiểu, có tách nhạc qua API không | Xác minh trước GĐ 1.5; nếu thiếu khâu nào, cắm MiniMax cho nhân bản và ffmpeg/Demucs cho tách nhạc |
| Nhân bản giọng người khác không có phép → nhà cung cấp khoá tài khoản | `clone_consent` bắt buộc trong DB; API nhân bản không được gọi khi cờ = 0 |

## 15. Nguồn tham khảo
- [Gemini API — Veo](https://ai.google.dev/gemini-api/docs/veo)
- [Veo 3.1 Ingredients to Video (Google Blog)](https://blog.google/innovation-and-ai/technology/ai/veo-3-1-ingredients-to-video/)
- [Giá API video AI 7/2026](https://www.buildmvpfast.com/api-costs/ai-video)
- [Bảng giá video AI 2026](https://fluxnote.io/blog/ai-video-generation-pricing-guide-2026)
- [Seedance vs Veo vs Kling](https://pixo.video/blog/seedance-vs-veo-vs-kling)
- [Kling 3.0 vs Veo 3.1](https://www.veo3ai.io/blog/kling-3-0-vs-veo-3-1-2026)
- [Truy cập Seedance ngoài Trung Quốc](https://www.atlascloud.ai/blog/guides/access-seedance-2-5-api-outside-china)
- [Trạng thái API Seedance 2.0](https://github.com/Emily2040/seedance-2.0/blob/main/references/api-status.md)
- [Giá API Kling](https://wavespeed.ai/blog/ai-api-pricing/kling-ai-pricing/)
- [Chống méo sản phẩm trong video AI](https://domoai.app/blog/ai-product-videos-without-warping-the-product)
- [Vì sao AI làm sai chữ trên bao bì](https://pebblely.com/blog/ai-product-photos-text-extraction/)
- [Giá Gemini 3 Pro Image](https://openrouter.ai/google/gemini-3-pro-image)
- [FPT.AI Text to Speech](https://docs.fpt.ai/docs/en/speech/documentation/text-to-speech/)
- [Giọng Việt: Blaze vs ElevenLabs](https://blaze.vn/blog/blaze-vs-elevenlabs-vietnamese-voice)
- [ElevenLabs Instant Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning)
- [MiniMax Voice Clone API](https://platform.minimax.io/docs/api-reference/voice-cloning-clone)
- [Fish Audio vs ElevenLabs](https://texttolab.com/blog/fish-audio-vs-elevenlabs)
- [So sánh TTS API 2026](https://gradium.ai/content/best-elevenlabs-alternatives-2026-tts-apis-voice-quality-price)
- [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) — tham khảo chặng ghép: phụ đề từ timestamp TTS + fallback whisper, nhạc nền, concat không re-encode, ràng buộc thoại–clip
