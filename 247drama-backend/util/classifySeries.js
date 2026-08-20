// Xếp một phim vào thể loại + gắn thẻ, dựa trên tên và nội dung mô tả.
//
// Máy CHỈ được chọn trong danh sách có sẵn, không được tự nghĩ tên mới: thả tự do thì mỗi
// phim đẻ ra một tên na ná nhau, vài chục phim sau là màn thể loại rối không lọc được gì.
// Xếp hụt thì trả về rỗng để người vận hành chọn tay, KHÔNG đoán bừa một thể loại.
const axios = require("axios");
const { TAGS } = require("./taxonomy");

const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_TAGS = 6;

const clean = (v) => String(v == null ? "" : v).trim();

function stripFence(s) {
  return String(s || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function buildPrompt({ name, description }, categories, tags) {
  const cats = categories.map((c, i) => `${i + 1}. ${c.name}: ${c.hint || ""}`).join("\n");
  return (
    "Bạn là biên tập viên kho phim ngắn. Đọc phim dưới đây rồi xếp vào ĐÚNG MỘT thể loại " +
    "trong danh sách, và gắn 3-6 thẻ mô tả nội dung.\n\n" +
    `THỂ LOẠI (chọn đúng một, chép nguyên tên):\n${cats}\n\n` +
    `THẺ (chỉ chọn trong danh sách này, chép nguyên chữ):\n${tags.join(", ")}\n\n` +
    "Chọn thể loại theo trục chính của câu chuyện, không theo chi tiết phụ. " +
    "Không chắc thì để category rỗng.\n" +
    'CHỈ trả JSON: {"category":"","tags":[""]}\n\n' +
    `Tên phim: ${name}\nNội dung: ${description || "(không có)"}`
  );
}

function defaultAsk({ apiKey, model, timeout = 60000, thinkingBudget = 0 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const read = (r) => {
    const parts = ((((r.data || {}).candidates || [])[0] || {}).content || {}).parts || [];
    return parts.map((p) => p.text || "").join("");
  };
  const send = (generationConfig, prompt) =>
    axios.post(url, { contents: [{ parts: [{ text: prompt }] }], generationConfig }, { timeout, headers: { "Content-Type": "application/json" } });

  return async (prompt) => {
    const gen = { responseMimeType: "application/json" };
    try {
      return read(await send({ ...gen, thinkingConfig: { thinkingBudget } }, prompt));
    } catch (e) {
      if (e && e.response && e.response.status === 400) return read(await send(gen, prompt));
      throw e;
    }
  };
}

/**
 * @param {{name:string, description:string}} src
 * @param {{categories:Array<{name,hint}>, tags?:string[], apiKey?:string, model?:string, ask?:Function}} opts
 * @returns {Promise<{category:string, tags:string[], error:string}>} category rỗng = chưa xếp được
 */
async function classifySeries(src, opts = {}) {
  const { apiKey = "", model = DEFAULT_MODEL, ask } = opts;
  const categories = (opts.categories || []).filter((c) => c && c.name);
  const tags = opts.tags && opts.tags.length ? opts.tags : TAGS;
  const base = { name: clean(src && src.name), description: clean(src && src.description) };
  const fail = (error) => ({ category: "", tags: [], error });

  if (!base.name) return fail("thiếu tên phim");
  if (!categories.length) return fail("chưa có thể loại nào để xếp");
  const call = ask || (apiKey ? defaultAsk({ apiKey, model }) : null);
  if (!call) return fail("thiếu geminiApiKey");

  let parsed;
  try {
    parsed = JSON.parse(stripFence(await call(buildPrompt(base, categories, tags))));
  } catch (e) {
    return fail(`Gemini lỗi: ${e.message}`);
  }

  // Chỉ nhận tên có thật trong danh sách; so sánh không phân biệt hoa thường và khoảng trắng thừa.
  const norm = (s) => clean(s).toLowerCase();
  const catMatch = categories.find((c) => norm(c.name) === norm(parsed && parsed.category));
  const tagSet = new Map(tags.map((t) => [norm(t), t]));
  const picked = [];
  for (const t of Array.isArray(parsed && parsed.tags) ? parsed.tags : []) {
    const hit = tagSet.get(norm(t));
    if (hit && !picked.includes(hit) && picked.length < MAX_TAGS) picked.push(hit);
  }

  return {
    category: catMatch ? catMatch.name : "",
    tags: picked,
    error: catMatch ? "" : `không xếp được thể loại (máy trả "${clean(parsed && parsed.category)}")`,
  };
}

module.exports = { classifySeries, buildPrompt, MAX_TAGS };
