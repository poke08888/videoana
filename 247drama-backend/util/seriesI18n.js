// Trả tên/mô tả phim theo quốc gia người xem: Việt Nam thấy bản tiếng Việt (đã nằm sẵn ở
// name/description), ngoài Việt Nam thấy bản tiếng Anh.
//
// Cách làm: một middleware bọc res.json, đi vào payload và thay tên/mô tả của ĐÚNG những
// phim có bản tiếng Anh. Làm cách này để không phải sửa hơn hai chục endpoint đang trả tên
// phim theo nhiều hình dạng khác nhau (danh sách, nhóm theo thể loại, chi tiết tập...).
// Chỉ đụng vào object có _id trùng id phim đã dịch nên không chạm nhầm tên thể loại, tên
// người dùng hay bất cứ field name nào khác.
const MovieSeries = require("../models/movieSeries.model");
const { resolveSubLang, loadLangTable } = require("./geoLang");

const TTL_MS = 5 * 60 * 1000;
const MAX_DEPTH = 8;

let cache = { at: 0, map: new Map() };

async function defaultFind() {
  return MovieSeries.find({ metaTranslatedAt: { $ne: null } })
    .select("_id i18n nameEn descriptionEn")
    .lean();
}

// Map id phim -> { <mã ngôn ngữ>: {name, description} }. Cache 5 phút: phim mới dịch chậm
// nhất 5 phút là hiện ra, đổi lại mỗi request không phải truy vấn thêm.
async function getTransMap({ now = Date.now(), find = defaultFind, ttl = TTL_MS } = {}) {
  if (cache.at && now - cache.at < ttl) return cache.map;
  const rows = await find();
  const map = new Map();
  for (const r of rows) {
    const byLang = { ...(r.i18n || {}) };
    // Phim dịch từ bản trước (chỉ có nameEn) vẫn dùng được.
    if (!byLang.en && r.nameEn) byLang.en = { name: r.nameEn, description: r.descriptionEn || "" };
    if (Object.keys(byLang).length) map.set(String(r._id), byLang);
  }
  cache = { at: now, map };
  return map;
}

function clearCache() {
  cache = { at: 0, map: new Map() };
}

// Thay tại chỗ. Trả về chính node để dùng được kiểu localizePayload(body, map).
function localizePayload(node, map, lang, depth = 0) {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return node;
  if (Array.isArray(node)) {
    for (const item of node) localizePayload(item, map, lang, depth + 1);
    return node;
  }
  if (node instanceof Date || Buffer.isBuffer(node)) return node;

  const byLang = node._id != null ? map.get(String(node._id)) : null;
  // Đính kèm mọi bản dịch để app tự dựng nút đổi ngôn ngữ, giống cách nó chọn phụ đề. Đội app
  // ngồi ở Việt Nam gọi API chỉ thấy tiếng Việt nên tưởng hệ thống chưa dịch gì.
  if (byLang && typeof node.name === "string") node.i18n = byLang;
  const t = byLang ? byLang[lang] : null;
  if (t && t.name) {
    if (typeof node.name === "string") node.name = t.name;
    if (typeof node.movieSeriesName === "string") node.movieSeriesName = t.name;
    if (t.description) {
      if (typeof node.description === "string") node.description = t.description;
      if (typeof node.movieSeriesDescription === "string") node.movieSeriesDescription = t.description;
    }
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") localizePayload(v, map, lang, depth + 1);
  }
  return node;
}

// Middleware cho router client. Người xem ở Việt Nam đi thẳng, không tốn gì.
function localizeSeriesResponse(opts = {}) {
  const lookup = opts.resolveLang || resolveSubLang;
  const load = opts.getMap || getTransMap;
  const loadTable = opts.loadLangTable || loadLangTable;
  return async (req, res, next) => {
    try {
      // Nạp bảng quốc gia -> ngôn ngữ trước khi tra, vì resolveSubLang là hàm đồng bộ đọc
      // bảng đã cache. Middleware này chạy trước mọi route client nên bảng luôn ấm.
      await loadTable();
      const lang = lookup(req) || "vi";
      const map = await load();
      if (!map || !map.size) return next();
      const sendJson = res.json.bind(res);
      res.json = (body) => {
        const out = localizePayload(body, map, lang);
        // Cho app biết server đã chọn ngôn ngữ nào, giống subDefault của phụ đề.
        if (out && typeof out === "object" && !Array.isArray(out)) out.contentLang = lang;
        return sendJson(out);
      };
    } catch (e) {
      console.error("localizeSeriesResponse lỗi, trả nguyên bản:", e.message);
    }
    return next();
  };
}

module.exports = { getTransMap, clearCache, localizePayload, localizeSeriesResponse, TTL_MS };
