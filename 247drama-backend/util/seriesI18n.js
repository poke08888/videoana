// Trả tên/mô tả phim theo quốc gia người xem: Việt Nam thấy bản tiếng Việt (đã nằm sẵn ở
// name/description), ngoài Việt Nam thấy bản tiếng Anh.
//
// Cách làm: một middleware bọc res.json, đi vào payload và thay tên/mô tả của ĐÚNG những
// phim có bản tiếng Anh. Làm cách này để không phải sửa hơn hai chục endpoint đang trả tên
// phim theo nhiều hình dạng khác nhau (danh sách, nhóm theo thể loại, chi tiết tập...).
// Chỉ đụng vào object có _id trùng id phim đã dịch nên không chạm nhầm tên thể loại, tên
// người dùng hay bất cứ field name nào khác.
const MovieSeries = require("../models/movieSeries.model");
const { resolveSubLang } = require("./geoLang");

const TTL_MS = 5 * 60 * 1000;
const MAX_DEPTH = 8;

let cache = { at: 0, map: new Map() };

async function defaultFind() {
  return MovieSeries.find({ nameEn: { $nin: ["", null] } })
    .select("_id nameEn descriptionEn")
    .lean();
}

// Map id phim -> bản tiếng Anh. Cache 5 phút: phim mới dịch chậm nhất 5 phút là hiện ra,
// đổi lại mỗi request không phải truy vấn thêm.
async function getEnMap({ now = Date.now(), find = defaultFind, ttl = TTL_MS } = {}) {
  if (now - cache.at < ttl) return cache.map;
  const rows = await find();
  const map = new Map();
  for (const r of rows) map.set(String(r._id), { name: r.nameEn || "", description: r.descriptionEn || "" });
  cache = { at: now, map };
  return map;
}

function clearCache() {
  cache = { at: 0, map: new Map() };
}

// Thay tại chỗ. Trả về chính node để dùng được kiểu localizePayload(body, map).
function localizePayload(node, map, depth = 0) {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return node;
  if (Array.isArray(node)) {
    for (const item of node) localizePayload(item, map, depth + 1);
    return node;
  }
  if (node instanceof Date || Buffer.isBuffer(node)) return node;

  const en = node._id != null ? map.get(String(node._id)) : null;
  if (en && en.name) {
    if (typeof node.name === "string") node.name = en.name;
    if (typeof node.movieSeriesName === "string") node.movieSeriesName = en.name;
    if (en.description) {
      if (typeof node.description === "string") node.description = en.description;
      if (typeof node.movieSeriesDescription === "string") node.movieSeriesDescription = en.description;
    }
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") localizePayload(v, map, depth + 1);
  }
  return node;
}

// Middleware cho router client. Người xem ở Việt Nam đi thẳng, không tốn gì.
function localizeSeriesResponse(opts = {}) {
  const lookup = opts.resolveLang || resolveSubLang;
  const load = opts.getMap || getEnMap;
  return async (req, res, next) => {
    try {
      if (lookup(req) !== "en") return next();
      const map = await load();
      if (!map || !map.size) return next();
      const sendJson = res.json.bind(res);
      res.json = (body) => sendJson(localizePayload(body, map));
    } catch (e) {
      console.error("localizeSeriesResponse lỗi, trả nguyên bản:", e.message);
    }
    return next();
  };
}

module.exports = { getEnMap, clearCache, localizePayload, localizeSeriesResponse, TTL_MS };
