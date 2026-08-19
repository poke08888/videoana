const axios = require("axios");
const { langName } = require("./langRules");

const GEMINI_HOST = "https://generativelanguage.googleapis.com/v1beta/models";

function endpoint(model, apiKey) {
  return `${GEMINI_HOST}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

// Gọi Gemini generateContent, trả text thô của phản hồi.
async function callGemini({ apiKey, model, prompt, json = false, timeout = 60000 }) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const { data } = await axios.post(endpoint(model, apiKey), body, {
    timeout,
    headers: { "Content-Type": "application/json" },
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
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
  } = opts;
  if (!apiKey) throw new Error("thiếu geminiApiKey");
  if (!segments.length) return [];

  const result = segments.map((s) => ({ ...s }));
  const srcName = langName(sourceLang);
  const dstName = langName(targetLang);

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    // Đánh số 1..N; ép Gemini dịch ĐÚNG 1:1 theo dòng, KHÔNG gộp/tách/đổi thứ tự
    // (giữ đồng bộ với timestamp của whisper -> phụ đề không lệch).
    const numbered = batch.map((s, j) => `${j + 1}. ${s.text}`).join("\n");
    const prompt =
      `Bạn là dịch giả phụ đề phim ngắn. Dịch từng câu thoại sau từ ${srcName} sang ${dstName} ` +
      `tự nhiên, ngắn gọn, đúng văn nói.\n` +
      `QUAN TRỌNG: dịch ĐÚNG ${batch.length} dòng, MỖI dòng vào 1 phần tử, GIỮ NGUYÊN thứ tự, ` +
      `TUYỆT ĐỐI không gộp/tách/thêm/bớt dòng (kể cả câu ngắn hay lặp).\n` +
      `Chỉ trả về JSON array gồm ĐÚNG ${batch.length} chuỗi ${dstName}, không thêm gì khác.\n\n${numbered}`;

    let arr = null;
    try {
      const raw = await callGemini({ apiKey, model, prompt, json: true });
      const parsed = JSON.parse(stripCodeFence(raw));
      if (Array.isArray(parsed)) arr = parsed.map((x) => (typeof x === "string" ? x : x && (x.t || x.vi || x.text) || ""));
    } catch (e) {
      console.error(`[translate] lô ${i + 1}-${i + batch.length} lỗi:`, e.message);
    }

    if (arr && arr.length === batch.length) {
      // 1:1 hoàn hảo -> gán theo vị trí (đồng bộ chuẩn với timestamp).
      for (let k = 0; k < batch.length; k++) if (arr[k]) result[i + k].text = String(arr[k]).trim();
    } else {
      // Số dòng KHÔNG khớp -> Gemini đã gộp/tách -> KHÔNG gán theo vị trí (sẽ lệch).
      // An toàn: giữ tiếng Trung cho cả lô để không sai câu (thà chưa dịch còn hơn lệch).
      console.warn(`[translate] lô ${i + 1}-${i + batch.length}: Gemini trả ${arr ? arr.length : "?"} != ${batch.length} dòng -> giữ gốc lô này`);
    }
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
