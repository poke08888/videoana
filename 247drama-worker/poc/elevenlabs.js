const axios = require("axios");

// Text-to-Speech ElevenLabs. Trả Buffer mp3. Cần key có quyền text_to_speech.
async function tts(text, { apiKey, voiceId, model = "eleven_multilingual_v2", stability = 0.5, similarity = 0.75 }) {
  const { data } = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    { text, model_id: model, voice_settings: { stability, similarity_boost: similarity } },
    {
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      responseType: "arraybuffer",
      timeout: 90000,
    },
  );
  return Buffer.from(data);
}

module.exports = { tts };
