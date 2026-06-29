# Hệ thống test để tạo video bùng nổ

> Phần này là "bộ não" của quy trình: làm sao biến một sản phẩm thành hàng trăm
> video, biết video nào người xem thích, video nào bán được hàng — TRƯỚC khi
> đổ tiền scale. Đọc khi cần lập kế hoạch test, dạy đội ngũ, hoặc review tại sao
> một batch video không lên.

## Mục tiêu giai đoạn test

**Test = Xác định đúng nội dung + Kiểm chứng nội dung có hiệu quả.**

Trước khi scale, phải trả lời được hai câu hỏi:
1. Nội dung nào người xem thích? (giữ người — chỉ số giữ chân, CTR)
2. Nội dung nào bán được hàng? (chuyển đổi — CVR, ra đơn)

Một video có thể giỏi (1) mà dở (2), hoặc ngược lại. Test là để tách bạch hai
việc này bằng dữ liệu, không phải bằng cảm tính.

---

## Tóm tắt quy trình — 5 bước

### ① Xây kho video thật lớn
- Mỗi ngày tạo khoảng **100–300 video** — nhưng KHÔNG phải một người quay 300 video.
- Đây là sản lượng của **cả team hoặc nhiều KOC** cộng lại.
- Ví dụ: 20 KOC × 10 video/ngày = 200 video/ngày.
- Logic: viral là trò chơi xác suất. Càng nhiều "vé số" chất lượng, càng dễ trúng.

### ② Xây USP và chuyển thành nhiều góc quay
- Đừng dừng ở USP khô khan. Ví dụ kem chống nắng: đừng chỉ nói "SPF50 PA++++".
- Biến **một USP** thành hàng chục cách thể hiện: test dưới nắng, soi UV, trước/sau,
  dân văn phòng, da dầu, da mụn, makeup, đi biển, chạy bộ, học sinh…
- **Một USP → hàng chục video.** Đây là nguồn cung cấp số lượng cho bước ①.

### ③ Phân tích video viral (KHÔNG copy)
- Không bê nguyên. Mà **tách** video viral thành: hook, bố cục, góc máy,
  chuyển cảnh, CTA, nhịp dựng.
- Sau đó áp khung đó vào sản phẩm của mình.
- Chi tiết cách "mổ xẻ" 4 bước nằm ở `trien-khai-tu-lieu.md` mục 4.4.

### ④ Test rồi tối ưu
- Không video nào hoàn hảo ngay lần đầu. Tối ưu theo từng nút thắt:
  - Video A: 3s đầu giữ người tốt → nhưng CTR thấp → **đổi thumbnail** → test tiếp
  - → CVR vẫn thấp → **đổi CTA** → test tiếp
- Mỗi vòng chỉ sửa MỘT biến để biết biến nào tạo ra thay đổi.

### ⑤ Không bê nguyên mẫu
- Lỗi phổ biến nhất: copy nguyên video viral. Sau ~1 tuần: hết hiệu quả, người xem
  chán, thuật toán giảm reach.
- Douyin gọi đây là hiện tượng **khung nội dung bị bão hòa** — khung phải được
  **nâng cấp liên tục**, không đứng yên.

---

## 1. Xác định nội dung — 2 việc phải làm

**Việc 1 — Luyện mắt.** Phân tích thật nhiều video viral cho tới khi não tự nhận ra:
"cái gì là hook", "cái gì giữ người", "cái gì bán hàng". Giống luyện mắt thẩm mỹ.

**Việc 2 — Tạo thư viện nội dung.** Với mỗi sản phẩm, gom sẵn:
- ~20 hook
- ~30 bối cảnh
- ~50 góc máy
- ~10 CTA

Khi cần làm video chỉ việc **ghép** các khối lại. Đây là kho nguyên liệu, không
phải video hoàn chỉnh.

---

## 2. Hiệu quả nội dung — Checklist 5 điểm

Mỗi video bán hàng nên qua được checklist này:

### ① 3 giây đầu phải giữ được người xem
3 giây đầu không giữ được → video chết.
- ❌ "Xin chào mọi người…"
- ✔ "99% mọi người đang dùng sai cách này."

### ② Phải có pain point
Không nói lan man, đánh thẳng vào nỗi đau cụ thể. Ví dụ kem nền:
- ❌ "Kem nền rất đẹp."
- ✔ "Đến chiều nền mốc?" / "Da dầu 2 tiếng đã trôi?"

### ③ Kết quả phải nhìn thấy
Đừng chỉ nói — phải **quay**: trước/sau, zoom da, test nước, test mồ hôi. Cho
người xem **thấy** hiệu quả, không kể lể.

### ④ Có so sánh
Người xem rất thích đối chiếu: trái/phải, cũ/mới, dùng/không dùng. Hiệu ứng rõ
hơn nhiều lần.

### ⑤ Quá trình sử dụng phải xuất hiện
Không chỉ "cầm sản phẩm" mà phải quay cả quá trình: mở hộp → bôi → massage →
sau 5 phút → sau 8 tiếng. Thuật toán rất ưu ái dạng nội dung có quá trình.

---

## 3. Review sau khi test

Sau khi test hàng trăm video mà vẫn không viral — **đừng đổ cho "thuật toán bóp"**.
Hãy tự hỏi 4 câu:

1. **Có bỏ sót chi tiết nào không?** ánh sáng, góc máy, biểu cảm, chữ, nhạc.
2. **Khung nội dung đã bị bão hòa chưa?** Một hook từng viral, sau 2 tháng ai cũng
   dùng → hết hiệu quả.
3. **Hình ảnh có bị lặp không?** Nếu video nào cũng đứng nói, nền trắng, một góc
   quay → người xem lướt.
4. **Điểm mạnh thực sự của sản phẩm là gì?** (câu quan trọng nhất)

> **Nguyên tắc cốt lõi:** *Muốn copy thành công thì trước hết phải tăng "điểm cộng",
> đừng tạo "điểm trừ".*
>
> Đừng chỉ copy hook / lời thoại / góc quay. Phải có **điểm mạnh riêng**: sản phẩm
> có lợi thế hơn, người xuất hiện thu hút hơn, hình ảnh đẹp hơn, câu chuyện thật
> hơn, trải nghiệm thực tế hơn. Copy khung + cộng thêm lợi thế riêng = mới thắng.
