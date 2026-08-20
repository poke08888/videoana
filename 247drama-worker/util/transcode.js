// Lỗi thật của ffmpeg nằm ở CUỐI stderr; đầu stderr là banner phiên bản dài cả trăm ký tự.
// Cắt từ đầu thì log chỉ còn "ffmpeg version ..." và không ai biết vì sao hỏng.
function tailErr(s, n = 600) {
  const t = String(s || "").trim();
  return t.length > n ? "…" + t.slice(-n) : t;
}

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function run(cmd, args, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject(new Error(tailErr(stderr || err.message)));
      resolve(stdout);
    });
  });
}

// Lấy codec video của 1 file.
async function probeVideoCodec(file) {
  try {
    const out = await run("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "default=nk=1:nw=1",
      file,
    ], 60000);
    return String(out).trim();
  } catch (e) {
    return "";
  }
}

/**
 * Chuyển 1 Buffer video sang H.264 (nếu chưa phải H.264) để mọi thiết bị/player xem được.
 * Video mã hoá (không decode được) sẽ transcode thất bại -> trả về buffer gốc (fallback).
 * Trả về { buffer, transcoded, codec }.
 */
async function transcodeToH264(buffer) {
  const id = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const inF = path.join(os.tmpdir(), `tc_in_${id}.mp4`);
  const outF = path.join(os.tmpdir(), `tc_out_${id}.mp4`);
  try {
    fs.writeFileSync(inF, buffer);
    const codec = await probeVideoCodec(inF);

    if (codec === "h264") {
      return { buffer, transcoded: false, codec }; // đã H.264, khỏi transcode
    }

    await run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-i", inF,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outF,
    ]);

    const out = fs.readFileSync(outF);
    if (out && out.length > 0) {
      return { buffer: out, transcoded: true, codec };
    }
    return { buffer, transcoded: false, codec };
  } catch (e) {
    console.error("[transcode] lỗi, dùng file gốc:", e.message);
    return { buffer, transcoded: false, codec: "" };
  } finally {
    try { fs.unlinkSync(inF); } catch (x) {}
    try { fs.unlinkSync(outF); } catch (x) {}
  }
}

/**
 * Encode 1 lần: che dải đáy (drawbox đục) rồi burn phụ đề ASS lên trên, ra H.264.
 * box: { yRatio, heightRatio } vị trí & chiều cao dải che (theo tỉ lệ chiều cao video).
 * Gộp transcode + burn -> chỉ encode 1 lần.
 */
async function transcodeBurnSub(srcPath, assPath, box = {}) {
  const id = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const outF = path.join(os.tmpdir(), `tc_sub_${id}.mp4`);
  // box.enabled=false -> KHÔNG che, chỉ burn phụ đề Việt (sub Trung giữ nguyên).
  const vf = `${buildBoxFilter(box)}ass=${assPath}`;
  await run("ffmpeg", [
    "-y",
      "-hide_banner",
    "-i", srcPath,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "24",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outF,
  ]);
  const out = fs.readFileSync(outF);
  try { fs.unlinkSync(outF); } catch (x) {}
  if (!out || !out.length) throw new Error("burn-sub ra file rỗng");
  return out;
}

/**
 * Chuỗi filter che dải sub Trung ở đáy. Kết thúc bằng "," để nối filter sau (ass=...).
 * box.enabled=false -> không che.
 */
function buildBoxFilter(box = {}) {
  if (box.enabled === false) return "";
  const y = typeof box.yRatio === "number" ? box.yRatio : 0.66;
  const h = typeof box.heightRatio === "number" ? box.heightRatio : 0.17;
  const color = box.color || "white@1";
  return `drawbox=x=0:y=ih*${y}:w=iw:h=ih*${h}:color=${color}:t=fill,`;
}

/**
 * Encode H.264 chỉ CHE sub Trung, KHÔNG đốt phụ đề (chế độ soft-sub: phụ đề đi kèm
 * file .vtt riêng). Tham số encode giữ y hệt transcodeBurnSub để chất lượng/dung lượng
 * không đổi giữa hai chế độ.
 */
async function transcodeCleanBox(srcPath, box = {}) {
  const id = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const outF = path.join(os.tmpdir(), `tc_clean_${id}.mp4`);
  const vf = buildBoxFilter(box).replace(/,$/, "") || "null";
  try {
    await run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-nostats",
      "-i", srcPath,
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outF,
    ]);
    const out = fs.readFileSync(outF);
    if (!out || !out.length) throw new Error("clean-box ra file rỗng");
    return out;
  } finally {
    try { fs.unlinkSync(outF); } catch (x) {}
  }
}

module.exports = { transcodeToH264, transcodeBurnSub, transcodeCleanBox, buildBoxFilter, probeVideoCodec };
