const axios = require("axios");

// Text-to-Speech ElevenLabs -> Buffer mp3. Cần key có quyền text_to_speech.
// Model eleven_v3 + language_code="vi": v3 hỗ trợ tiếng Việt và biểu cảm mạnh nhất; cảm xúc
// truyền qua AUDIO TAG [angry]/[sad]... chèn vào text (không phải voice_settings.style).
// (multilingual_v2 KHÔNG có tiếng Việt -> đọc sai; nên KHÔNG dùng.)
async function tts(text, {
  apiKey,
  voiceId,
  model = "eleven_v3",
  languageCode = "vi",        // ÉP tiếng Việt
  stability = 0.5,
  similarity = 0.75,
  style = 0.0,                // 0 = trung tính; tăng -> nhấn nhá/kịch tính hơn
  speakerBoost = true,
}) {
  const body = {
    text,
    model_id: model,
    voice_settings: {
      stability,
      similarity_boost: similarity,
      style,
      use_speaker_boost: speakerBoost,
    },
  };
  if (languageCode) body.language_code = languageCode; // v2 không cần; chỉ set khi ép rõ
  const { data } = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    body,
    {
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      responseType: "arraybuffer",
      timeout: 90000,
    },
  );
  return Buffer.from(data);
}

module.exports = { tts };
