const axios = require("axios");
const HOST = "https://generativelanguage.googleapis.com/v1beta/models";

// Dàn giọng Việt (giọng Bắc cho đồng nhất) đã có trong tài khoản ElevenLabs.
// Nhiều giọng/nhóm -> nhân vật khác nhau cùng nhóm vẫn ra giọng khác nhau.
const VOICE_POOL = {
  male: {
    young: ["Tr84Gom1NKJwoYZT55td", "XBDAUT8ybuJTTCoOLSUj"], // Thế Minh, Đức
    middle: ["ywBZEqUhld86Jeajq94o", "3VnrjnYrskPMDsapTr8X"], // Anh, Tung Dang
    old: ["3VnrjnYrskPMDsapTr8X", "ywBZEqUhld86Jeajq94o"], // Tung Dang (trầm), Anh
  },
  female: {
    young: ["Dl80n1cw0TNTNuDzT8yo"], // Ngoc Tuyet (expressive)
    middle: ["t4D0JquCowxAJSt5S6b1"], // Hoa
    old: ["t4D0JquCowxAJSt5S6b1"], // Hoa
  },
};

const EMOTIONS = ["neutral", "happy", "excited", "sad", "crying", "angry", "shouting", "nervous", "scared", "pleading", "sarcastic", "whispers"];

// Cảm xúc -> voice_settings (multilingual_v2). stability thấp = biến thiên/kịch tính hơn;
// style cao = nhấn nhá mạnh hơn.
function settingsFor(emotion) {
  const m = {
    neutral: { stability: 0.5, style: 0.0 },
    happy: { stability: 0.4, style: 0.35 },
    excited: { stability: 0.32, style: 0.5 },
    sad: { stability: 0.45, style: 0.3 },
    crying: { stability: 0.35, style: 0.45 },
    angry: { stability: 0.28, style: 0.55 },
    shouting: { stability: 0.22, style: 0.65 },
    nervous: { stability: 0.4, style: 0.4 },
    scared: { stability: 0.35, style: 0.5 },
    pleading: { stability: 0.42, style: 0.35 },
    sarcastic: { stability: 0.4, style: 0.45 },
    whispers: { stability: 0.6, style: 0.1 },
  };
  return m[emotion] || m.neutral;
}

// Gemini đọc CẢ MẠCH hội thoại -> mỗi câu: nhân vật nào nói + giới + tuổi + cảm xúc.
async function analyze(segs, { apiKey, model = "gemini-2.5-flash" }) {
  if (!apiKey) throw new Error("thiếu Gemini key");
  const lines = segs.map((s, i) => `${i + 1}. ${s.text}`).join("\n");
  const prompt =
    `Bạn là đạo diễn lồng tiếng phim ngắn Trung Quốc (rể nghèo/tu tiên, nhiều kịch tính, thoại nhanh).\n` +
    `Dưới đây là các câu thoại tiếng Việt THEO THỨ TỰ thời gian. Hãy suy luận theo mạch truyện:\n` +
    `- MỖI câu do NHÂN VẬT nào nói (đặt id ngắn không dấu, nhất quán cả phim: vd nam_chinh, su_phu, vo, con_gai, me, nguoi_dan). Câu dẫn chuyện/độc thoại -> nguoi_dan.\n` +
    `- Giới của nhân vật đó: male | female.\n` +
    `- Tuổi: young | middle | old.\n` +
    `- Cảm xúc câu đó: ${EMOTIONS.join(", ")}.\n` +
    `Trả về JSON array ĐÚNG ${segs.length} phần tử, giữ nguyên thứ tự, mỗi phần tử: ` +
    `{"char":"...","gender":"male|female","age":"young|middle|old","emotion":"..."}. Không thêm gì khác.\n\n${lines}`;
  const { data } = await axios.post(
    `${HOST}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } },
    { timeout: 120000, headers: { "Content-Type": "application/json" } },
  );
  let raw = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.length !== segs.length) throw new Error(`casting trả ${arr ? arr.length : "?"} != ${segs.length} dòng`);
  return arr.map((x) => ({
    char: String(x.char || "nguoi_dan").toLowerCase().replace(/[^a-z0-9_]/g, "") || "nguoi_dan",
    gender: x.gender === "female" ? "female" : "male",
    age: ["young", "middle", "old"].includes(x.age) ? x.age : "middle",
    emotion: EMOTIONS.includes(x.emotion) ? x.emotion : "neutral",
  }));
}

// Gán 1 giọng cố định cho mỗi nhân vật (ổn định cả phim). Nhân vật cùng nhóm giới+tuổi
// mà khác nhau -> lấy giọng khác trong nhóm (xoay vòng), tránh trùng khi còn giọng trống.
function assignVoices(perLine, pool = VOICE_POOL) {
  const charInfo = {}; // char -> {gender, age, count}
  for (const p of perLine) {
    const c = (charInfo[p.char] ||= { gender: p.gender, age: p.age, count: 0 });
    c.count++;
  }
  const usedInBucket = {}; // "gender.age" -> số giọng đã cấp
  const map = {}; // char -> voiceId
  // cấp giọng cho nhân vật nhiều thoại trước (nhân vật chính lấy giọng đầu nhóm)
  const chars = Object.keys(charInfo).sort((a, b) => charInfo[b].count - charInfo[a].count);
  for (const ch of chars) {
    const { gender, age } = charInfo[ch];
    const bucket = (pool[gender] && pool[gender][age]) || pool.male.middle;
    const key = `${gender}.${age}`;
    const n = usedInBucket[key] || 0;
    map[ch] = bucket[n % bucket.length];
    usedInBucket[key] = n + 1;
  }
  return { map, charInfo };
}

// Ghép tất cả: trả mảng per-line {char, voiceId, emotion, stability, style} + tóm tắt cast.
async function buildCasting(segs, opts) {
  const perLine = await analyze(segs, opts);
  const { map, charInfo } = assignVoices(perLine);
  const plan = perLine.map((p) => ({ char: p.char, voiceId: map[p.char], emotion: p.emotion, ...settingsFor(p.emotion) }));
  const summary = Object.keys(charInfo).map((c) => `${c}(${charInfo[c].gender}/${charInfo[c].age}, ${charInfo[c].count} câu) -> ${map[c]}`);
  return { plan, map, charInfo, summary };
}

module.exports = { buildCasting, analyze, assignVoices, settingsFor, VOICE_POOL, EMOTIONS };
