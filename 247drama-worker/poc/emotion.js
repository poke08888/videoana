const axios = require("axios");
const HOST = "https://generativelanguage.googleapis.com/v1beta/models";

// Nhãn cảm xúc cho ElevenLabs v3 audio tag. "neutral" -> không gắn tag.
const TAGS = ["angry", "shouting", "sad", "crying", "excited", "happy", "nervous", "scared", "whispers", "sarcastic", "pleading", "neutral"];

// Gemini phân tích từng câu thoại -> nhãn cảm xúc (theo thứ tự, 1:1). Trả mảng "" | "angry" | ...
async function tagEmotions(segs, { apiKey, model = "gemini-2.5-flash" }) {
  if (!apiKey) throw new Error("thiếu Gemini key");
  const lines = segs.map((s, i) => `${i + 1}. ${s.text}`).join("\n");
  const prompt =
    `Bạn là đạo diễn lồng tiếng phim ngắn Trung Quốc (chàng rể nghèo/tu tiên, nhiều kịch tính).\n` +
    `Với MỖI câu thoại tiếng Việt dưới đây, chọn 1 NHÃN CẢM XÚC để diễn viên đọc đúng tông, hợp ngữ cảnh mạch truyện.\n` +
    `Chỉ chọn trong: ${TAGS.join(", ")}. Câu bình thường thì chọn "neutral".\n` +
    `Trả về JSON array ĐÚNG ${segs.length} phần tử (mỗi phần tử 1 nhãn chữ thường), GIỮ NGUYÊN thứ tự, không thêm gì khác.\n\n${lines}`;
  const { data } = await axios.post(
    `${HOST}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: "application/json" } },
    { timeout: 90000, headers: { "Content-Type": "application/json" } },
  );
  let raw = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.length !== segs.length) throw new Error(`emotion trả ${arr ? arr.length : "?"} != ${segs.length} dòng`);
  return arr.map((t) => {
    const tag = String(t).toLowerCase().replace(/[[\]]/g, "").trim();
    return tag && tag !== "neutral" && TAGS.includes(tag) ? tag : "";
  });
}

module.exports = { tagEmotions, TAGS };
