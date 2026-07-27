const axios = require("axios");

// Text-to-Speech ElevenLabs. Trả Buffer mp3. Cần key có quyền text_to_speech.
// model turbo_v2_5 + language_code ÉP RÕ ngôn ngữ (vi) -> tránh auto-detect nhầm giọng ngoại.
async function tts(text, { apiKey, voiceId, model = "eleven_v3", languageCode = "vi", stability = 0.3, similarity = 0.75 }) {
  const body = { text, model_id: model, voice_settings: { stability, similarity_boost: similarity } };
  if (languageCode) body.language_code = languageCode;
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
