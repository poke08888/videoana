// Dịch từ khoá tìm phim sang tiếng Trung.
//
// Cả ba nguồn (hg, hm, dl) đều là kho phim Trung Quốc, chỉ đánh chỉ mục theo tên tiếng Trung.
// Người vận hành gõ "chiến thần" thì bỏ dấu thành "chienthan" cũng chỉ khớp bừa vào phim
// chẳng liên quan. Dịch sang 战神 mới ra đúng thứ cần tìm.
//
// Từ khoá vốn đã có chữ Hán thì giữ nguyên, khỏi tốn một lượt gọi model.
const axios = require("axios");

const CHINESE = /[㐀-鿿]/;
const CACHE_MAX = 500;
const cache = new Map(); // từ khoá thường -> tiếng Trung

function defaultAsk({ apiKey, model, timeout = 20000 }) {
  return async (prompt) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const r = await axios.post(
      url,
      {
        contents: [{ parts: [{ text: prompt }] }],
        // Tắt phần "suy nghĩ": dịch vài chữ mà bật thì mất mấy chục giây cho một ô tìm kiếm.
        generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
      },
      { timeout, headers: { "Content-Type": "application/json" } }
    );
    const parts = ((((r.data || {}).candidates || [])[0] || {}).content || {}).parts || [];
    return parts.map((p) => p.text || "").join("");
  };
}

/**
 * @returns {Promise<{keyword:string, translated:boolean}>} dịch hụt -> trả lại từ khoá gốc
 */
async function toChineseKeyword(raw, opts = {}) {
  const kw = String(raw == null ? "" : raw).trim();
  if (!kw) return { keyword: "", translated: false };
  if (CHINESE.test(kw)) return { keyword: kw, translated: false };

  const key = kw.toLowerCase();
  if (cache.has(key)) return { keyword: cache.get(key), translated: true };

  const { apiKey = "", model = "gemini-2.5-flash", ask } = opts;
  const call = ask || (apiKey ? defaultAsk({ apiKey, model }) : null);
  if (!call) return { keyword: kw, translated: false };

  try {
    const out = await call(
      "Dịch cụm từ tìm kiếm phim ngắn sau sang tiếng Trung giản thể, dùng đúng cách người " +
        "Trung Quốc gọi thể loại/mô-típ đó. CHỈ trả về mấy chữ Hán, không giải thích, không phiên âm.\n\n" +
        kw
    );
    // Model hay trả kèm dấu câu, ngoặc, xuống dòng -> chỉ giữ lại chữ Hán và chữ số.
    const zh = String(out || "").replace(/[^㐀-鿿0-9]/g, "");
    if (!zh) return { keyword: kw, translated: false };
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, zh);
    return { keyword: zh, translated: true };
  } catch (e) {
    console.error("dịch từ khoá lỗi, tìm bằng từ gốc:", e.message);
    return { keyword: kw, translated: false };
  }
}

module.exports = { toChineseKeyword, _cache: cache };
