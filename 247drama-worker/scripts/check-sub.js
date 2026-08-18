// Kiểm tra 1 video đã render (trên R2) còn sub Trung / có vietsub / không sub.
// Lấy N khung hình từ URL (ffmpeg range-request, không tải cả file) -> OCR dải phụ đề -> phân loại.
// Dùng: node scripts/check-sub.js <base_filename_khong_duoi> [N=8]
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { env } = require("./../config");

const OCR_PY = process.env.OCR_PYTHON || "python3";
const FRAMES_PY = path.join(__dirname, "ocr_frames.py");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 300)));
      resolve(stdout);
    });
  });
}
async function probeDur(url) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", url]);
  return parseFloat(String(out).trim()) || 0;
}

// Lấy 1 khung tại giây t, crop dải phụ đề (y 0.60-0.98) -> PNG.
async function grabFrame(url, t, out) {
  await run("ffmpeg", ["-y", "-ss", String(t), "-i", url, "-frames:v", "1",
    "-vf", "crop=iw:ih*0.38:0:ih*0.60", "-q:v", "3", out], { timeout: 60000 });
}

async function checkSub(base, N = 8) {
  const url = `${env.r2.publicBase}/videos/${base}.mp4`;
  const dur = await probeDur(url);
  if (!dur) return { base, verdict: "LỖI_ĐỌC", detail: "không đọc được duration" };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "checksub-"));
  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = dur * (0.08 + (0.84 * i) / (N - 1)); // trải đều, tránh đầu/cuối
    const f = path.join(tmp, `f${i}.png`);
    try { await grabFrame(url, t, f); if (fs.existsSync(f)) frames.push(f); } catch (e) {}
  }
  if (!frames.length) { fs.rmSync(tmp, { recursive: true, force: true }); return { base, verdict: "LỖI_KHUNG" }; }
  const out = await run(OCR_PY, [FRAMES_PY, ...frames]);
  fs.rmSync(tmp, { recursive: true, force: true });
  const r = JSON.parse(out);
  let verdict;
  if (r.cn >= 2 && r.cn >= r.vi) verdict = "SUB_TRUNG";       // còn phụ đề Trung -> render lỗi/raw
  else if (r.vi >= 2) verdict = "CÓ_VIETSUB";
  else verdict = "KHÔNG_SUB";                                   // nguồn không có sub
  return { base, verdict, cn: r.cn, vi: r.vi, empty: r.empty, texts: r.texts };
}

module.exports = { checkSub };

if (require.main === module) {
  const base = process.argv[2];
  const N = parseInt(process.argv[3]) || 8;
  if (!base) { console.error("cần base filename"); process.exit(1); }
  checkSub(base, N).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("LỖI", e.message); process.exit(1); });
}
