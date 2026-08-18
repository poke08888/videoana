const { execFile } = require("child_process");
const fs = require("fs");

function run(cmd, args, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 400)));
      resolve(stdout);
    });
  });
}

// Tách audio -> wav 16kHz mono cho ASR.
async function extractAudio(srcPath, wavPath) {
  await run("ffmpeg", ["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wavPath]);
  return wavPath;
}

// Lấy width/height video.
async function probeDimensions(srcPath) {
  try {
    const out = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", srcPath],
      60000,
    );
    const [w, h] = String(out).trim().split("x").map((n) => parseInt(n, 10));
    if (w && h) return { width: w, height: h };
  } catch (e) {}
  return { width: 720, height: 1280 }; // mặc định dọc 9:16
}

// Đổi giây -> H:MM:SS.cs cho ASS.
function assTime(sec) {
  // Làm tròn về TỔNG centisecond trước rồi mới tách giờ/phút/giây. Tách trước rồi làm tròn
  // phần lẻ riêng sẽ tràn ở mốc biên (1.995 -> "0:00:01.100", sai định dạng .cs) và làm
  // phụ đề đốt cứng lệch với phụ đề rời .vtt (util/vtt.js dùng đúng cách này).
  const total = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(total / 360000);
  const m = Math.floor((total % 360000) / 6000);
  const s = Math.floor((total % 6000) / 100);
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(total % 100)}`;
}

// Escape text cho 1 dòng Dialogue ASS (xuống dòng -> \N).
function escapeAss(text) {
  return String(text || "")
    .replace(/\r?\n/g, "\\N")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")");
}

/**
 * Sinh file .ass phụ đề tiếng Việt.
 * segments: [{start,end,text}] (text đã dịch).
 * Kiểu chữ/vị trí/timing đọc từ settingJSON.subtitle (chỉnh trực tiếp qua admin, KHÔNG cần sửa code):
 *   subFontRatio     : cỡ chữ theo chiều cao video (mặc định 0.024)
 *   subMarginHRatio  : lề 2 bên theo chiều rộng (mặc định 0.04 ≈ 0.3cm) -> vượt lề tự xuống dòng
 *   subTopRatio      : vị trí ĐỈNH chữ Việt theo chiều cao (mặc định = coverBoxYRatio + 0.06, sát dưới tiếng Trung)
 *   subStartOffsetMs : dịch thời gian (ms); >0 = LÙI phụ đề lại nếu hiện quá sớm (mặc định 0)
 *   subOutlineRatio  : độ dày viền (mặc định 0.0035)
 */
function buildAss(segments, { width, height, assPath, chineseBottomRatio }) {
  const S = (global.settingJSON && global.settingJSON.subtitle) || {};
  const num = (v, d) => (typeof v === "number" && !isNaN(v) ? v : d);

  const fontRatio = num(S.subFontRatio, 0.024);
  const marginHRatio = num(S.subMarginHRatio, 0.04); // lề 2 bên ~0.3cm
  const outlineRatio = num(S.subOutlineRatio, 0.0035);
  const gapRatio = num(S.subGapRatio, 0.012); // khoảng cách Việt-Trung (~0.3cm)
  // Vị trí ĐỈNH chữ Việt: ưu tiên CANH ĐỘNG ngay dưới đáy sub Trung do OCR phát hiện (khác nhau theo phim).
  // Không có -> fallback theo setting cố định.
  let topRatio;
  if (typeof chineseBottomRatio === "number" && chineseBottomRatio > 0) {
    topRatio = Math.min(0.88, chineseBottomRatio + gapRatio);
  } else {
    const chineseTop = num(S.coverBoxYRatio, 0.66);
    topRatio = num(S.subTopRatio, chineseTop + 0.06);
  }
  const startOffsetMs = num(S.subStartOffsetMs, 0); // >0: lùi lại (sửa "hiện quá sớm")

  const fontSize = Math.max(12, Math.round(height * fontRatio));
  const marginH = Math.round(width * marginHRatio);
  const marginV = Math.round(height * topRatio); // Alignment=8: khoảng cách từ ĐỈNH màn hình -> đỉnh chữ
  const outline = Math.max(2, Math.round(height * outlineRatio));
  const offSec = startOffsetMs / 1000;

  const header =
    `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: ${width}\n` +
    `PlayResY: ${height}\n` +
    `WrapStyle: 0\n` + // 0 = tự xuống dòng thông minh khi vượt lề
    `ScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    // Chữ TRẮNG, viền ĐEN + bóng. Alignment=8 (giữa-ĐỈNH): neo đỉnh chữ ngay dưới tiếng Trung; wrap thì lan XUỐNG.
    `Style: VI,DejaVu Sans,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,${outline},1,8,${marginH},${marginH},${marginV},1\n\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const lines = segments
    .filter((s) => s && s.text && String(s.text).trim())
    .map((s) => `Dialogue: 0,${assTime(s.start + offSec)},${assTime(s.end + offSec)},VI,,0,0,0,,${escapeAss(s.text)}`)
    .join("\n");

  fs.writeFileSync(assPath, header + lines + "\n", "utf8");
  return assPath;
}

module.exports = { extractAudio, probeDimensions, buildAss, assTime };
