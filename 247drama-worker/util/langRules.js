// Quy tắc từng ngôn ngữ đích: tên gọi để nhắc Gemini, và cách nghiệm thu bản dịch.
//
// Mỗi ngôn ngữ hụt theo một kiểu khác nhau: bản Việt/Anh hụt thì còn nguyên chữ Hán, bản
// Thái hụt thì ra tiếng Anh (Gemini bỏ qua yêu cầu) mà không hề có chữ Hán nào. Vì vậy
// ngoài phép thử "còn chữ Hán không", ngôn ngữ có bảng chữ riêng phải thử thêm "đã đúng
// bảng chữ chưa".
const HAN = /[一-鿿㐀-䶿]/;
const THAI = /[฀-๿]/;

const HAN_LIMIT = 0.05; // quá 5% số dòng còn chữ Hán = dịch hụt
const SCRIPT_MIN = 0.5; // dưới 50% số dòng đúng bảng chữ = model trả sai ngôn ngữ

const LANGS = {
  vi: { name: "tiếng Việt", script: null },
  en: { name: "English", script: null },
  th: { name: "tiếng Thái (ภาษาไทย)", script: THAI },
  id: { name: "tiếng Indonesia (Bahasa Indonesia)", script: null },
  zh: { name: "tiếng Trung", script: null },
};

function langName(code) {
  const l = LANGS[code];
  return l ? l.name : code;
}

function isSupported(code) {
  return Object.prototype.hasOwnProperty.call(LANGS, code);
}

const lines = (segs) => (segs || []).map((s) => String((s && s.text) || "")).filter((t) => t.trim());

function ratio(segs, re) {
  const ls = lines(segs);
  if (!ls.length) return 0;
  return ls.filter((t) => re.test(t)).length / ls.length;
}

/**
 * Nghiệm thu một track: đủ dòng, hết chữ Hán, và đúng bảng chữ của ngôn ngữ đó.
 * @returns {{ok:boolean, reason:string}}
 */
function checkTrack(lang, segs, zhCount) {
  const s = segs || [];
  if (s.length !== zhCount) {
    return { ok: false, reason: `số cue ${lang} (${s.length}) khác số dòng OCR (${zhCount})` };
  }
  const han = ratio(s, HAN);
  if (han >= HAN_LIMIT) {
    return { ok: false, reason: `bản dịch ${lang} hụt: ${Math.round(han * 100)}% số dòng còn chữ Hán` };
  }
  const script = (LANGS[lang] || {}).script;
  if (script) {
    const r = ratio(s, script);
    if (r < SCRIPT_MIN) {
      return { ok: false, reason: `bản dịch ${lang} sai bảng chữ: chỉ ${Math.round(r * 100)}% số dòng đúng chữ ${lang}` };
    }
  }
  return { ok: true, reason: "" };
}

module.exports = { LANGS, langName, isSupported, checkTrack, HAN_LIMIT, SCRIPT_MIN };
