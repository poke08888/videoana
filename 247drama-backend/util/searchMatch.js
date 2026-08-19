// Điều kiện tìm phim theo MỌI ngôn ngữ đã dịch.
//
// Trước đây chỉ khớp name/description (bản tiếng Việt), nên người xem Thái gõ tên phim tiếng
// Thái đang hiện trên máy họ thì không ra kết quả nào. Tìm luôn trong i18n của từng ngôn ngữ,
// và cả tên gốc tiếng Trung để người vận hành tra được bằng tên nguồn.
const LANGS = ["vi", "en", "th", "id"];
const BASE_FIELDS = ["name", "description", "nameEn", "descriptionEn", "nameOriginal", "descriptionOriginal"];

// Người dùng gõ gì cũng được coi là chữ, không phải cú pháp regex: "(" hay "*" trước đây làm
// truy vấn nổ hoặc quét nặng bất thường.
function escapeRegex(s) {
  return String(s == null ? "" : s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} query từ khoá người dùng nhập
 * @param {string[]} langs danh sách ngôn ngữ có bản dịch
 * @returns {object[]} mảng điều kiện để đặt vào $or; rỗng nếu từ khoá rỗng
 */
function seriesSearchOr(query, langs = LANGS) {
  const q = String(query == null ? "" : query).trim();
  if (!q) return [];
  const rx = { $regex: escapeRegex(q), $options: "i" };
  const fields = [...BASE_FIELDS];
  for (const l of langs) {
    const code = String(l || "").trim().toLowerCase();
    if (code) fields.push(`i18n.${code}.name`, `i18n.${code}.description`);
  }
  return fields.map((f) => ({ [f]: rx }));
}

module.exports = { seriesSearchOr, escapeRegex, LANGS };
