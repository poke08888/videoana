// POC lồng tiếng Việt 1 tập bằng ElevenLabs TTS (bản nhanh: giảm audio gốc + đè tiếng Việt).
// Dùng: node poc/dub-episode.js [đường-dẫn-mp4]   (mặc định ep0 phim "Mười mấy năm tu luyện")
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const db = require("./../db");
const { ocrSubtitles } = require("./../util/asrOcr");
const { translateSegments } = require("./../util/translate");
const { buildSubtitleConfig, env } = require("./../config");
const { tts } = require("./elevenlabs");

const EP = process.argv[2] || path.join(env.downloadDir, "hg_7650805046258453528_ep0.mp4");
const VOICE = process.env.ELEVEN_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel (premade multilingual)
const OUT_DIR = process.env.POC_OUT || path.join(env.workDir, "dub-poc");
const ORIG_VOL = process.env.ORIG_VOL || "0.15"; // audio gốc giảm còn 15%
const MAX_ATEMPO = 1.6; // ép nhanh tối đa để không tràn khe (tránh méo)

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 500)));
      resolve(stdout);
    });
  });
}
async function probeDur(f) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]);
  return parseFloat(String(out).trim()) || 0;
}
// Lọc rác OCR (khớp cleanOcrSegs trong autosub).
function cleanOcr(segs) {
  return (segs || []).filter((s) => s && s.text && /[一-鿿]/.test(s.text) && s.text.replace(/\s/g, "").length >= 2);
}

async function main() {
  if (!process.env.ELEVEN_API_KEY) throw new Error("thiếu ELEVEN_API_KEY trong .env");
  if (!fs.existsSync(EP)) throw new Error(`không thấy tập: ${EP}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const clipsDir = path.join(OUT_DIR, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  console.log(`[dub] tập: ${EP}`);

  // 1) segment tiếng Việt (OCR Trung -> lọc -> dịch Gemini)
  await db.connect();
  await db.loadSettings();
  const cfg = buildSubtitleConfig(global.settingJSON);
  if (!cfg.apiKey) throw new Error("thiếu Gemini key trong settingJSON");
  console.log("[dub] OCR hardsub Trung...");
  const ocr = await ocrSubtitles(EP);
  const zhSegs = cleanOcr(ocr.segments);
  if (!zhSegs.length) throw new Error("OCR không ra câu nào");
  console.log(`[dub] ${zhSegs.length} câu Trung -> dịch Việt...`);
  const viSegs = await translateSegments(zhSegs, {
    apiKey: cfg.apiKey, model: cfg.geminiModel, sourceLang: cfg.sourceLang, targetLang: cfg.targetLang, batchSize: cfg.translateBatchSize,
  });
  await db.mongoose.disconnect();
  fs.writeFileSync(path.join(OUT_DIR, "segments.json"), JSON.stringify(viSegs, null, 2));
  console.log(`[dub] ${viSegs.length} câu Việt -> segments.json`);

  // 2) TTS từng câu + đo độ dài -> tính atempo ép vừa khe
  const clips = [];
  for (let i = 0; i < viSegs.length; i++) {
    const s = viSegs[i];
    const text = String(s.text || "").trim();
    if (!text) continue;
    const slot = Math.max(0.4, (s.end || 0) - (s.start || 0));
    const mp3 = path.join(clipsDir, `c${i}.mp3`);
    process.stdout.write(`\r[dub] TTS ${i + 1}/${viSegs.length}   `);
    const buf = await tts(text, { apiKey: process.env.ELEVEN_API_KEY, voiceId: VOICE });
    fs.writeFileSync(mp3, buf);
    const dur = await probeDur(mp3);
    const atempo = dur > slot ? Math.min(MAX_ATEMPO, +(dur / slot).toFixed(3)) : 1;
    clips.push({ file: mp3, startMs: Math.round((s.start || 0) * 1000), atempo });
  }
  console.log(`\n[dub] xong TTS ${clips.length} clip`);

  // 3) ffmpeg: audio gốc nhỏ + đè các clip đúng timestamp -> thay track audio
  const inputs = ["-i", EP];
  clips.forEach((c) => inputs.push("-i", c.file));
  const parts = [`[0:a]volume=${ORIG_VOL}[bg]`];
  const labels = ["[bg]"];
  clips.forEach((c, k) => {
    const idx = k + 1;
    const chain = c.atempo > 1 ? `atempo=${c.atempo},adelay=${c.startMs}:all=1` : `adelay=${c.startMs}:all=1`;
    parts.push(`[${idx}:a]${chain}[c${k}]`);
    labels.push(`[c${k}]`);
  });
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`);
  const filterFile = path.join(OUT_DIR, "filter.txt");
  fs.writeFileSync(filterFile, parts.join(";\n"));

  const outFile = path.join(OUT_DIR, "dubbed.mp4");
  console.log("[dub] ghép audio + video (ffmpeg)...");
  await run("ffmpeg", [
    "-y", ...inputs,
    "-filter_complex_script", filterFile,
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    outFile,
  ]);
  console.log(`\n✅ XONG -> ${outFile}`);
}

main().catch((e) => { console.error("\n[dub] LỖI:", e.message); process.exit(1); });
