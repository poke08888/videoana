const geoip = require("geoip-lite");

// IP thật của người xem: nginx set X-Forwarded-For (sites-enabled/default), phần tử ĐẦU
// là client, các phần tử sau là proxy.
function pickClientIp(req) {
  const xff = (req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"])) || "";
  const first = String(xff).split(",")[0].trim();
  const raw = first || req.ip || (req.socket && req.socket.remoteAddress) || "";
  return String(raw).replace(/^::ffff:/, "");
}

/**
 * Ngôn ngữ phụ đề mặc định theo quốc gia: VN -> vi, còn lại -> en.
 * Tra hụt (IP nội bộ, dải lạ) -> vi vì Việt Nam là thị trường chính.
 * lookupFn chỉ để test tiêm hàm giả.
 */
function resolveSubLang(req, lookupFn = geoip.lookup) {
  try {
    const geo = lookupFn(pickClientIp(req));
    if (!geo || !geo.country) return "vi";
    return geo.country === "VN" ? "vi" : "en";
  } catch (e) {
    return "vi";
  }
}

module.exports = { resolveSubLang, pickClientIp };
