#!/usr/bin/env python3
"""
nonelab-video — analyze_video.py

Upload một video bán hàng (MP4 nội bộ hoặc link YouTube) lên Gemini, lấy transcript
đầy đủ và trả về "Phiếu mổ xẻ video" theo đúng khung sản xuất nội dung bùng nổ của
Nonelab (Douyin / TikTok Shop).

Cách dùng:
    python analyze_video.py /đường/dẫn/video.mp4
    python analyze_video.py "https://www.youtube.com/watch?v=VIDEO_ID"
    python analyze_video.py /đường/dẫn/video.mp4 --output /tmp/mo-xe.md

Yêu cầu:
    pip install google-genai --break-system-packages
    GEMINI_API_KEY trong .env ở repo root
"""

import argparse
import os
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Đọc API key từ .env
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    """Đi ngược từ script lên để tìm .env ở repo root."""
    script_dir = Path(__file__).resolve().parent
    search = script_dir
    for _ in range(6):
        env_path = search / ".env"
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("GEMINI_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        search = search.parent
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        print("LỖI: không tìm thấy GEMINI_API_KEY trong .env hoặc biến môi trường.", file=sys.stderr)
        sys.exit(1)
    return key


# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------

def get_client():
    try:
        import google.genai as genai  # noqa: F401
    except ImportError:
        print("LỖI: chưa cài google-genai. Chạy: pip install google-genai --break-system-packages", file=sys.stderr)
        sys.exit(1)
    return genai.Client(api_key=load_api_key())


# ---------------------------------------------------------------------------
# Upload video + chờ xử lý
# ---------------------------------------------------------------------------

def upload_video(client, file_path: str):
    """Upload file video nội bộ lên Gemini Files API và chờ trạng thái ACTIVE."""
    print(f"Đang upload video: {file_path}", file=sys.stderr)
    video_file = client.files.upload(
        file=file_path,
        config={"mime_type": "video/mp4"}
    )
    print(f"Upload xong: {video_file.name} — đang chờ xử lý...", file=sys.stderr)

    max_wait = 120
    waited = 0
    while video_file.state.name == "PROCESSING":
        if waited >= max_wait:
            print("LỖI: xử lý video quá 120 giây.", file=sys.stderr)
            sys.exit(1)
        time.sleep(5)
        waited += 5
        video_file = client.files.get(name=video_file.name)
        print(f"  Vẫn đang xử lý... ({waited}s)", file=sys.stderr)

    if video_file.state.name != "ACTIVE":
        print(f"LỖI: video rơi vào trạng thái lạ: {video_file.state.name}", file=sys.stderr)
        sys.exit(1)

    print(f"Video sẵn sàng: {video_file.uri}", file=sys.stderr)
    return video_file


# ---------------------------------------------------------------------------
# Prompt mổ xẻ — theo khung Nonelab
# ---------------------------------------------------------------------------

ANALYSIS_PROMPT = """
Bạn đang mổ xẻ một video bán hàng short-form (TikTok Shop / Douyin / Reel / Short).
Trả về một "PHIẾU MỔ XẺ VIDEO" bằng TIẾNG VIỆT, giọng trực tiếp thực chiến, theo
đúng khung sản xuất nội dung bùng nổ của Douyin/TikTok Shop dưới đây. Cụ thể, chi
tiết — quan sát chung chung là vô dụng. Trích nguyên văn lời thoại khi cần.

Mục tiêu: không phải để copy nguyên, mà để THÁO video ra thành công thức tái dùng
được, rồi lắp sản phẩm khác vào.

---

## 1. TRANSCRIPT ĐẦY ĐỦ
Transcript nguyên văn kèm timestamp. Định dạng:
**[HH:MM:SS – HH:MM:SS]** > lời thoại
Ghi chú thêm: [OVERLAY: "chữ trên màn hình"], [NHẠC: mô tả], [CẮT CẢNH: mô tả].

---

## 2. BÓC TÁCH KHUNG TỔNG
Video dựng theo bố cục nào: Mở đầu ra sao → Giữa nói gì → Kết thúc thế nào.

---

## 3. STORYBOARD CHI TIẾT — MA TRẬN ĐỦ/CẦN THEO TỪNG PHÂN CẢNH
Tách video thành TOÀN BỘ phân cảnh (không chỉ 3). Đánh số + timestamp mỗi phân cảnh.
Với MỖI phân cảnh, lập bảng 6 chiều, 2 cột:
- **ĐỦ** = video mẫu CÓ gì (mô tả chính xác chiều đó).
- **CẦN** = để tái hiện thì CẦN chuẩn bị gì (đạo cụ/người/thiết bị/set-up cụ thể).

Định dạng cho mỗi phân cảnh:
### Phân cảnh N — [mm:ss–mm:ss] "tên cảnh"
| Chiều | ĐỦ (video mẫu có) | CẦN (chuẩn bị để quay) |
|-------|-------------------|------------------------|
| Hành động (ACTION) | chủ thể làm gì, cử chỉ, thao tác, biểu cảm | |
| Bối cảnh (SETTING) | quay ở đâu, nền, ánh sáng, props | |
| Âm thanh (SOUND) | voiceover/thoại/nhạc/SFX/tiếng động thật, có bắt nhịp? | |
| Góc máy (CAMERA) | **PHẢI ĐỦ 5 LỚP theo chuẩn quốc tế** (xem dưới) | thiết bị/cách đặt máy & di chuyển |
| Trang phục (WARDROBE) | outfit, makeup, tóc, tông màu | |
| Diễn viên (CAST) | ai xuất hiện, "danh tính/nhân vật" (nội trợ/dân VP/chuyên gia/sinh viên…), số người | |

**CHIỀU GÓC MÁY — BẮT BUỘC mô tả 5 lớp theo CHUẨN QUỐC TẾ (StudioBinder),
TUYỆT ĐỐI không viết "quay cận". Dùng đúng viết tắt tiếng Anh:**
- (A) **Cỡ cảnh (Shot Size):** ECU (Extreme Close-Up) · CU (Close-Up) ·
  MCU (Medium Close-Up) · MS (Medium Shot) · CS (Cowboy Shot, giữa đùi lên) ·
  MFS (Medium Full Shot, ngang gối lên) · FS (Full Shot, trọn người) ·
  [rộng hơn: WS / EWS cho establishing].
- (B) **Tầm máy (Camera Level — máy đặt CAO/THẤP ngang đâu):** Overhead (chĩa xuống
  90°) · Eye Level · Shoulder Level · Hip Level · Knee Level · Ground Level.
- (C) **Góc nghiêng (Camera Angle — máy ngóc/cúi):** eye-level (thẳng) · high angle
  (chếch xuống) · low angle (hất lên) · Dutch (nghiêng lệch) · OTS (qua vai) ·
  POV (ngôi thứ nhất).
- (D) **Chuyển động (lia thế nào):** tĩnh · lia ngang (pan) · lia dọc (tilt) ·
  đẩy-vào (push-in/zoom-in) · kéo-ra (pull-out) · bám theo (tracking) · cầm tay
  (handheld) · quay vòng (arc/orbit) · whip pan · snap zoom.
- (E) **Ống kính & nhịp:** xóa phông (shallow DOF) · nét sâu · macro · góc rộng ·
  tele/nén phông · slow-mo · timelapse · một mạch (一镜到底) · cắt nhanh.
- LƯU Ý phân biệt B vs C: *Tầm máy* = độ cao đặt máy; *Góc nghiêng* = máy ngóc lên/
  cúi xuống. Vd "Ground Level + low angle" = máy sát đất hất lên.
- Ví dụ ĐẠT: "ECU giọt serum, tầm Overhead, góc thẳng 90°, đẩy-vào chậm rồi lia dọc
  rê theo vệt serum, macro slow-mo, xóa phông sâu."
- Ví dụ KHÔNG ĐẠT (cấm): "quay cận sản phẩm."

Gợi ý nhanh "quay cận thì lia thế nào" theo loại cảnh (Cỡ cảnh / Tầm máy / Góc / Chuyển động / Ống kính):
- Khoe kết cấu (kem/serum/bọt): ECU / Overhead / thẳng 90° / đẩy-vào chậm hoặc lia dọc / macro + slow-mo.
- Kết quả trên mặt (da/môi): CU–MCU / Eye Level / thẳng hơi high / tĩnh hoặc đẩy-vào rất chậm / xóa phông.
- Trước/Sau: CU cùng khung / cùng tầm / cùng góc / tĩnh / cùng ánh sáng.
- Thao tác bôi/massage: CU→MCU / Eye–Shoulder / ngang hoặc OTS / bám theo tay (handheld nhẹ).
- Đổ/pha/test nước: MS→CU / Overhead / thẳng 90° / tĩnh + slow-mo khoảnh khắc rơi.
- Khoe outfit/toàn thân: FS→MFS / Hip–Knee / low angle nhẹ / tĩnh hoặc arc / tele.
- CTA dẫn mua: MCU/MS / Eye Level / ngang / tĩnh, tay chỉ xuống góc giỏ hàng / nét sâu.

## 3B. BA CẢNH THEN CHỐT (đánh dấu trong storyboard ở trên)
- **Cảnh mở đầu gây tò mò:** [phân cảnh số mấy] — hút người dừng lại, không lướt.
- **Cảnh tạo chuyển đổi:** [phân cảnh số mấy] — khiến người tin & muốn mua (vd trước/sau).
- **Cảnh dẫn mua hàng:** [phân cảnh số mấy] — chỉ vào giỏ hàng / thúc chốt đơn.

---

## 4. BÓC TÁCH LỜI THOẠI
Họ dẫn dắt câu chữ theo trình tự nào (nỗi đau → điểm bán → lợi ích?).

---

## 5. CHECKLIST HIỆU QUẢ
Chấm mỗi tiêu chí: Đạt / Một phần / Thiếu, kèm 1 câu giải thích.
| Tiêu chí | Mức | Ghi chú |
|----------|-----|---------|
| 3 giây đầu giữ người | | |
| Pain point cụ thể (không lan man) | | |
| Kết quả nhìn thấy (có QUAY ra, không nói suông) | | |
| Có so sánh (trái/phải, cũ/mới, dùng/không) | | |
| Quá trình sử dụng xuất hiện (mở hộp→bôi→sau X giờ) | | |
| Cảnh tạo chuyển đổi đủ mạnh | | |
| CTA / dẫn mua rõ ràng | | |

---

## 6. HOOK — PHÂN TÍCH 3 GIÂY ĐẦU
- **Câu hook nguyên văn:** trích chính xác câu đầu.
- **Kiểu hook:** mâu thuẫn / con số + bối cảnh bất ngờ / gọi thẳng người xem /
  nói hộ suy nghĩ thầm / reframe phi lý / pattern interrupt.
- **Viewer-first hay creator-first?** Hook nói về tình huống của người xem, hay
  khoe thành tích của người làm?
- **Điểm hook (1–10)** + vì sao.

---

## 7. CHẤM THEO CÔNG THỨC BÙNG NỔ
Công thức: **Mở đầu gây tò mò mạnh + Điểm đau/điểm bán có hình ảnh chứng minh = bùng nổ.**
- **Phần 1 — Mở đầu bùng nổ:** [Mạnh/Trung bình/Yếu] + vì sao.
- **Phần 2 — Điểm đau/điểm bán "nhìn thấy được":** [Mạnh/TB/Yếu] + vì sao.
- **Kết luận:** video dễ/khó bùng nổ & ra đơn vì… (NHỚ: thiếu một trong hai phần là hỏng;
  hook hay mà cảnh chuyển đổi dở thì vẫn không bán được).

---

## 8. CÔNG THỨC TÁI DÙNG (rút ra để lắp sản phẩm khác)
- **Công thức cấu trúc hình ảnh:** Mở đầu + Nội dung + Sản phẩm + Chốt — điền cụ thể
  từng khối dựa trên video này.
- **Công thức cấu trúc lời thoại:** Nỗi đau/nhu cầu → Điểm bán → Lợi ích cốt lõi —
  điền cụ thể.

---

## 9. NẠP KHO
- **Kho lời thoại (文案库):** liệt kê 3–6 câu/đoạn thoại đắt nên lưu để tái dùng.
- **Kho hình ảnh (画面库):** liệt kê 3–6 cảnh quay đắt nên lưu để tái dùng.

---

## 10. ĐỐI CHUẨN & GÓC QUAY MỚI
- Khung video này thuộc cách đối chuẩn nào: cùng loại / công dụng tương tự / cùng
  nhóm khách hàng / kết quả cuối tương tự / chéo ngành? Vì sao.
- Đề xuất 5–8 góc quay mới đẻ ra từ khung này (mỗi góc 1 dòng: bối cảnh + điểm bán
  thể hiện). Đây là nguyên liệu để nhân thành nhiều video từ 1 khung.

---

## 11. ĐIỂM "STEAL" — copy được ngay
Liệt kê 3–5 thủ pháp cụ thể nên copy thẳng vào hệ thống nội dung của mình. Chính xác:
**Thủ pháp:** [đặt tên] — **Xuất hiện tại:** [timestamp + trích] — **Vì sao ăn:**
[cơ chế tâm lý/cấu trúc] — **Cách áp dụng:** [1 câu lệnh cụ thể].
Nhắc nguyên tắc: tăng "điểm cộng", đừng tạo "điểm trừ" — phải có lợi thế riêng, không chỉ copy.
"""


# ---------------------------------------------------------------------------
# Chạy phân tích
# ---------------------------------------------------------------------------

def run_analysis(client, video_source: str) -> str:
    from google.genai import types  # noqa

    is_youtube = video_source.startswith("http://") or video_source.startswith("https://")

    if is_youtube:
        print(f"Dùng link YouTube: {video_source}", file=sys.stderr)
        contents = [
            types.Part.from_uri(file_uri=video_source, mime_type="video/mp4"),
            types.Part.from_text(text=ANALYSIS_PROMPT),
        ]
    else:
        video_file = upload_video(client, video_source)
        contents = [
            types.Part.from_uri(file_uri=video_file.uri, mime_type="video/mp4"),
            types.Part.from_text(text=ANALYSIS_PROMPT),
        ]

    print("Đang phân tích (20–60 giây)...", file=sys.stderr)

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=contents,
    )
    return response.text


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Mổ xẻ một video bán hàng short-form theo khung Nonelab."
    )
    parser.add_argument("video", help="Đường dẫn file MP4, hoặc link YouTube (public).")
    parser.add_argument("--output", help="Tùy chọn: lưu phiếu mổ xẻ ra file Markdown.", default=None)
    args = parser.parse_args()

    video_input = args.video
    is_url = video_input.startswith("http://") or video_input.startswith("https://")
    if not is_url:
        if not Path(video_input).exists():
            print(f"LỖI: không thấy file: {video_input}", file=sys.stderr)
            sys.exit(1)
        if not video_input.lower().endswith(".mp4"):
            print("CẢNH BÁO: file không có đuôi .mp4. Vẫn thử tiếp.", file=sys.stderr)

    client = get_client()
    result = run_analysis(client, video_input)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            f.write(result)
        print(f"\nĐã lưu phiếu mổ xẻ: {output_path}", file=sys.stderr)
    else:
        print(result)


if __name__ == "__main__":
    main()
