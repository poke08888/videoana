// Dịch tên + mô tả phim từ tiếng Trung sang tiếng Việt và tiếng Anh (Gemini).
//
// Dùng lúc nhập phim từ 52api: nguồn trả tên/mô tả tiếng Trung, app không thể hiện chữ Hán
// cho người xem. Lỗi dịch KHÔNG được chặn nhập phim — trả về bản gốc kèm ok=false để web
// vận hành hiện nút "Dịch lại".
const axios = require("axios");

const DEFAULT_MODEL = "gemini-2.5-flash";
const HAN = /[一-鿿㐀-䶿]/;

const clean = (v) => String(v == null ? "" : v).trim();

function stripFence(s) {
  return String(s || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function buildPrompt({ name, description }) {
  return (
    "Bạn là biên tập viên nội dung phim ngắn. Dịch tên phim và phần mô tả sau từ tiếng Trung " +
    "sang tiếng Việt và tiếng Anh.\n" +
    "Tên phim: dịch thoáng cho tự nhiên và hấp dẫn với người xem, giữ đúng thể loại, không phiên âm Hán Việt máy móc.\n" +
    "Mô tả: dịch sát nội dung, không thêm bớt tình tiết, không bình luận.\n" +
    "CHỈ trả về JSON đúng dạng sau, không giải thích:\n" +
    '{"vi":{"name":"","description":""},"en":{"name":"","description":""}}\n\n' +
    `Tên: ${name}\nMô tả: ${description || "(không có)"}`
  );
}

// Gọi Gemini thật. Tách riêng để test tiêm hàm giả, không đụng mạng.
function defaultAsk({ apiKey, model, timeout = 60000 }) {
  return async (prompt) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const r = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } },
      { timeout, headers: { "Content-Type": "application/json" } }
    );
    const parts = ((((r.data || {}).candidates || [])[0] || {}).content || {}).parts || [];
    return parts.map((p) => p.text || "").join("");
  };
}

// Một ngôn ngữ chỉ được coi là dịch xong khi có tên, và tên KHÔNG còn chữ Hán.
// Gemini thỉnh thoảng trả nguyên tên gốc -> coi như chưa dịch, giữ để dịch lại sau.
function takeLang(part, src) {
  const name = clean(part && part.name);
  const description = clean(part && part.description);
  if (!name || HAN.test(name)) return null;
  return { name, description: description && !HAN.test(description) ? description : "" };
}

/**
 * @param {{name:string, description:string}} src  tên/mô tả gốc (tiếng Trung)
 * @param {{apiKey?:string, model?:string, ask?:Function}} opts  ask = hàm gọi model (test tiêm vào)
 * @returns {Promise<{vi:{name,description}, en:{name,description}, ok:boolean, error:string}>}
 */
async function translateSeriesMeta(src, opts = {}) {
  const { apiKey = "", model = DEFAULT_MODEL, ask } = opts;
  const base = { name: clean(src && src.name), description: clean(src && src.description) };
  const fallback = (error) => ({ vi: { ...base }, en: { ...base }, ok: false, error });

  if (!base.name) return fallback("thiếu tên phim");
  const call = ask || (apiKey ? defaultAsk({ apiKey, model }) : null);
  if (!call) return fallback("thiếu geminiApiKey");

  let parsed;
  try {
    parsed = JSON.parse(stripFence(await call(buildPrompt(base))));
  } catch (e) {
    return fallback(`Gemini lỗi: ${e.message}`);
  }

  const vi = takeLang(parsed && parsed.vi, base);
  const en = takeLang(parsed && parsed.en, base);
  if (!vi || !en) return fallback("bản dịch không hợp lệ (thiếu ngôn ngữ hoặc còn chữ Hán)");

  // Mô tả gốc rỗng thì bản dịch rỗng là đúng, không tính là lỗi.
  return {
    vi: { name: vi.name, description: vi.description || (base.description ? base.description : "") },
    en: { name: en.name, description: en.description || (base.description ? base.description : "") },
    ok: true,
    error: "",
  };
}

module.exports = { translateSeriesMeta, buildPrompt, DEFAULT_MODEL };
