// 1 VIDEO CÓ CẢ VIETSUB (chữ, đã burn) + VIETDUB (giọng Việt TTS, nền tách demucs).
// Hình lấy từ video ĐÃ RENDER (có sub Việt) trên R2; tiếng = nền sạch + TTS từ SUB VIỆT.
// Tái dùng no_vocals.wav (demucs) + clip TTS nếu đã có. Dùng: node poc/subdub.js [base_name]
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const axios = require("axios");
const db = require("./../db");
const { env, buildSubtitleConfig } = require("./../config");
const { tts } = require("./elevenlabs");
const { tagEmotions } = require("./emotion");

const BASE = process.argv[2] || "hg_7650805046258453528_ep0";
const VOICE = process.env.ELEVEN_VOICE_ID || "Tr84Gom1NKJwoYZT55td";
const OUT_DIR = process.env.POC_OUT || path.join(env.workDir, "dub-poc");
const DEMUCS_PY = process.env.DEMUCS_PYTHON || path.join(env.workDir, "demucs-venv/bin/python");
const BG_VOL = process.env.BG_VOL || "0.55"; // nền hạ xuống để không át giọng
const VOICE_VOL = process.env.VOICE_VOL || "2.5"; // giọng tăng ~+8dB (đang nhỏ hơn nền)
const MAX_ATEMPO = 1.3;

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
async function loadViSegs(name) {
  const local = path.join(OUT_DIR, "segments.json");
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, "utf8"));
  const { data } = await axios.get(`${env.r2.publicBase}/videos/${name}.vi.json`, { timeout: 30000 });
  return Array.isArray(data) ? data : JSON.parse(data);
}

async function main() {
  if (!process.env.ELEVEN_API_KEY) throw new Error("thiếu ELEVEN_API_KEY");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const clipsDir = path.join(OUT_DIR, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  // 1) sub Việt
  const viSegs = await loadViSegs(BASE);
  console.log(`[subdub] ${viSegs.length} câu Việt`);

  // 1b) Gemini gán tag cảm xúc từng câu (Plan A) -> chèn [tag] vào text v3.
  const emoPath = path.join(OUT_DIR, "emotions.json");
  let tags;
  if (fs.existsSync(emoPath)) {
    tags = JSON.parse(fs.readFileSync(emoPath, "utf8"));
    console.log("[subdub] dùng emotions.json local");
  } else {
    await db.connect();
    await db.loadSettings();
    const cfg = buildSubtitleConfig(global.settingJSON);
    tags = await tagEmotions(viSegs, { apiKey: cfg.apiKey, model: cfg.geminiModel });
    await db.mongoose.disconnect();
    fs.writeFileSync(emoPath, JSON.stringify(tags, null, 2));
  }
  console.log(`[subdub] cảm xúc: ${tags.filter(Boolean).length}/${tags.length} câu có tag (${[...new Set(tags.filter(Boolean))].join(", ")})`);

  // 2) video ĐÃ CÓ SUB (tải từ R2 nếu chưa có local)
  const subbed = path.join(OUT_DIR, `${BASE}_subbed.mp4`);
  if (!fs.existsSync(subbed)) {
    const url = `${env.r2.publicBase}/videos/${BASE}.mp4`;
    console.log(`[subdub] tải video có sub: ${url}`);
    const { data } = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
    fs.writeFileSync(subbed, Buffer.from(data));
  }

  // 3) nền sạch (demucs) — tái dùng nếu đã có
  const bg = path.join(OUT_DIR, "sep", "htdemucs", "orig", "no_vocals.wav");
  if (!fs.existsSync(bg)) {
    const wav = path.join(OUT_DIR, "orig.wav");
    console.log("[subdub] trích audio + demucs tách nền...");
    await run("ffmpeg", ["-y", "-i", subbed, "-vn", "-ac", "2", "-ar", "44100", wav]);
    await run(DEMUCS_PY, ["-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", path.join(OUT_DIR, "sep"), wav], { timeout: 20 * 60 * 1000 });
  }
  if (!fs.existsSync(bg)) throw new Error("không có no_vocals.wav");
  console.log("[subdub] nền sạch OK");

  // 4) TTS từng câu (tái dùng clip đã có), time-fit nhẹ
  const clips = [];
  for (let i = 0; i < viSegs.length; i++) {
    const s = viSegs[i];
    const text = String(s.text || "").trim();
    if (!text) continue;
    const nextStart = i + 1 < viSegs.length ? (viSegs[i + 1].start || 0) : (s.end || 0) + 2;
    const slot = Math.max(0.6, nextStart - (s.start || 0));
    const mp3 = path.join(clipsDir, `c${i}.mp3`);
    if (!fs.existsSync(mp3)) {
      const emo = tags[i] ? `[${tags[i]}] ` : ""; // chèn tag cảm xúc v3 (không đọc thành lời)
      process.stdout.write(`\r[subdub] TTS ${i + 1}/${viSegs.length}   `);
      fs.writeFileSync(mp3, await tts(emo + text, { apiKey: process.env.ELEVEN_API_KEY, voiceId: VOICE }));
    }
    const dur = await probeDur(mp3);
    const atempo = dur > slot ? Math.min(MAX_ATEMPO, +(dur / slot).toFixed(3)) : 1;
    clips.push({ file: mp3, startMs: Math.round((s.start || 0) * 1000), atempo });
  }
  console.log(`\n[subdub] ${clips.length} clip sẵn`);

  // 5) mux: video CÓ SUB (0:v) + nền sạch (1) + clip Việt -> final
  const inputs = ["-i", subbed, "-i", bg];
  clips.forEach((c) => inputs.push("-i", c.file));
  const parts = [`[1:a]volume=${BG_VOL}[bg]`];
  const labels = ["[bg]"];
  clips.forEach((c, k) => {
    const idx = k + 2;
    const speed = c.atempo > 1 ? `atempo=${c.atempo},` : "";
    const chain = `${speed}volume=${VOICE_VOL},adelay=${c.startMs}:all=1`; // tăng giọng + đặt đúng giờ
    parts.push(`[${idx}:a]${chain}[c${k}]`);
    labels.push(`[c${k}]`);
  });
  // amix rồi LIMITER chặn đỉnh (giọng ×2.5 dễ vượt 0dBFS -> méo). Giới hạn ~-1dBFS.
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[mix]`);
  parts.push(`[mix]alimiter=limit=0.9:attack=5:release=50[aout]`);
  const filterFile = path.join(OUT_DIR, "filter_subdub.txt");
  fs.writeFileSync(filterFile, parts.join(";\n"));

  const outFile = path.join(OUT_DIR, `${BASE}_subdub.mp4`);
  console.log("[subdub] ghép video(sub) + nền + giọng Việt...");
  await run("ffmpeg", ["-y", ...inputs, "-filter_complex_script", filterFile, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outFile]);
  console.log(`\n✅ XONG (Vietsub + Vietdub) -> ${outFile}`);
}

main().catch((e) => { console.error("\n[subdub] LỖI:", e.message); process.exit(1); });
