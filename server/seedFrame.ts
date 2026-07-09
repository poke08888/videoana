/**
 * server/seedFrame.ts — KHUNG HẠT GIỐNG: bản đồ content từ điểm mạnh sản phẩm.
 *
 * Đúc từ skill `khung-hat-giong`: biến các nhóm điểm mạnh sản phẩm thành bản đồ
 * content hoàn chỉnh 5 khối để chạy content-testing kiểu Douyin trên TikTok Shop:
 *   ① Bản đồ điểm mạnh thực tế → hướng nội dung (mỗi nhóm 3 mô tả + 5-6 hướng)
 *   ② Thời điểm/bối cảnh có nhu cầu theo TỪNG điểm mạnh (mỗi nhóm 1 bảng 4 cột × 6 dòng)
 *   ③ Tình huống oái oăm/nghịch lý → 8 concept kịch bản over (2 nhóm × 4)
 *   ④ Đối chuẩn theo từng điểm mạnh (5 hướng × 3 ngôn ngữ VI/EN/中文)
 *   ⑤ Kế hoạch test 4 vòng / 1 tháng
 *
 * Kết quả được sinh THEO TỪNG PHẦN (part) — client gọi song song nhiều phần
 * nhỏ thay vì 1 request khổng lồ, phần nào lỗi thì thử lại riêng phần đó.
 */

export interface SeedFrameForm {
  ten: string;          // tên sản phẩm
  nganh: string;        // ngành hàng
  usp: string[];        // các nhóm điểm mạnh (2-6 nhóm)
  khach?: string;       // khách hàng mục tiêu
  pain?: string;        // pain point chính
  trangThai: "moi" | "cu"; // sản phẩm mới / đang bán
}

export type SeedFramePart =
  | "directions"  // khối ① — cần strength (1 nhóm điểm mạnh)
  | "persona"     // khối ② — cần strength (mỗi điểm mạnh một bảng bối cảnh riêng)
  | "conceptsA"   // khối ③ nhóm A (đời thường đẩy nghịch lý)
  | "conceptsB"   // khối ③ nhóm B (dàn dựng viral)
  | "doichuanA"   // khối ④ hướng ①②③ — cần strength
  | "doichuanB"   // khối ④ hướng ④⑤ — cần strength
  | "bench";      // khối ⑤

export const SEED_FRAME_PARTS: SeedFramePart[] = [
  "directions", "persona", "conceptsA", "conceptsB", "doichuanA", "doichuanB", "bench",
];

/** 7 loại content chuẩn của khối ① (theo skill). */
const LOAI_LIST = [
  "Chứng minh / Demo trực quan",
  "So sánh đối chứng",
  "Trải nghiệm thật / Blind test",
  "Thử thách & Trend hoá",
  "Storytelling tình huống đời thực",
  "Giáo dục / giải thích cơ chế",
  "Hướng dẫn sử dụng đa dụng",
];

const SEED_A = "Nhóm tình huống: đời thường bị đẩy thành nghịch lý (văn phòng, tình cảm, bạn bè, gia đình, sự kiện trọng đại).";
const SEED_B = "Nhóm tình huống: dàn dựng viral (thử nghiệm xã hội, camera giấu kín, cuộc thi/bảng xếp hạng, động vật, nghịch lý sản phẩm đối thủ).";

// 5 hướng đối chuẩn — tách 2 nửa để mỗi lượt Gemini trả JSON ngắn, ít bị cắt.
const CACH_A = [
  "① Đối thủ cùng loại: sản phẩm cùng danh mục có cùng claim/điểm mạnh này",
  "② Công dụng tương tự: sản phẩm KHÁC loại nhưng cùng công dụng/hiệu quả với riêng điểm mạnh này (kể cả khác ngành)",
  "③ Cùng nhóm khách hàng: nội dung/sản phẩm mà nhóm khách mục tiêu hay xem, để mượn khung",
];
const CACH_B = [
  "④ Kết quả cuối cùng tương tự: sản phẩm/giải pháp bất kỳ cho cùng kết quả cuối với điểm mạnh này",
  "⑤ Viral chéo ngành: khung viral ngành khác có thể ghép điểm mạnh này vào",
];

/** Chuẩn hóa form từ request — cắt gọn, giới hạn 6 nhóm điểm mạnh. */
export function normalizeSeedForm(raw: any): SeedFrameForm | null {
  const ten = String(raw?.ten || "").trim().slice(0, 200);
  const usp = (Array.isArray(raw?.usp) ? raw.usp : [])
    .map((s: any) => String(s || "").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 6);
  if (!ten || usp.length === 0) return null;
  return {
    ten,
    nganh: String(raw?.nganh || "").trim().slice(0, 200),
    usp,
    khach: String(raw?.khach || "").trim().slice(0, 300),
    pain: String(raw?.pain || "").trim().slice(0, 300),
    trangThai: raw?.trangThai === "cu" ? "cu" : "moi",
  };
}

function infoBlock(f: SeedFrameForm): string {
  return `
Sản phẩm: ${f.ten}
Ngành hàng: ${f.nganh || "chưa rõ, tự suy luận từ sản phẩm"}
Các nhóm điểm mạnh:
${f.usp.map((u, i) => `${i + 1}. ${u}`).join("\n")}
Khách hàng mục tiêu: ${f.khach || "chưa rõ, tự suy luận từ sản phẩm"}
Pain point chính: ${f.pain || "tự suy luận từ sản phẩm và khách hàng"}
Trạng thái: sản phẩm ${f.trangThai === "moi" ? "MỚI (chưa có dữ liệu bán)" : "ĐANG BÁN (đã có dữ liệu bán)"}
Thị trường: Việt Nam, kênh TikTok Shop.`;
}

// Yêu cầu chất lượng chung (bước 3 của skill) — nhắc trong mọi prompt sinh nội dung.
const QUALITY = `
YÊU CẦU CHẤT LƯỢNG (bắt buộc):
- Câu chữ phải THỰC TẾ, ĐỜI THƯỜNG, DỄ HIỂU — viết như người thật nhắn tin cho bạn, nói thẳng vào lợi ích/tình huống cụ thể. TUYỆT ĐỐI KHÔNG dùng từ hoa mỹ, văn vẻ, sáo rỗng — CẤM các từ kiểu: "nâng tầm", "đẳng cấp", "tuyệt tác", "chinh phục", "trải nghiệm đỉnh cao", "bùng nổ", "lan tỏa", "bừng tỏa", "tỏa sáng", "ngất ngây", "quyến rũ", "đánh thức", "khơi dậy", "khẳng định phong cách", "thơm ngất", "thơm lừng".
- Mọi hook/thông điệp phải CỰC ĐOAN về ý (tuyên bố mạnh, cụ thể, không mờ nhạt, không an toàn) nhưng bằng TỪ NGỮ ĐỜI THƯỜNG và KIỂM CHỨNG ĐƯỢC — ví dụ tốt: "Tập 2 tiếng, áo vẫn khô, người vẫn thơm", "Đứng cạnh crush sau trận bóng vẫn tự tin"; ví dụ tệ: "Hương thơm bùng nổ lan tỏa", "Khơi dậy nguồn năng lượng bất tận". Không chào hỏi, không nêu thương hiệu ở hook.
- Mọi hướng content phải TRỰC QUAN HÓA được: nêu rõ quay gì, đo/chứng minh bằng công cụ gì, người xem thấy gì (máy đo, camera nhiệt, áo trắng before/after, phản ứng người lạ...).
- Không viết chung chung kiểu "quay video demo sản phẩm cho khách xem hiệu quả".
- Toàn bộ bằng TIẾNG VIỆT (trừ từ khóa EN/中文 khi được yêu cầu).`;

function promptDirections(f: SeedFrameForm, strength: string): string {
  return `Bạn là chuyên gia content commerce TikTok/Douyin thị trường Việt Nam, đang lập BẢN ĐỒ ĐIỂM MẠNH THỰC TẾ → HƯỚNG NỘI DUNG.
${infoBlock(f)}

Tập trung vào MỘT nhóm điểm mạnh này: "${strength}"

Trả về:
- mo_ta: mảng ĐÚNG 3 mô tả thực tế cụ thể của điểm mạnh, mỗi câu dưới 18 từ, phủ 3 góc: (1) cơ chế/thành phần/công nghệ là gì, (2) hiệu quả cụ thể — có con số nếu suy luận được (giờ, %, lần), (3) khác biệt gì so với sản phẩm thường
- huong: mảng 5-6 hướng content khai thác, quét qua các loại: ${LOAI_LIST.join("; ")}. Chỉ bỏ loại nào thật sự không áp dụng. Mỗi hướng gồm {loai: đúng tên một loại ở trên, mo_ta: MỘT câu 20-30 từ mô tả CHI TIẾT như brief cho team quay — quay cảnh gì, đo/chứng minh bằng công cụ gì, người xem thấy gì, twist gì}
${QUALITY}

Trả về DUY NHẤT JSON minified (không xuống dòng thừa), không markdown:
{"mo_ta":["..."],"huong":[{"loai":"...","mo_ta":"..."}]}`;
}

function promptPersona(f: SeedFrameForm, strength: string): string {
  return `Bạn là chuyên gia content commerce TikTok/Douyin thị trường Việt Nam, đang lập bảng THỜI ĐIỂM / BỐI CẢNH CÓ NHU CẦU cho MỘT điểm mạnh sản phẩm.
${infoBlock(f)}

Tập trung vào MỘT nhóm điểm mạnh này: "${strength}"

Lập ĐÚNG 6 dòng, mỗi dòng là một thời điểm/bối cảnh có nhu cầu KHÁC NHAU mà RIÊNG điểm mạnh này phát huy rõ nhất — chọn 6 nhóm bối cảnh phù hợp nhất trong 7 nhóm chuẩn (điều chỉnh theo ngành hàng): vận động/thể thao · công việc/văn phòng · xã giao/hẹn hò/phỏng vấn · ngoài trời/di chuyển · giải trí/tiệc tùng · mùa vụ/thời tiết · thói quen chăm sóc cá nhân. Mỗi dòng gồm:
- boi_canh: thời điểm/bối cảnh có nhu cầu, cụ thể càng đời càng tốt (dưới 12 từ)
- ai: ai tạo ra nhu cầu (dưới 10 từ)
- noi_dau: nỗi đau thật GẮN TRỰC TIẾP với điểm mạnh này, không phải nỗi đau chung chung của sản phẩm (dưới 16 từ)
- thong_diep: cách đưa điểm mạnh này vào content ở đúng bối cảnh đó — MỘT câu thông điệp sắc dưới 15 từ, không phải mô tả tính năng (kiểu "1 lần lăn tối nay, yên tâm cả ngày mai")

Lưu ý: bảng này chỉ dành riêng cho điểm mạnh trên — bối cảnh phải là "sân khấu" riêng nơi điểm mạnh này tỏa sáng, không lẫn với các điểm mạnh khác của sản phẩm.
${QUALITY}

Trả về DUY NHẤT JSON minified, không markdown:
{"rows":[{"boi_canh":"...","ai":"...","noi_dau":"...","thong_diep":"..."}]}`;
}

function promptConcepts(f: SeedFrameForm, seed: string): string {
  return `Bạn là chuyên gia content commerce TikTok/Douyin thị trường Việt Nam, đang lập bảng TÌNH HUỐNG OÁI OĂM / NGHỊCH LÝ → CONCEPT KỊCH BẢN OVER QUẢNG CÁO.
${infoBlock(f)}

${seed}
Lập ĐÚNG 4 tình huống, mỗi tình huống gồm:
- boi_canh: tình huống oái oăm/nghịch lý cụ thể, càng đời càng tốt (dưới 18 từ; kiểu "Tắm xong 5 phút, ngồi máy lạnh 16 độ vẫn ướt áo như vừa đi mưa")
- ai: ai tạo ra nhu cầu (dưới 8 từ)
- noi_dau: nỗi đau thật đã kịch tính hoá (dưới 15 từ)
- diem_manh: điểm mạnh sản phẩm nhấn mạnh (dưới 10 từ)
- concept_ten: tên concept ngắn dưới 6 từ, kiểu "Phiên toà bạn thân", "Người máy lỗi cảm biến"
- concept_mo_ta: MỘT câu 25-35 từ có đủ 3 nhịp: dựng cảnh gì → diễn biến/twist gì → kết bằng gì. Bắt buộc có twist và cái kết, không chỉ là tình huống.
${QUALITY}

Trả về DUY NHẤT JSON minified, không markdown:
{"rows":[{"boi_canh":"...","ai":"...","noi_dau":"...","diem_manh":"...","concept_ten":"...","concept_mo_ta":"..."}]}`;
}

function promptDoiChuan(f: SeedFrameForm, strength: string, labels: string[]): string {
  return `Bạn là chuyên gia nghiên cứu đối chuẩn content commerce trên TikTok Việt Nam, TikTok global và Douyin Trung Quốc.
${infoBlock(f)}

Tập trung vào MỘT nhóm điểm mạnh này: "${strength}"

Lập bộ đối chuẩn CHI TIẾT áp RIÊNG cho điểm mạnh này (không phải cho cả sản phẩm chung chung) theo đúng ${labels.length} hướng sau:
${labels.join("\n")}

Mỗi hướng gồm:
- cach: đúng tên hướng (chỉ phần tên trước dấu hai chấm, giữ số ①-⑤)
- goi_y: MỘT câu dưới 18 từ — nên soi cụ thể sản phẩm/ngành/dạng content nào cho điểm mạnh này
- vi: mảng đúng 5 từ khóa tiếng Việt kiểu người dùng thật gõ trên TikTok search / Kalodata (cụm 2-5 từ, có thể kèm hashtag)
- en: mảng đúng 5 từ khóa tiếng Anh ĐÚNG THUẬT NGỮ CHUYÊN NGÀNH (công nghệ/thành phần/claim; kiểu: oil control primer, sebum control, mattifying) — không dịch word-by-word
- zh: mảng đúng 5 từ khóa tiếng Trung giản thể ĐÚNG THUẬT NGỮ ngành trên Douyin/Chanmama (kiểu: 止汗露, 香氛微胶囊, 留香)

Ràng buộc cứng: từ khóa các hướng phải KHÁC NHAU rõ rệt — bám đúng bản chất từng hướng; hướng ③ ra từ khóa hành vi/nội dung nhóm khách xem, KHÔNG lặp từ khóa sản phẩm của hướng ①.

Trả về DUY NHẤT JSON minified, không markdown, không giải thích:
{"cach_list":[{"cach":"...","goi_y":"...","vi":["..."],"en":["..."],"zh":["..."]}]}`;
}

function promptBench(f: SeedFrameForm): string {
  return `Bạn là chuyên gia content commerce TikTok/Douyin thị trường Việt Nam.
${infoBlock(f)}

Lập kế hoạch test 4 VÒNG trong 1 tháng (mỗi vòng = 1 tuần, mỗi khung 15-20 video/tuần) theo khung chuẩn:
- Vòng 1: test hook/khung rộng → lọc theo giữ chân 3 giây đầu + CTR
- Vòng 2: nhân biến thể khung thắng → lọc theo CTR + CVR giỏ hàng
- Vòng 3: tối ưu conversion (gắn giỏ, CTA, giá) → lọc theo CR + ROI
- Vòng 4: chốt công thức thắng, chuẩn bị phóng lượng → GMV/video, tỷ lệ video đạt chuẩn
Dùng benchmark beauty/personal care làm mặc định (CTR 2-5%, CR 1.5-3.5%, giữ chân 3s là chỉ số cửa ngõ), tự điều chỉnh theo ngành hàng của sản phẩm.

Mỗi vòng gồm: ten (dưới 5 từ), muc_tieu (1 câu dưới 15 từ), tieu_chi (tiêu chí đạt/loại CÓ CON SỐ, dưới 15 từ).

Trả về DUY NHẤT JSON minified, không markdown:
{"ke_hoach_test":[{"ten":"...","muc_tieu":"...","tieu_chi":"..."}]}`;
}

/** Dựng prompt cho 1 phần của khung hạt giống. `strength` bắt buộc với directions/doichuan*. */
export function buildSeedFramePrompt(part: SeedFramePart, form: SeedFrameForm, strength?: string): string {
  switch (part) {
    case "directions":
      return promptDirections(form, strength || form.usp[0]);
    case "persona":
      return promptPersona(form, strength || form.usp[0]);
    case "conceptsA":
      return promptConcepts(form, SEED_A);
    case "conceptsB":
      return promptConcepts(form, SEED_B);
    case "doichuanA":
      return promptDoiChuan(form, strength || form.usp[0], CACH_A);
    case "doichuanB":
      return promptDoiChuan(form, strength || form.usp[0], CACH_B);
    case "bench":
      return promptBench(form);
  }
}

/** Kiểm tra nhẹ kết quả Gemini có đúng khung dữ liệu của phần đó không. */
export function isValidSeedPart(part: SeedFramePart, data: any): boolean {
  if (!data || typeof data !== "object") return false;
  switch (part) {
    case "directions":
      return Array.isArray(data.mo_ta) && Array.isArray(data.huong) && data.huong.length > 0;
    case "persona":
      return Array.isArray(data.rows) && data.rows.length > 0;
    case "conceptsA":
    case "conceptsB":
      return Array.isArray(data.rows) && data.rows.length > 0;
    case "doichuanA":
    case "doichuanB":
      return Array.isArray(data.cach_list) && data.cach_list.length > 0;
    case "bench":
      return Array.isArray(data.ke_hoach_test) && data.ke_hoach_test.length > 0;
  }
}

/** Nguyên tắc vận hành đính kèm cuối output (đúng theo skill). */
export const SEED_FRAME_PRINCIPLES = {
  nhip: "3–5 khung hạt giống/tuần · 15–20 video/khung · 4 vòng test trong 1 tháng · lướt và lưu ≥200 video đối chuẩn/ngày · chỉ mượn khung, luôn tự tạo \"điểm cộng\" riêng, không copy nguyên.",
  moi: "SP mới: booking test ~10% GMV kỳ vọng; ads chia ~50/50 awareness/conversion; KOC chiếm 70–80% tầng awareness để test painpoint.",
  cu: "SP đang bán: booking test ~3% GMV kỳ vọng; 80–90% ads dồn tầng conversion có gắn giỏ.",
};
