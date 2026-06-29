/**
 * nonelabPrompt.ts
 *
 * Toàn bộ KIẾN THỨC của skill `nonelab-video` được đúc vào prompt phân tích.
 * Nguồn: server/knowledge/nonelab-video/{SKILL.md, scripts/analyze_video.py,
 * references/*.md}. Prompt giữ nguyên khung "mổ xẻ" của Nonelab nhưng yêu cầu
 * Gemini trả về JSON đúng schema để render ra "Phiếu mổ xẻ" trên web.
 *
 * Khác với prototype gốc (suy luận từ mô tả), backend này UPLOAD video thật lên
 * Gemini để model XEM video — đúng như script gốc của skill.
 */

export interface AnalyzeForm {
  title?: string;
  platform?: string;
  product?: string;
  genre?: string;
  notes?: string;
}

/** Mô tả schema JSON cho model — khớp với cấu trúc report của frontend. */
const JSON_SCHEMA_HINT = `
Trả về DUY NHẤT một object JSON hợp lệ (không kèm markdown, không \`\`\`), theo schema:

{
  "subtitle": "1 câu tóm tắt video (sản phẩm — chủ đề)",
  "meta": {
    "platform": "nền tảng", "duration": "ví dụ '46 giây · dọc 9:16'",
    "genre": "thể loại", "product": "tên sản phẩm",
    "face": "mô tả gương mặt/nhân vật", "cta": "câu/hành động CTA chính"
  },
  "verdict": [   // ĐÚNG 4 mục — vì sao video chạy
    { "label": "tên trục ngắn", "big": "2-3 từ chốt", "note": "1 câu giải thích" }
  ],
  "hook": {
    "quote": "trích nguyên văn câu hook 3 giây đầu",
    "type": "mâu thuẫn | con số+bối cảnh bất ngờ | gọi thẳng người xem | nói hộ suy nghĩ thầm | reframe phi lý | pattern interrupt",
    "viewerFirst": true,   // true=viewer-first, false=creator-first
    "score": 8,            // 1-10
    "note": "vì sao hook ăn / chưa ăn"
  },
  "acts": [   // 3-5 màn, mỗi màn 1-3 phân cảnh (beat)
    {
      "range": "0:00–0:08", "title": "tên màn", "summary": "tóm tắt diễn biến màn",
      "beats": [
        {
          "ts": "0:02",
          "vi": "hành động chính trong cảnh (1 câu)",
          "voiceover": "VOICE-OFF/LỜI THOẠI nguyên văn nói trong cảnh này — chép ĐÚNG TỪNG CHỮ tiếng Việt theo audio (cả thuyết minh lẫn thoại on-screen). Nếu cảnh không có lời thì để chuỗi rỗng ''.",
          "note": "vì sao cảnh này hiệu quả",
          "size": "Cỡ cảnh — dùng ĐÚNG viết tắt: ECU/CU/MCU/MS/CS/MFS/FS/WS",
          "angle": "Tầm máy + Góc nghiêng (vd 'Eye Level · góc thẳng' hoặc 'Ground Level · low angle')",
          "move": "Chuyển động máy (tĩnh/đẩy-vào/lia dọc/bám theo/whip pan/snap zoom...)",
          "action": "ACTION — chủ thể làm gì, cử chỉ, biểu cảm",
          "setting": "SETTING — quay ở đâu, nền, ánh sáng, props",
          "sound": "SOUND — VO/thoại/nhạc/SFX/foley, có bắt nhịp?",
          "wardrobe": "WARDROBE — outfit, makeup, tóc, tông màu",
          "cast": "CAST — ai xuất hiện, 'nhân vật/danh tính', số người"
        }
      ]
    }
  ],
  "checklist": [   // ĐÚNG 7 mục theo thứ tự dưới
    { "crit": "① 3s đầu giữ người", "level": "ok|mid|low", "note": "1 câu" },
    { "crit": "② Pain point cụ thể", "level": "ok|mid|low", "note": "" },
    { "crit": "③ Kết quả nhìn thấy", "level": "ok|mid|low", "note": "" },
    { "crit": "④ Có so sánh", "level": "ok|mid|low", "note": "" },
    { "crit": "⑤ Quá trình sử dụng", "level": "ok|mid|low", "note": "" },
    { "crit": "⑥ Cảnh chuyển đổi mạnh", "level": "ok|mid|low", "note": "" },
    { "crit": "⑦ CTA rõ ràng", "level": "ok|mid|low", "note": "" }
  ],
  "formulaVisual": "Công thức cấu trúc hình ảnh, dùng mũi tên → : [Mở đầu] ... → [Nội dung] ... → [Sản phẩm] ... → [Chốt] ...",
  "formulaScript": "Công thức cấu trúc lời thoại, dùng mũi tên → : Nỗi đau/nhu cầu → Điểm bán → Lợi ích cốt lõi → CTA",
  "verdictText": "2-4 câu chấm theo CÔNG THỨC BÙNG NỔ (Mở đầu bùng nổ + Điểm bán nhìn thấy được). Nhớ: thiếu một phần là hỏng.",
  "quotes": ["5-6 câu thoại đắt cần lưu vào kho lời thoại (文案库)"],
  "visuals": ["5-6 cảnh quay đắt cần lưu vào kho hình ảnh (画面库)"],
  "objchuan": { "type": "cùng loại | công dụng tương tự | cùng khách hàng | kết quả tương tự | chéo ngành", "note": "vì sao" },
  "newAngles": ["5-8 góc quay mới đẻ ra từ khung này cho sản phẩm Nonelab (mỗi góc: bối cảnh + điểm bán)"],
  "steals": [   // 3-5 thủ pháp copy được ngay
    { "thuphap": "tên thủ pháp", "at": "timestamp + trích", "why": "cơ chế tâm lý/cấu trúc", "how": "1 câu lệnh áp dụng" }
  ]
}
`.trim();

/** Khung kiến thức Nonelab — rút gọn nhưng đủ để model chấm đúng tiêu chí. */
const NONELAB_FRAMEWORK = `
Bạn là chuyên gia "mổ xẻ" video bán hàng short-form theo hệ thống sản xuất nội dung
bùng nổ của NONELAB (đúc từ thương mại giải trí Douyin / TikTok Shop). Giọng tiếng
Việt trực tiếp, thực chiến. Mục tiêu KHÔNG phải copy nguyên, mà THÁO video thành công
thức tái dùng để lắp sản phẩm Nonelab vào.

CÔNG THỨC BÙNG NỔ (xương sống khi chấm):
  [Mở đầu gây tò mò thật mạnh] + [Điểm đau/điểm bán có HÌNH ẢNH chứng minh rõ ràng]
  = video dễ bùng nổ & dễ ra đơn.
  CẢNH BÁO: thiếu một trong hai phần là hỏng — hook hay mà cảnh chuyển đổi dở thì vẫn
  không bán được hàng.

CHECKLIST HIỆU QUẢ (chấm Đạt=ok / Một phần=mid / Thiếu=low):
  ① 3s đầu giữ người  ② Pain point cụ thể (không lan man)
  ③ Kết quả NHÌN THẤY (có QUAY ra, không nói suông)  ④ Có so sánh (trái/phải, cũ/mới, dùng/không)
  ⑤ Quá trình sử dụng (mở hộp→bôi→sau X giờ)  ⑥ Cảnh tạo chuyển đổi đủ mạnh  ⑦ CTA/dẫn mua rõ ràng

STORYBOARD — MA TRẬN 6 CHIỀU theo TỪNG phân cảnh: Hành động (ACTION), Bối cảnh (SETTING),
Âm thanh (SOUND), Góc máy (CAMERA), Trang phục (WARDROBE), Diễn viên (CAST). Tách video
thành TOÀN BỘ phân cảnh có ý nghĩa, đánh timestamp.

CHIỀU GÓC MÁY — BẮT BUỘC theo CHUẨN QUỐC TẾ (StudioBinder), TUYỆT ĐỐI không viết "quay cận".
Mỗi cảnh đủ 5 lớp:
  (A) Cỡ cảnh: ECU·CU·MCU·MS·CS·MFS·FS·WS/EWS
  (B) Tầm máy (độ cao đặt máy): Overhead·Eye·Shoulder·Hip·Knee·Ground Level
  (C) Góc nghiêng: eye-level·high·low·Dutch·OTS·POV
  (D) Chuyển động: tĩnh·pan·tilt·đẩy-vào·kéo-ra·tracking·handheld·arc·whip pan·snap zoom
  (E) Ống kính/nhịp: xóa phông·nét sâu·macro·góc rộng·tele·slow-mo·timelapse·một mạch·cắt nhanh
  Ví dụ ĐẠT: "ECU giọt serum, tầm Overhead, góc thẳng 90°, đẩy-vào chậm rồi lia dọc, macro slow-mo, xóa phông sâu."
  -> Trường "size" = (A); "angle" = (B)+(C); "move" = (D); nhồi (E) vào "move" hoặc "note".

HOOK — phân loại: mâu thuẫn / con số+bối cảnh bất ngờ / gọi thẳng người xem /
nói hộ suy nghĩ thầm / reframe phi lý / pattern interrupt. Viewer-first (nói về tình
huống người xem) thắng creator-first (khoe thành tích người làm).

ĐỐI CHUẨN (对标) — 5 cách: ① cùng loại/cạnh tranh ② công dụng tương tự ③ cùng nhóm
khách hàng ④ kết quả cuối tương tự ⑤ khung viral chéo ngành.

CÔNG THỨC TÁI DÙNG: (hình ảnh) Mở đầu + Nội dung + Sản phẩm + Chốt; (lời thoại)
Nỗi đau/nhu cầu → Điểm bán → Lợi ích cốt lõi.

NGUYÊN TẮC VÀNG: tăng "điểm cộng", đừng tạo "điểm trừ" — copy khung + cộng lợi thế
riêng (sản phẩm tốt hơn, người thu hút hơn, hình đẹp hơn, câu chuyện thật hơn) mới thắng.
`.trim();

export function buildAnalysisPrompt(form: AnalyzeForm, hasVideo: boolean): string {
  const ctx = [
    form.title && `Tiêu đề: ${form.title}`,
    form.platform && `Nền tảng: ${form.platform}`,
    form.product && `Sản phẩm cần lắp khung: ${form.product}`,
    form.genre && `Thể loại: ${form.genre}`,
    form.notes && `Ghi chú/Mô tả từ người dùng: ${form.notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const source = hasVideo
    ? "Bạn ĐƯỢC xem video đính kèm — hãy QUAN SÁT trực tiếp khung hình, lời thoại, nhịp dựng. Trích timestamp & lời thoại nguyên văn khi cần."
    : "Không có video — hãy suy luận hợp lý từ thông tin mô tả bên dưới (mô tả càng chi tiết kết quả càng sát).";

  return `${NONELAB_FRAMEWORK}

${source}

THÔNG TIN VIDEO:
${ctx || "(người dùng không cung cấp thêm thông tin)"}

YÊU CẦU ĐẦU RA:
- Cụ thể, chi tiết — quan sát chung chung là vô dụng.
- Điền ĐÚNG góc máy theo chuẩn quốc tế ở từng beat.
- BẮT BUỘC chép VOICE-OFF/LỜI THOẠI nguyên văn ("voiceover") cho TỪNG beat: nghe kỹ
  audio và transcribe đúng từng chữ tiếng Việt phần thuyết minh + thoại trong cảnh đó
  (kèm theo timestamp của beat). Không tóm tắt, không diễn giải lại — chép nguyên văn.
  Cảnh nào không có lời nói thì để "voiceover": "".
- "checklist" phải đủ 7 mục đúng thứ tự, "level" chỉ nhận "ok" | "mid" | "low".
- "verdict" đúng 4 mục.

${JSON_SCHEMA_HINT}`;
}

export const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
