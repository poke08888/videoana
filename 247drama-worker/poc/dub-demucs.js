// POC lồng tiếng Việt FULL DUB: tách nền bằng Demucs (bỏ hẳn thoại Trung) + giọng Việt.
// Dub đi TỪ SUB VIỆT (sidecar .vi.json). Fix nghe-hiểu: khe = tới câu kế, atempo nhẹ (<=1.3).
// Dùng: node poc/dub-demucs.js [mp4]
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const axios = require("axios");
const { env } = require("./../config");
const { tts } = require("./elevenlabs");

const EP = process.argv[2] || path.join(env.downloadDir, "hg_7650805046258453528_ep0.mp4");
const VOICE = process.env.ELEVEN_VOICE_ID || "Tr84Gom1NKJwoYZT55td";
const OUT_DIR = process.env.POC_OUT || path.join(env.workDir, "dub-poc");
const DEMUCS_PY = process.env.DEMUCS_PYTHON || path.join(env.workDir, "demucs-venv/bin/python");
const BG_VOL = process.env.BG_VOL || "1.0"; // nhạc nền (đã sạch thoại) giữ gần như nguyên
const MAX_ATEMPO = 1.3; // ép nhẹ để vẫn nghe hiểu

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 600)));
      resolve(stdout);
    });
  });
}
async function probeDur(f) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]);
  return parseFloat(String(out).trim()) || 0;
}
async function loadViSegs(segPath, sidecarName) {
  if (fs.existsSync(segPath)) { console.log("[dub] segments.json local"); return JSON.parse(fs.readFileSync(segPath, "utf8")); }
  const url = `${env.r2.publicBase}/videos/${sidecarName}`;
  console.log(`[dub] tải sub Việt: ${url}`);
  const { data } = await axios.get(url, { timeout: 30000 });
  return Array.isArray(data) ? data : JSON.parse(data);
}

async function main() {
  if (!process.env.ELEVEN_API_KEY) throw new Error("thiếu ELEVEN_API_KEY");
  if (!fs.existsSync(EP)) throw new Error(`không thấy tập: ${EP}`);
  if (!fs.existsSync(DEMUCS_PY)) throw new Error(`chưa có demucs: ${DEMUCS_PY}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const clipsDir = path.join(OUT_DIR, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  const base = path.basename(EP).replace(/\.mp4$/, "");
  const segPath = path.join(OUT_DIR, "segments.json");

  // 1) SUB VIỆT
  const viSegs = await loadViSegs(segPath, `${base}.vi.json`);
  if (!viSegs.length) throw new Error("sub Việt rỗng");
  console.log(`[dub] ${viSegs.length} câu Việt (từ sub)`);

  // 2) Tách nền bằng Demucs -> no_vocals.wav (nhạc + hiệu ứng, bỏ thoại Trung)
  const audioWav = path.join(OUT_DIR, "orig.wav");
  console.log("[dub] trích audio gốc...");
  await run("ffmpeg", ["-y", "-i", EP, "-vn", "-ac", "2", "-ar", "44100", audioWav]);
  const sepDir = path.join(OUT_DIR, "sep");
  console.log("[dub] Demucs tách nền (chờ ~1-3 phút)...");
  await run(DEMUCS_PY, ["-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", sepDir, audioWav], { timeout: 20 * 60 * 1000 });
  const bg = path.join(sepDir, "htdemucs", "orig", "no_vocals.wav");
  if (!fs.existsSync(bg)) throw new Error(`không thấy no_vocals.wav tại ${bg}`);
  console.log("[dub] nền sạch:", bg);

  // 3) TTS từng câu + time-fit NHẸ (khe = tới câu kế)
  const clips = [];
  for (let i = 0; i < viSegs.length; i++) {
    const s = viSegs[i];
    const text = String(s.text || "").trim();
    if (!text) continue;
    const nextStart = i + 1 < viSegs.length ? (viSegs[i + 1].start || 0) : (s.end || 0) + 2;
    const slot = Math.max(0.6, nextStart - (s.start || 0)); // dùng cả khoảng nghỉ tới câu kế
    const mp3 = path.join(clipsDir, `c${i}.mp3`);
    process.stdout.write(`\r[dub] TTS ${i + 1}/${viSegs.length}   `);
    const buf = await tts(text, { apiKey: process.env.ELEVEN_API_KEY, voiceId: VOICE });
    fs.writeFileSync(mp3, buf);
    const dur = await probeDur(mp3);
    const atempo = dur > slot ? Math.min(MAX_ATEMPO, +(dur / slot).toFixed(3)) : 1;
    clips.push({ file: mp3, startMs: Math.round((s.start || 0) * 1000), atempo });
  }
  console.log(`\n[dub] xong TTS ${clips.length} clip`);

  // 4) Mix: nền sạch (input 1) + clip Việt -> thay track audio, giữ video
  const inputs = ["-i", EP, "-i", bg];
  clips.forEach((c) => inputs.push("-i", c.file));
  const parts = [`[1:a]volume=${BG_VOL}[bg]`];
  const labels = ["[bg]"];
  clips.forEach((c, k) => {
    const idx = k + 2; // 0=video,1=nền
    const chain = c.atempo > 1 ? `atempo=${c.atempo},adelay=${c.startMs}:all=1` : `adelay=${c.startMs}:all=1`;
    parts.push(`[${idx}:a]${chain}[c${k}]`);
    labels.push(`[c${k}]`);
  });
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`);
  const filterFile = path.join(OUT_DIR, "filter_demucs.txt");
  fs.writeFileSync(filterFile, parts.join(";\n"));

  const outFile = path.join(OUT_DIR, "dubbed_demucs.mp4");
  console.log("[dub] ghép video + nền sạch + tiếng Việt...");
  await run("ffmpeg", ["-y", ...inputs, "-filter_complex_script", filterFile, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outFile]);
  console.log(`\n✅ XONG -> ${outFile}`);
}

main().catch((e) => { console.error("\n[dub] LỖI:", e.message); process.exit(1); });
