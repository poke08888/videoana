# Bước 0 — Bench engine video trên ảnh thật

Mục đích: quyết định engine mặc định (nháp/chốt) bằng ảnh sản phẩm THẬT của mình,
không dựa vào bảng xếp hạng trên mạng. Ngân sách ~$5.
1. Chuẩn bị 1 ảnh sản phẩm (gà rán / hũ mẹt đốt) + 1 ảnh bối cảnh, mặt trước, đủ sáng.
2. `npx tsx scripts/studio-bench.ts --product ga.jpg --background ban.jpg --prompt "<mô tả cảnh tay tương tác>" --runs 2 --out ./data/bench`
3. Mở kling.ai → Image to Video → tải `data/bench/keyframe.png`, dán CÙNG prompt, 8s, 9:16, chạy 2 lượt, lưu về `data/bench/kling-3.0-pro_runN.mp4`.
4. Chấm `data/bench/scores.md` (4 tiêu chí × 1–5).
5. Ghi kết luận vào cuối `scores.md`; nếu Kling thắng ở "chuyển động tự nhiên" ≥ 2 điểm và không thua ở "chữ bao bì", ghi phiếu bật adapter Kling (GĐ sau). Đặt `STUDIO_VIDEO_MODEL_DRAFT/FINAL` trong `.env` theo kết quả.
