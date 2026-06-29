---
name: nonelab-video
description: >
  Hệ thống sản xuất video bùng nổ của Nonelab cho TikTok Shop / Douyin — mổ xẻ
  (phân tích) một video bán hàng thành công thức tái dùng, lấy transcript, chấm
  điểm theo khung viral, và biến nó thành nhiều góc quay cho sản phẩm Nonelab;
  đồng thời hướng dẫn cả vòng lặp sản xuất nội dung (xây kho tư liệu, tìm đối
  chuẩn, test → bứt phá sản lượng → ổn định, phân bổ KOC). Dùng skill này bất cứ
  khi nào người dùng muốn: phân tích / mổ xẻ một video, hiểu vì sao một video viral,
  bóc tách hook & khung của đối thủ, lấy transcript, lên kế hoạch sản xuất nội dung
  video bán hàng, xây kho tư liệu (素材库), tìm đối chuẩn (对标), hoặc lập chiến lược
  KOC/KOL. Cũng kích hoạt khi người dùng nói "phân tích video này", "mổ xẻ video",
  "vì sao video này lên", "bóc hook", "làm content cho [sản phẩm]", "analyze this
  TikTok", hoặc thả vào một file video / đường link.
compatibility: "Phần phân tích tự động cần GEMINI_API_KEY trong .env ở repo root. Cài: pip install google-genai --break-system-packages. Không có key vẫn dùng được phần khung & chiến lược (mục B)."
---

# Nonelab Video — Hệ thống video bùng nổ

Skill này tích hợp **năng lực phân tích video** (transcript + chấm điểm qua Gemini)
với **phương pháp sản xuất nội dung video bùng nổ của Nonelab** (đúc kết từ thương
mại giải trí Douyin/TikTok Shop). Nó phục vụ hai việc:

- **MỤC A — Mổ xẻ một video:** đưa vào 1 video (MP4 hoặc link), trả ra transcript,
  bóc tách khung, chấm điểm theo checklist viral, và xuất ra công thức tái dùng được
  + ý tưởng lắp sản phẩm Nonelab vào.
- **MỤC B — Lập kế hoạch sản xuất:** xây kho tư liệu, tìm đối chuẩn, thiết kế vòng
  test → bứt phá → ổn định, phân bổ KOC. Không cần video, không cần API key.

Khi không rõ người dùng muốn gì, hỏi một câu ngắn: *"Anh muốn em mổ xẻ một video cụ
thể, hay lên kế hoạch sản xuất nội dung?"*

> **Ngôn ngữ:** Mặc định trả lời bằng **tiếng Việt**, giọng trực tiếp, thực chiến —
> đây là tài liệu nội bộ cho team Brand Manager của Nonelab.

---

## File tham chiếu (đọc khi cần)

| File | Nội dung | Khi nào đọc |
|------|----------|-------------|
| `references/he-thong-test.md` | Quy trình test 5 bước, checklist hiệu quả 5 điểm, 4 câu hỏi review | Khi mổ xẻ video hoặc lên kế hoạch test |
| `references/trien-khai-tu-lieu.md` | Đối chuẩn (对标) 5 cách, xây kho tư liệu, mổ xẻ video 4 bước, công thức bùng nổ | **Đọc trước khi mổ xẻ bất kỳ video nào** |
| `references/storyboard-ma-tran.md` | Ma trận Đủ/Cần 6 chiều theo từng phân cảnh + từ điển góc máy chuẩn quốc tế (StudioBinder: cỡ cảnh, tầm máy, góc nghiêng, chuyển động, ống kính) | **Đọc trước khi làm storyboard / mổ hình ảnh chi tiết** |
| `references/chien-luoc.md` | Công thức bứt phá sản lượng, phân bổ KOC 3 tầng, ma trận kênh nhà, gắn kết KOC | Khi lập chiến lược scale |
| `assets/*.png` | 11 infographic minh họa (ma trận Đủ/Cần, sơ đồ đối chuẩn, mổ xẻ 4 bước, trực quan hóa…) | Khi cần hình minh họa cho team, hoặc tự đối chiếu phương pháp |

---

# MỤC A — Mổ xẻ một video

### Setup (một lần)
```bash
pip install google-genai --break-system-packages
```
Đặt `GEMINI_API_KEY=...` trong `.env` ở repo root. Script: `scripts/analyze_video.py`.

### Input
| Định dạng | Cách đưa vào |
|-----------|--------------|
| File MP4 nội bộ | Đường dẫn file làm tham số |
| Link YouTube | URL làm tham số (chỉ video public) |
| TikTok / Instagram | **Tải về trước** rồi truyền đường dẫn MP4 (skill này không tự tải) |

### Chạy phân tích
```bash
python scripts/analyze_video.py /đường/dẫn/video.mp4 --output /tmp/mo-xe.md
```
Script upload video lên Gemini, lấy transcript và trả về **Phiếu mổ xẻ** theo
đúng khung Nonelab (xem mục Output bên dưới).

### Quy trình 3 bước

**Bước 1 — Đọc khung trước.** Trước khi diễn giải, đọc `references/trien-khai-tu-lieu.md`
(mục 4.4 mổ xẻ 4 bước + 4.5 công thức bùng nổ), `references/he-thong-test.md`
(checklist hiệu quả 5 điểm), và `references/storyboard-ma-tran.md` (ma trận Đủ/Cần
6 chiều + từ điển góc máy — bắt buộc đọc để làm storyboard chi tiết). Đây là bộ tiêu chí chấm.

**Bước 2 — Chạy script** rồi diễn giải kết quả qua khung Nonelab:

- **Mở đầu bùng nổ (3 giây đầu)** — có giữ được người không? Thuộc kiểu hook nào?
  (mâu thuẫn / con số + bối cảnh bất ngờ / gọi thẳng người xem / nói hộ suy nghĩ thầm
  / reframe phi lý / pattern interrupt). Là viewer-first hay creator-first?
- **Pain point** — có đánh thẳng nỗi đau cụ thể không, hay nói lan man?
- **Kết quả nhìn thấy** — có QUAY ra hiệu quả (trước/sau, zoom, test) hay chỉ nói suông?
- **So sánh** — có đối chiếu trái/phải, cũ/mới, dùng/không dùng?
- **Quá trình sử dụng** — có quay mở hộp → bôi → sau X giờ không?
- **Cảnh tạo chuyển đổi** — cảnh nào khiến người tin & muốn mua? Mạnh hay yếu?
- **Cảnh dẫn mua hàng (CTA)** — đóng vòng (giải đáp) hay mở vòng (đẩy follow/đơn)?

**Bước 3 — Rút công thức + lắp sản phẩm Nonelab.** Từ video đã mổ, viết ra:
1. **Công thức cấu trúc hình ảnh:** Mở đầu + Nội dung + Sản phẩm + Chốt.
2. **Công thức cấu trúc lời thoại:** Nỗi đau/nhu cầu → Điểm bán → Lợi ích cốt lõi.
3. **Điền vào kho:** trích các câu đắt vào *kho lời thoại*, các cảnh đắt vào *kho hình ảnh*.
4. **Lắp sản phẩm Nonelab vào khung** — từ 1 USP đẻ ra nhiều góc quay (xem mục 2 của
   `he-thong-test.md`). Nêu sản phẩm Nonelab nào hợp khung này nhất và vì sao.
5. **Đối chuẩn:** khung này thuộc cách đối chuẩn nào trong 5 cách (cùng loại / công
   dụng tương tự / cùng khách hàng / kết quả tương tự / chéo ngành)?

### Output — Phiếu mổ xẻ video (theo thứ tự)

```
## 1. Transcript đầy đủ
[timestamp] lời thoại, kèm [OVERLAY], [NHẠC], [CẮT CẢNH]

## 2. Bóc tách khung tổng
Mở đầu → Giữa → Kết: bố cục video dựng thế nào.

## 3. STORYBOARD CHI TIẾT — ma trận Đủ/Cần theo TỪNG phân cảnh
Tách video thành toàn bộ phân cảnh (đánh số + timestamp). Mỗi phân cảnh mô tả đủ
6 chiều theo 2 cột ĐỦ (video mẫu có gì) / CẦN (chuẩn bị gì để tái hiện):

### Phân cảnh N — [mm:ss–mm:ss] "tên cảnh"
| Chiều | ĐỦ (video mẫu có) | CẦN (chuẩn bị để quay) |
| Hành động (ACTION) | | |
| Bối cảnh (SETTING) | | |
| Âm thanh (SOUND) | | |
| Góc máy (CAMERA) | *bắt buộc đủ 5 lớp chuẩn quốc tế: Cỡ cảnh + Tầm máy + Góc nghiêng + Chuyển động + Ống kính/nhịp* | |
| Trang phục (WARDROBE) | | |
| Diễn viên (CAST) | | |

> GÓC MÁY phải viết theo CHUẨN QUỐC TẾ (StudioBinder), KHÔNG được "quay cận sản phẩm".
> Phải kiểu: "ECU giọt serum, tầm Overhead, góc thẳng 90°, đẩy-vào chậm rồi lia dọc
> rê theo vệt serum, macro slow-mo, xóa phông sâu." Dùng đúng viết tắt ECU/CU/MCU/MS/
> CS/MFS/FS và tách rõ Tầm máy (Overhead/Eye/Shoulder/Hip/Knee/Ground) với Góc nghiêng
> (high/low/dutch/OTS/POV). Từ điển đầy đủ + sơ đồ: `references/storyboard-ma-tran.md`.

## 3B. Ba cảnh then chốt (đánh dấu trong storyboard)
- Cảnh mở đầu gây tò mò: [phân cảnh số mấy]
- Cảnh tạo chuyển đổi: [phân cảnh số mấy]
- Cảnh dẫn mua hàng: [phân cảnh số mấy]

## 4. Bóc tách lời thoại
Trình tự dẫn dắt câu chữ.

## 5. Checklist hiệu quả (Đạt / Một phần / Thiếu)
| Tiêu chí | Mức | Ghi chú |
| 3s đầu giữ người | | |
| Pain point cụ thể | | |
| Kết quả nhìn thấy | | |
| Có so sánh | | |
| Quá trình sử dụng | | |
| Cảnh tạo chuyển đổi | | |
| CTA / dẫn mua | | |

## 6. Chấm theo CÔNG THỨC BÙNG NỔ
- Phần 1 — Mở đầu bùng nổ: [Mạnh/TB/Yếu] + vì sao
- Phần 2 — Điểm đau/điểm bán có hình ảnh chứng minh: [Mạnh/TB/Yếu] + vì sao
- Kết luận: video này dễ/khó bùng nổ & ra đơn vì… (nhớ: thiếu một phần là hỏng)

## 7. Công thức tái dùng
- Công thức hình ảnh: Mở đầu + Nội dung + Sản phẩm + Chốt (điền cụ thể)
- Công thức lời thoại: Nỗi đau → Điểm bán → Lợi ích cốt lõi (điền cụ thể)

## 8. Lắp vào Nonelab
- Sản phẩm/brand Nonelab phù hợp nhất: …
- 5–10 góc quay đẻ ra từ khung này cho sản phẩm đó
- Thuộc cách đối chuẩn số mấy & vì sao

## 9. Nạp kho
- Kho lời thoại: [các câu đắt cần lưu]
- Kho hình ảnh: [các cảnh đắt cần lưu]
```

> **Nguyên tắc vàng khi tái dùng:** *tăng "điểm cộng", đừng tạo "điểm trừ"*. Đừng chỉ
> copy hook/lời thoại/góc quay — phải cộng thêm lợi thế riêng (sản phẩm tốt hơn,
> người thu hút hơn, hình đẹp hơn, câu chuyện thật hơn). Copy khung + lợi thế riêng
> = mới thắng.

---

# MỤC B — Lập kế hoạch sản xuất nội dung

Không cần video. Dùng khi anh muốn lên kế hoạch cho một sản phẩm/brand.

**B1. Xác định nội dung.** Luyện mắt bằng nhiều video viral + xây thư viện nội dung
(~20 hook, ~30 bối cảnh, ~50 góc máy, ~10 CTA cho mỗi sản phẩm). → `he-thong-test.md` mục 1.

**B2. Tìm đối chuẩn (对标).** Chọn trong 5 cách: cùng loại / công dụng tương tự /
cùng khách hàng / kết quả tương tự / chéo ngành. → `trien-khai-tu-lieu.md` mục 4.1.

**B3. Xây kho tư liệu (素材库).** 4 nguồn: lướt tay ≥200 video/ngày, kênh chính thức
nền tảng, công cụ bên thứ ba, kéo theo chu kỳ. → mục 4.2.

**B4. Trực quan hóa điểm bán & nhu cầu.** Liệt kê điểm bán → mỗi điểm bán 3 ý tưởng
trực quan; phân tích nhóm khách theo *thời điểm có nhu cầu*. Số lượng chuẩn: 3–5
khung/tuần, 15–20 video/khung, test 4 vòng/1 tháng. → mục 4.3.

**B5. Vòng đời & scale.** Test → Bứt phá sản lượng (放量) → Ổn định. Áp công thức
*Chắc chắn + Hiệu quả + Hiệu suất cao + Phong phú*, mỗi loại ≥15–20 video. Phân bổ
KOC 3 tầng (20/40/40), tự xây ma trận kênh nhà, gắn kết sâu KOC. → `chien-luoc.md`.

Khi người dùng đưa một sản phẩm/brand cụ thể, hãy đi xuyên B1→B5 và trả ra kế hoạch
cụ thể (không bê khung lý thuyết), kèm số lượng & timeline test rõ ràng.

---

## Skill này KHÔNG làm

- Không tự tải video TikTok/Instagram (tải tay rồi truyền đường dẫn).
- Không đăng/xuất bản — chỉ phân tích & lên ý tưởng.
- Không truy cập video YouTube private/unlisted.
- Không thay thế gu thẩm mỹ của người làm — skill bày ra cái gì đang hiệu quả, gu
  của anh chọn cái gì đáng "steal".

## Ghi chú kỹ thuật
- Model phân tích: `gemini-3-flash-preview` (hiểu video tốt, thừa sức cho short-form 1–5 phút).
- Nếu **không có** GEMINI_API_KEY: vẫn dùng được toàn bộ MỤC B và phần khung lý thuyết;
  với MỤC A, có thể dùng Hook Layer MCP (nếu đã kết nối) để tra corpus/score hook,
  hoặc người dùng dán sẵn transcript để mổ xẻ thủ công theo khung trên.
