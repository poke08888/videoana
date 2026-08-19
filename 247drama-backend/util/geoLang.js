const geoip = require("geoip-lite");

// IP thật của người xem: nginx set X-Forwarded-For (sites-enabled/default), phần tử ĐẦU
// là client, các phần tử sau là proxy.
function pickClientIp(req) {
  const xff = (req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"])) || "";
  const first = String(xff).split(",")[0].trim();
  const raw = first || req.ip || (req.socket && req.socket.remoteAddress) || "";
  return String(raw).replace(/^::ffff:/, "");
}

// Bảng quốc gia -> ngôn ngữ. Sửa được trong Setting.subtitle.geoLangs mà không cần deploy;
// quốc gia không có trong bảng nhận ngôn ngữ dự phòng (mặc định tiếng Anh).
const DEFAULT_TABLE = { VN: "vi", TH: "th", ID: "id" };
const DEFAULT_FALLBACK = "en";
const HOME_LANG = "vi"; // tra IP hụt -> tiếng Việt vì Việt Nam là thị trường chính

let table = { ...DEFAULT_TABLE };
let fallbackLang = DEFAULT_FALLBACK;
let loadedAt = 0;

// Nạp bảng từ Setting (cache 5 phút). Gọi từ middleware chạy trước mọi route client, nên
// resolveSubLang giữ được dạng đồng bộ — hàng chục controller đang gọi thẳng.
async function loadLangTable({ now = Date.now(), ttl = 5 * 60 * 1000, find } = {}) {
  if (loadedAt && now - loadedAt < ttl) return { table, fallbackLang };
  const load = find || (async () => {
    const Setting = require("../models/setting.model");
    const s = await Setting.findOne({}).select("subtitle").lean();
    return (s && s.subtitle) || {};
  });
  const sub = (await load()) || {};
  const raw = sub.geoLangs && typeof sub.geoLangs === "object" ? sub.geoLangs : null;
  table = raw && Object.keys(raw).length ? normalizeTable(raw) : { ...DEFAULT_TABLE };
  fallbackLang = String(sub.geoFallbackLang || DEFAULT_FALLBACK).toLowerCase();
  loadedAt = now;
  return { table, fallbackLang };
}

function normalizeTable(raw) {
  const out = {};
  for (const [country, lang] of Object.entries(raw)) {
    const c = String(country || "").trim().toUpperCase();
    const l = String(lang || "").trim().toLowerCase();
    if (c && l) out[c] = l;
  }
  return out;
}

function resetLangTable() {
  table = { ...DEFAULT_TABLE };
  fallbackLang = DEFAULT_FALLBACK;
  loadedAt = 0;
}

/**
 * Ngôn ngữ mặc định cho người xem theo quốc gia của IP.
 * @param {object} req
 * @param {Function} lookupFn  chỉ để test tiêm hàm giả
 * @param {object} opts        {table, fallbackLang} để test, mặc định lấy bảng đã nạp
 */
function resolveSubLang(req, lookupFn = geoip.lookup, opts = {}) {
  const tbl = opts.table || table;
  const fb = opts.fallbackLang || fallbackLang;
  try {
    const geo = lookupFn(pickClientIp(req));
    if (!geo || !geo.country) return HOME_LANG;
    return tbl[String(geo.country).toUpperCase()] || fb;
  } catch (e) {
    return HOME_LANG;
  }
}

module.exports = { resolveSubLang, pickClientIp, loadLangTable, resetLangTable, DEFAULT_TABLE };
