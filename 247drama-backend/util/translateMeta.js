// Dịch tên + mô tả phim từ tiếng Trung sang nhiều ngôn ngữ (Gemini).
//
// Dùng lúc nhập phim từ 52api: nguồn trả tên/mô tả tiếng Trung, app không thể hiện chữ Hán
// cho người xem. Lỗi dịch KHÔNG được chặn nhập phim — trả về phần dịch được kèm danh sách
// ngôn ngữ còn thiếu để web vận hành hiện nút "Dịch lại".
const axios = require("axios");

const DEFAULT_MODEL = "gemini-2.5-flash";
const HAN = /[一-鿿㐀-䶿]/;

// Ngôn ngữ có bảng chữ riêng: bản dịch hụt kiểu "trả về tiếng Anh" không lộ chữ Hán nào,
// nên phải kiểm thêm đúng bảng chữ.
const LANGS = {
  vi: { name: "tiếng Việt", script: null },
  en: { name: "English", script: null },
  th: { name: "tiếng Thái (ภาษาไทย)", script: /[฀-๿]/ },
  id: { name: "tiếng Indonesia (Bahasa Indonesia)", script: null },
};

const clean = (v) => String(v == null ? "" : v).trim();
const langName = (c) => (LANGS[c] ? LANGS[c].name : c);
const isSupported = (c) => Object.prototype.hasOwnProperty.call(LANGS, c);

function stripFence(s) {
  return String(s || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function buildPrompt({ name, description }, langs) {
  const shape = langs.map((l) => `"${l}":{"name":"","description":""}`).join(",");
  const list = langs.map((l) => langName(l)).join(", ");
  return (
    "Bạn là biên tập viên nội dung phim ngắn. Dịch tên phim và phần mô tả sau (nguồn có thể là " +
    "tiếng Trung hoặc tiếng Việt) sang các thứ tiếng: " + `${list}.\n` +
    "Ngôn ngữ nào trùng với ngôn ngữ gốc thì chép lại cho tự nhiên, không dịch vòng.\n" +
    "Tên phim: dịch thoáng cho tự nhiên và hấp dẫn với người xem bản ngữ, giữ đúng thể loại, " +
    "không phiên âm máy móc.\n" +
    "Mô tả: dịch sát nội dung, không thêm bớt tình tiết, không bình luận.\n" +
    `CHỈ trả về JSON đúng dạng sau, không giải thích:\n{${shape}}\n\n` +
    `Tên: ${name}\nMô tả: ${description || "(không có)"}`
  );
}

// thinkingBudget=0 tắt phần "suy nghĩ" của gemini-2.5-flash. Đo trên chính prompt này:
// bật thì tốn ~6000 token nghĩ và mất 35 giây, tắt thì 5 giây mà bản dịch vẫn đạt.
// Model nào không nhận tham số này (lỗi 400) thì gọi lại không kèm.
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
      if (e && e.response && e.response.status === 400) {
        console.warn("ops translateMeta: model không nhận thinkingConfig, gọi lại không kèm");
        return read(await send(gen, prompt));
      }
      throw e;
    }
  };
}

// Một ngôn ngữ chỉ được nhận khi có tên, không còn chữ Hán, và đúng bảng chữ của nó.
function takeLang(lang, part) {
  const name = clean(part && part.name);
  const description = clean(part && part.description);
  if (!name || HAN.test(name)) return null;
  const script = (LANGS[lang] || {}).script;
  if (script && !script.test(name)) return null;
  const okDesc = description && !HAN.test(description) && (!script || script.test(description));
  return { name, description: okDesc ? description : "" };
}

/**
 * @param {{name:string, description:string}} src  tên/mô tả gốc (tiếng Trung)
 * @param {{apiKey?:string, model?:string, langs?:string[], ask?:Function}} opts
 * @returns {Promise<{i18n:object, ok:boolean, missing:string[], error:string}>}
 *   i18n = { vi: {name, description}, en: {...} } — chỉ chứa ngôn ngữ dịch đạt.
 */
async function translateSeriesMeta(src, opts = {}) {
  const { apiKey = "", model = DEFAULT_MODEL, ask } = opts;
  const wanted = (Array.isArray(opts.langs) && opts.langs.length ? opts.langs : ["vi", "en"])
    .map((l) => String(l || "").trim().toLowerCase())
    .filter((l, i, a) => l && isSupported(l) && a.indexOf(l) === i);

  const base = { name: clean(src && src.name), description: clean(src && src.description) };
  const fail = (error) => ({ i18n: {}, ok: false, missing: wanted, error });

  if (!wanted.length) return { i18n: {}, ok: false, missing: [], error: "chưa chọn ngôn ngữ nào" };
  if (!base.name) return fail("thiếu tên phim");
  const call = ask || (apiKey ? defaultAsk({ apiKey, model }) : null);
  if (!call) return fail("thiếu geminiApiKey");

  let parsed;
  try {
    parsed = JSON.parse(stripFence(await call(buildPrompt(base, wanted))));
  } catch (e) {
    return fail(`Gemini lỗi: ${e.message}`);
  }

  const i18n = {};
  const missing = [];
  for (const lang of wanted) {
    const got = takeLang(lang, parsed && parsed[lang]);
    if (got) i18n[lang] = { name: got.name, description: got.description || base.description };
    else missing.push(lang);
  }
  return {
    i18n,
    ok: missing.length === 0,
    missing,
    error: missing.length ? `chưa dịch được: ${missing.join(", ")}` : "",
  };
}

module.exports = { translateSeriesMeta, buildPrompt, langName, isSupported, DEFAULT_MODEL };
