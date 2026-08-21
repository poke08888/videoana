const axios = require("axios");
const { langName } = require("./langRules");

const GEMINI_HOST = "https://generativelanguage.googleapis.com/v1beta/models";

function endpoint(model, apiKey) {
  return `${GEMINI_HOST}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

// Gọi Gemini generateContent, trả text thô của phản hồi.
//
// thinkingBudget=0: tắt phần "suy nghĩ" của gemini-2.5-flash. Dịch phụ đề là việc cơ học,
// bật suy nghĩ chỉ tốn thêm ~6000 token và kéo mỗi lượt gọi từ 5 giây lên 35 giây.
// Đặt null nếu muốn bật lại. Model nào không hiểu tham số này thì gọi lại không kèm nó.
async function callGemini({ apiKey, model, prompt, json = false, timeout = 60000, thinkingBudget = 0 }) {
  const gen = {
    temperature: 0.2,
    ...(json ? { responseMimeType: "application/json" } : {}),
  };
  const withThinking = Number.isFinite(thinkingBudget)
    ? { ...gen, thinkingConfig: { thinkingBudget } }
    : gen;

  const send = async (generationConfig) => {
    const { data } = await axios.post(
      endpoint(model, apiKey),
      { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig },
      { timeout, headers: { "Content-Type": "application/json" } }
    );
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("").trim();
  };

  try {
    return await send(withThinking);
  } catch (e) {
    const status = e?.response?.status;
    if (withThinking !== gen && status === 400) {
      console.warn("[translate] model không nhận thinkingConfig, gọi lại không kèm");
      return send(gen);
    }
    throw e;
  }
}

/**
 * Dịch danh sách segment phụ đề zh -> vi, giữ nguyên timestamp & thứ tự.
 * segments: [{start,end,text}]  -> trả về [{start,end,text}] với text đã dịch.
 * Dịch theo lô (batch) để tiết kiệm số lần gọi và giữ ngữ cảnh thoại.
 * Segment nào dịch hụt thì giữ nguyên text gốc (không làm rơi dòng).
 */
async function translateSegments(segments, opts = {}) {
  const {
    apiKey,
    model = "gemini-2.5-flash",
    sourceLang = "zh",
    targetLang = "vi",
    batchSize = 20,
    ask, // chỉ dùng cho test: thay chỗ gọi Gemini
  } = opts;
  if (!apiKey && !ask) throw new Error("thiếu geminiApiKey");
  if (!segments.length) return [];

  const result = segments.map((s) => ({ ...s }));
  const srcName = langName(sourceLang);
  const dstName = langName(targetLang);

  // Hỏi Gemini một lô -> mảng chuỗi, hoặc null nếu gọi/parse hỏng.
  async function askGemini(batch) {
    // Đánh số 1..N; ép Gemini dịch ĐÚNG 1:1 theo dòng, KHÔNG gộp/tách/đổi thứ tự
    // (giữ đồng bộ với timestamp -> phụ đề không lệch).
    const numbered = batch.map((s, j) => `${j + 1}. ${s.text}`).join("\n");
    const prompt =
      `Bạn là dịch giả phụ đề phim ngắn. Dịch từng câu thoại sau từ ${srcName} sang ${dstName} ` +
      `tự nhiên, ngắn gọn, đúng văn nói.\n` +
      `QUAN TRỌNG: dịch ĐÚNG ${batch.length} dòng, MỖI dòng vào 1 phần tử, GIỮ NGUYÊN thứ tự, ` +
      `TUYỆT ĐỐI không gộp/tách/thêm/bớt dòng (kể cả câu ngắn hay lặp).\n` +
      `Chỉ trả về JSON array gồm ĐÚNG ${batch.length} chuỗi ${dstName}, không thêm gì khác.\n\n${numbered}`;
    try {
      const raw = ask ? await ask(prompt, batch) : await callGemini({ apiKey, model, prompt, json: true });
      const parsed = typeof raw === "string" ? JSON.parse(stripCodeFence(raw)) : raw;
      if (!Array.isArray(parsed)) return null;
      return parsed.map((x) => (typeof x === "string" ? x : (x && (x.t || x.vi || x.text)) || ""));
    } catch (e) {
      console.error(`[translate] lô ${batch.length} dòng lỗi:`, e.message);
      return null;
    }
  }

  // Trả mảng ĐÚNG BẰNG độ dài lô; phần tử null = không dịch được, giữ nguyên câu gốc.
  //
  // Gemini thỉnh thoảng gộp hai câu ngắn làm một (trả 19 dòng cho lô 20). Trước đây cả lô bị
  // giữ nguyên tiếng Trung — 20 câu Hán lọt vào track "vi" là đủ để nghi thức nghiệm thu đánh
  // rớt cả track, và tập coi như hỏng. Nay chẻ đôi lô rồi hỏi lại: chỗ nào Gemini dịch đúng số
  // dòng thì giữ, chỉ đúng câu gây rối mới phải bỏ.
  async function translateChunk(batch) {
    const arr = await askGemini(batch);
    if (arr && arr.length === batch.length) {
      return arr.map((x) => (x ? String(x).trim() : null));
    }
    if (batch.length === 1) {
      // Một câu mà trả về nhiều mảnh -> nối lại, vẫn đúng câu đó.
      const joined = arr && arr.length ? arr.map((x) => String(x).trim()).filter(Boolean).join(" ") : "";
      return [joined || null];
    }
    const mid = Math.ceil(batch.length / 2);
    const [a, b] = [await translateChunk(batch.slice(0, mid)), await translateChunk(batch.slice(mid))];
    return [...a, ...b];
  }

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const out = await translateChunk(batch);
    let kept = 0;
    for (let k = 0; k < batch.length; k++) {
      if (out[k]) result[i + k].text = out[k];
      else kept++;
    }
    if (kept) console.warn(`[translate] lô ${i + 1}-${i + batch.length}: ${kept} câu không dịch được -> giữ gốc`);
  }
  return result;
}

/**
 * Dịch 1 đoạn text ngắn (tiêu đề / tóm tắt phim) zh -> vi.
 * Lỗi -> trả về text gốc (không chặn luồng import).
 */
async function translateText(text, opts = {}) {
  const { apiKey, model = "gemini-2.5-flash", sourceLang = "zh", targetLang = "vi", kind = "văn bản" } = opts;
  const clean = (text || "").trim();
  if (!clean || !apiKey) return clean;
  try {
    const prompt =
      `Dịch ${kind} phim sau từ ${langName(sourceLang)} sang ` +
      `${langName(targetLang)} tự nhiên, hấp dẫn, đúng văn phong bản ngữ. ` +
      `CHỈ trả về bản dịch, không giải thích, không thêm dấu ngoặc.\n\n${clean}`;
    const raw = await callGemini({ apiKey, model, prompt });
    return stripCodeFence(raw).trim() || clean;
  } catch (e) {
    console.error("[translate] dịch text lỗi, giữ gốc:", e.message);
    return clean;
  }
}

function stripCodeFence(s) {
  return String(s || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

module.exports = { translateSegments, translateText };
