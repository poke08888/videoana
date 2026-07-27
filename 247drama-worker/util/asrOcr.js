const { execFile } = require("child_process");
const path = require("path");

// Python venv riêng cho OCR (RapidOCR, tách khỏi whisper venv).
const OCR_PY = process.env.OCR_PYTHON || "/opt/ocr-venv/bin/python";
const SCRIPT = path.join(__dirname, "..", "scripts", "ocr_subs.py");

/**
 * Đọc phụ đề tiếng Trung CHÁY SẴN trong video bằng OCR (RapidOCR) -> [{start,end,text}].
 * Timing bám đúng lúc sub xuất hiện/biến mất (không dựa audio như whisper).
 * Tham số đọc từ settingJSON.subtitle: ocrFps, ocrY0, ocrY1, ocrMinConf.
 */
function ocrSubtitles(videoPath, { timeoutMs = 25 * 60 * 1000 } = {}) {
  const S = (global.settingJSON && global.settingJSON.subtitle) || {};
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const fps = num(S.ocrFps, 4);
  const y0 = num(S.ocrY0, 0.55); // nới rộng để bắt cả sub nằm cao (vd Ga tàu ~62%)
  const y1 = num(S.ocrY1, 0.85);
  const minConf = num(S.ocrMinConf, 0.6);
  const threads = num(S.ocrThreads, 0); // 0 = dùng hết nhân; >0 = giới hạn luồng/OCR (khi chạy song song)

  const env = threads > 0
    ? { ...process.env, OCR_THREADS: String(threads), OMP_NUM_THREADS: String(threads), OPENBLAS_NUM_THREADS: String(threads) }
    : process.env;

  return new Promise((resolve, reject) => {
    execFile(
      OCR_PY,
      [SCRIPT, videoPath, String(fps), String(y0), String(y1), String(minConf)],
      { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, env },
      (err, stdout, stderr) => {
        if (err) return reject(new Error("OCR fail: " + (stderr || err.message || "").slice(0, 400)));
        try {
          const parsed = JSON.parse(String(stdout || "").trim());
          // Định dạng mới: {segments, chineseBottomRatio}. Cũ: mảng segments.
          if (Array.isArray(parsed)) resolve({ segments: parsed, chineseBottomRatio: null });
          else resolve({ segments: parsed.segments || [], chineseBottomRatio: parsed.chineseBottomRatio });
        } catch (e) {
          reject(new Error("OCR parse fail: " + String(stdout || "").slice(0, 200)));
        }
      },
    );
  });
}

module.exports = { ocrSubtitles };
