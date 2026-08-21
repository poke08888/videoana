// Lỗi thật của ffmpeg nằm ở CUỐI stderr; đầu stderr là banner phiên bản dài cả trăm ký tự.
// Cắt từ đầu thì log chỉ còn "ffmpeg version ..." và không ai biết vì sao hỏng.
function tailErr(s, n = 600) {
  const t = String(s || "").trim();
  return t.length > n ? "…" + t.slice(-n) : t;
}

const { execFile } = require("child_process");
const path = require("path");

// Python venv riêng cho OCR (RapidOCR, tách khỏi whisper venv).
const OCR_PY = process.env.OCR_PYTHON || "/opt/ocr-venv/bin/python";
const SCRIPT = path.join(__dirname, "..", "scripts", "ocr_subs.py");

// Dải quét lần hai khi dải thường không thấy chữ Hán nào. Có phim đặt phụ đề rất thấp
// (đo được đáy ~0,90) — nằm ngoài dải 0,55-0,85 nên OCR trả về rỗng và cả tập bị bỏ, dù
// video có phụ đề đầy đủ.
const WIDE_Y0 = 0.5;
const WIDE_Y1 = 0.98;
// Dưới ngưỡng này coi như dải thường "không thấy gì": một tập phim ngắn bình thường có 30-80
// câu thoại, đọc được chưa tới 10 câu nghĩa là đang bắt nhầm chữ vụn (biển hiệu, watermark,
// số hiệu) chứ không phải phụ đề. Phim đặt chữ ngay rìa dải (đáy ~0,83) lọt được vài câu vào
// dải thường nên KHÔNG bị coi là rỗng, rồi bị lọc sạch ở bước làm sạch — tập chết với thông
// báo "OCR không đọc được phụ đề nào" mà chẳng ai biết chỉ cần quét rộng ra một chút.
const MIN_CN_SEGS = 10;

// Đúng phép lọc mà cleanOcrSegs dùng: có chữ Hán và dài từ 2 ký tự. Đếm bằng thước khác thì
// lượt quét "đủ câu" ở đây lại thành rỗng ở bước sau.
const isRealLine = (t) => {
  const s = String(t || "");
  return /[\u4e00-\u9fff]/.test(s) && s.replace(/\s/g, "").length >= 2;
};

// Số câu thật sự dùng được — thước đo "lượt quét này có đọc được phụ đề không".
function scoreSegments(segments) {
  return (segments || []).filter((s) => isRealLine(s && s.text)).length;
}

// Có cần quét lại dải rộng không. Đo được vị trí mà vẫn quá ít câu thì vẫn phải quét lại:
// chữ vụn trong dải thường cũng đủ cho ra một con số, làm lượt quét trông như đã thành công.
function shouldWiden(result) {
  if (!result) return true;
  return result.chineseBottomRatio == null || scoreSegments(result.segments) < MIN_CN_SEGS;
}

function runOcr(videoPath, { fps, y0, y1, minConf, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    execFile(
      OCR_PY,
      [SCRIPT, videoPath, String(fps), String(y0), String(y1), String(minConf)],
      { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, env },
      (err, stdout, stderr) => {
        if (err) return reject(new Error("OCR fail: " + tailErr(stderr || err.message)));
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

/**
 * Đọc phụ đề tiếng Trung CHÁY SẴN trong video bằng OCR (RapidOCR) -> [{start,end,text}].
 * Timing bám đúng lúc sub xuất hiện/biến mất (không dựa audio như whisper).
 * Tham số đọc từ settingJSON.subtitle: ocrFps, ocrY0, ocrY1, ocrMinConf.
 *
 * Quét dải thường trước cho nhanh; không thấy chữ Hán mới quét lại dải rộng — mất thêm một
 * lượt OCR, nhưng chỉ với đúng những tập mà nếu không quét lại thì cầm chắc bỏ.
 */
async function ocrSubtitles(videoPath, { timeoutMs = 25 * 60 * 1000 } = {}) {
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

  const first = await runOcr(videoPath, { fps, y0, y1, minConf, env, timeoutMs });
  if (!shouldWiden(first)) return first;

  const wideY0 = Math.min(y0, WIDE_Y0);
  const wideY1 = Math.max(y1, WIDE_Y1);
  if (wideY0 === y0 && wideY1 === y1) return first; // người vận hành đã đặt sẵn dải rộng
  console.warn(`[ocr] dải ${y0}-${y1} chỉ đọc được ${scoreSegments(first.segments)} câu -> quét lại dải ${wideY0}-${wideY1}`);
  const wide = await runOcr(videoPath, { fps, y0: wideY0, y1: wideY1, minConf, env, timeoutMs });
  return scoreSegments(wide.segments) > scoreSegments(first.segments) ? wide : first;
}

module.exports = { ocrSubtitles, scoreSegments, shouldWiden, WIDE_Y0, WIDE_Y1, MIN_CN_SEGS };
