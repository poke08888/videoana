const { execFile } = require("child_process");
const path = require("path");

// Python của venv riêng cho faster-whisper (cài tách khỏi hệ thống).
const VENV_PY = process.env.WHISPER_PYTHON || "/opt/whisper-venv/bin/python";
const SCRIPT = path.join(__dirname, "..", "scripts", "asr_whisper.py");

/**
 * Nhận diện giọng nói 1 file wav -> mảng segment [{start,end,text}].
 * Gọi faster-whisper (CPU) qua script Python. Ném lỗi nếu thất bại.
 */
function transcribeAudio(wavPath, { model = "medium", lang = "zh", cpuThreads = 4, timeoutMs = 25 * 60 * 1000 } = {}) {
  // speech_pad_ms: đệm VAD 2 đầu mỗi đoạn. Mặc định faster-whisper 400ms -> phụ đề hiện SỚM ~0.4s.
  // Giảm còn 120ms để bám sát thoại. Chỉnh qua settingJSON.subtitle.whisperSpeechPadMs.
  const sp = ((global.settingJSON && global.settingJSON.subtitle) || {}).whisperSpeechPadMs;
  const speechPadMs = Number.isFinite(sp) ? sp : 120;
  return new Promise((resolve, reject) => {
    execFile(
      VENV_PY,
      [SCRIPT, wavPath, model, lang, String(cpuThreads), String(speechPadMs)],
      { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) return reject(new Error("ASR fail: " + (stderr || err.message || "").slice(0, 400)));
        const s = String(stdout || "").trim();
        try {
          const arr = JSON.parse(s);
          resolve(Array.isArray(arr) ? arr : []);
        } catch (e) {
          reject(new Error("ASR parse fail: " + s.slice(0, 200)));
        }
      },
    );
  });
}

module.exports = { transcribeAudio };
