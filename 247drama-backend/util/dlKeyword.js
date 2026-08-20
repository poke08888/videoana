// Chuẩn hoá từ khoá cho nguồn 东梨 (dl).
//
// API này từ chối (trả "error") mọi từ khoá có DẤU CÁCH hoặc có ký tự ngoài ASCII/tiếng Trung.
// Người vận hành gõ "chiến thần" là hỏng ngay, dù cũng từ đó bỏ dấu và bỏ cách thì ra kết quả.
// Vì vậy bỏ dấu tiếng Việt và bỏ khoảng trắng trước khi gọi, thay vì trả lỗi khó hiểu.
const CHINESE = /[㐀-鿿]/;

function normalizeDlKeyword(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  // Có chữ Hán -> giữ nguyên chữ, chỉ bỏ khoảng trắng (API cấm dấu cách).
  if (CHINESE.test(s)) return s.replace(/\s+/g, "");
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu thanh và dấu mũ
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, "")
    .replace(/[^\x20-\x7e]/g, ""); // còn ký tự lạ nào thì bỏ nốt
}

module.exports = { normalizeDlKeyword };
