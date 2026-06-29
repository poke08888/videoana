# Nonelab Studio

Hệ thống **mổ xẻ video bùng nổ** cho TikTok Shop / Douyin — tải video lên, **Gemini
xem trực tiếp video** và trả ra "Phiếu mổ xẻ" theo đúng khung sản xuất nội dung của
Nonelab (storyboard 6 chiều, góc máy chuẩn quốc tế, checklist 7 điểm, công thức bùng
nổ, kho lời thoại/hình ảnh, đối chuẩn & góc quay mới), rồi **xuất ra file HTML độc lập**.

Thiết kế (React + Vite + TypeScript) dựng lại pixel-perfect từ bản mock `Nonelab Studio.dc.html`.
Backend (Express) kết nối thật tới **Google Gemini API** và mang **toàn bộ kiến thức của
skill `nonelab-video`** vào phần phân tích.

---

## Chạy thử (local)

```bash
# 1. Cài đặt
npm install

# 2. Đặt API key Gemini (lấy tại https://aistudio.google.com/apikey)
cp .env.example .env
#   rồi điền GEMINI_API_KEY=...      (hoặc nhập key trong màn Quản trị của app)

# 3. Chạy frontend (Vite :5173) + backend (Express :8787) cùng lúc
npm run dev
```

Mở http://localhost:5173 → đăng nhập bằng tài khoản admin mặc định
(`k@nerman.asia`). Mật khẩu khởi tạo: đặt `ADMIN_INIT_PASSWORD` trong `.env`,
hoặc để trống thì backend tự sinh ngẫu nhiên và **in ra console** khi chạy lần
đầu. Hệ thống **buộc đổi mật khẩu** ngay ở lần đăng nhập đầu tiên.

> Không có key vẫn xem được toàn bộ giao diện: khi gọi phân tích mà chưa có key /
> Gemini lỗi, app tự dùng **dữ liệu mẫu CIMEE** và báo rõ.

### Build production

```bash
npm run build      # build frontend ra dist/
npm start          # Express phục vụ cả dist/ lẫn API ở :8787 (NODE_ENV=production)
```

---

## Luồng phân tích (đúng theo skill `nonelab-video`)

1. Người dùng kéo-thả **file .mp4** (hoặc dán **link YouTube công khai**) + nhập tiêu
   đề / sản phẩm / nền tảng / mô tả.
2. Frontend gửi `POST /api/analyze` (multipart) kèm API key (nếu nhập ở Quản trị).
3. Backend **upload video lên Gemini Files API**, chờ trạng thái `ACTIVE`, rồi
   `generateContent([video, prompt])` với model `gemini-3-flash-preview`.
4. Prompt yêu cầu Gemini trả về **JSON** đúng schema "Phiếu mổ xẻ"; frontend render ra
   giao diện và cho **xuất HTML**.

Gemini **thật sự xem video** (không chỉ suy luận từ mô tả) — đúng như script gốc
`scripts/analyze_video.py` của skill.

### Kết nối Gemini

- Vào **Quản trị → Tích hợp AI · Google Gemini**, dán API key, chọn model, bấm **Kết nối**
  (gọi `POST /api/gemini/test` xác thực key thật). Key lưu trên trình duyệt và gửi kèm
  mỗi lần phân tích.
- Hoặc đặt `GEMINI_API_KEY` trong `.env` (backend dùng làm fallback).

---

## Kiến thức Nonelab nằm ở đâu

| Nơi | Nội dung |
|-----|----------|
| `server/nonelabPrompt.ts` | Khung mổ xẻ Nonelab đúc thành prompt + schema JSON cho Gemini |
| `server/knowledge/nonelab-video/` | **Bản gốc của skill** (SKILL.md, references/*, scripts/analyze_video.py, assets/*) — nguồn chân lý |
| `src/data/sampleAnalysis.ts` | Dữ liệu mẫu CIMEE (fallback + seed lịch sử) |
| `src/lib/reportHtml.ts` | Bộ tạo file HTML phiếu mổ xẻ độc lập |

Prompt bám sát: storyboard **ma trận 6 chiều** (Hành động/Bối cảnh/Âm thanh/Góc máy/
Trang phục/Diễn viên), **góc máy chuẩn StudioBinder** (Cỡ cảnh + Tầm máy + Góc nghiêng
+ Chuyển động + Ống kính), **checklist 7 điểm** (Đạt/Một phần/Yếu), **công thức bùng nổ**
(Mở đầu + Điểm bán nhìn thấy được — thiếu một là hỏng), **hook** (kiểu + viewer/creator-first),
**đối chuẩn 5 cách**, và **điểm "steal"**.

---

## Cấu trúc

```
index.html, vite.config.ts, tsconfig.json
src/                     # Frontend (React + TS)
  App.tsx                #   toàn bộ màn hình + state (port 1:1 từ design)
  lib/                   #   csx (css→style), analysis, reportHtml, api
  data/sampleAnalysis.ts
  types.ts, styles.css
server/                  # Backend (Express + @google/genai)
  index.ts               #   /api/analyze, /api/gemini/test, /api/health
  gemini.ts              #   upload video + gọi Gemini
  nonelabPrompt.ts       #   prompt khung Nonelab → JSON
  knowledge/nonelab-video/  # bản gốc skill
project/                 # Bản mock thiết kế gốc (Nonelab Studio.dc.html) — tham chiếu
```

---

## Ghi chú

- Khung hình storyboard trên web dùng placeholder (không trích frame thật từ video).
- Skill này **không tự tải** video TikTok/Instagram — tải tay rồi tải file lên, hoặc
  dùng link YouTube công khai.
- Model mặc định `gemini-3-flash-preview`; đổi trong màn Quản trị hoặc `GEMINI_MODEL`.
