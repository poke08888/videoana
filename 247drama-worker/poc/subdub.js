// 1 VIDEO CÓ CẢ VIETSUB (chữ, đã burn) + VIETDUB (đa giọng TTS, nền tách demucs).
// Hình lấy từ video ĐÃ RENDER (có sub Việt) trên R2; tiếng = nền sạch + TTS từ SUB VIỆT.
// Phân vai (casting.js): mỗi nhân vật 1 giọng; cảm xúc -> voice_settings. Timing KHÔNG chồng câu.
// Dùng: node poc/subdub.js [base_name]
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const axios = require("axios");
const db = require("./../db");
const { env, buildSubtitleConfig } = require("./../config");
const { tts } = require("./elevenlabs");
const { buildCasting } = require("./casting");

const BASE = process.argv[2] || "hg_7650805046258453528_ep0";
const OUT_DIR = process.env.POC_OUT || path.join(env.workDir, "dub-poc");
const DEMUCS_PY = process.env.DEMUCS_PYTHON || path.join(env.workDir, "demucs-venv/bin/python");
const BG_VOL = process.env.BG_VOL || "0.55";
const VOICE_VOL = process.env.VOICE_VOL || "2.2";
const MAX_ATEMPO = 1.15;   // giãn nhẹ cho tự nhiên (trước là 1.3 -> nói vội)
const GAP_MS = 120;        // khe thở giữa 2 câu, không cho dính tiếng

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
  const clipsDir = path.join(OUT_DIR, "clips2"); // dir mới: đa giọng, không đụng clip cũ 1-giọng
  fs.mkdirSync(clipsDir, { recursive: true });

  // 1) sub Việt
  const viSegs = await loadViSegs(BASE);
  console.log(`[subdub] ${viSegs.length} câu Việt`);

  // 1b) casting: phân vai (giọng theo nhân vật) + cảm xúc (voice_settings). Cache casting.json.
  const castPath = path.join(OUT_DIR, "casting.json");
  let cast;
  if (fs.existsSync(castPath)) {
    cast = JSON.parse(fs.readFileSync(castPath, "utf8"));
    console.log("[subdub] dùng casting.json local");
  } else {
    await db.connect();
    await db.loadSettings();
    const cfg = buildSubtitleConfig(global.settingJSON);
    cast = await buildCasting(viSegs, { apiKey: cfg.apiKey, model: cfg.geminiModel });
    await db.mongoose.disconnect();
    fs.writeFileSync(castPath, JSON.stringify(cast, null, 2));
  }
  console.log("[subdub] DÀN GIỌNG:");
  cast.summary.forEach((s) => console.log("   " + s));

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

  // 4) TTS từng câu: giọng + voice_settings theo casting. Cache theo (index, voiceId).
  const raw = [];
  for (let i = 0; i < viSegs.length; i++) {
    const s = viSegs[i];
    const text = String(s.text || "").trim();
    if (!text) continue;
    const c = cast.plan[i] || {};
    const voiceId = c.voiceId || process.env.ELEVEN_VOICE_ID;
    const mp3 = path.join(clipsDir, `c${i}_${voiceId}.mp3`);
    if (!fs.existsSync(mp3)) {
      process.stdout.write(`\r[subdub] TTS ${i + 1}/${viSegs.length} (${c.char || "?"}/${c.emotion || "neutral"})        `);
      // v3: cảm xúc qua AUDIO TAG chèn đầu câu (không đọc thành lời). neutral -> không chèn.
      const ttsText = c.emotion && c.emotion !== "neutral" ? `[${c.emotion}] ${text}` : text;
      const buf = await tts(ttsText, {
        apiKey: process.env.ELEVEN_API_KEY,
        voiceId,
        stability: c.stability ?? 0.5,
        style: c.style ?? 0.0,
      });
      fs.writeFileSync(mp3, buf);
    }
    const dur = await probeDur(mp3);
    raw.push({ file: mp3, start: s.start || 0, dur });
  }
  console.log(`\n[subdub] ${raw.length} clip sẵn`);

  // 4b) TIMING KHÔNG CHỒNG CÂU: đặt clip tại start, nếu tràn -> giãn atempo nhẹ (<=1.15),
  // còn tràn thì ĐẨY câu sau trễ lại (cursor). Luôn chèn khe GAP_MS. Không bao giờ đè tiếng.
  const clips = [];
  let cursor = 0; // ms — mốc sớm nhất câu kế được phép bắt đầu
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const startMs = Math.max(Math.round(r.start * 1000), cursor);
    const nextStartMs = i + 1 < raw.length ? Math.round(raw[i + 1].start * 1000) : startMs + Math.round(r.dur * 1000) + 999999;
    const slotMs = nextStartMs - startMs - GAP_MS; // chỗ trống tới câu kế (đã trừ khe thở)
    const durMs = r.dur * 1000;
    let atempo = 1;
    if (durMs > slotMs && slotMs > 0) atempo = Math.min(MAX_ATEMPO, +(durMs / slotMs).toFixed(3));
    const effMs = Math.round(durMs / atempo);
    clips.push({ file: r.file, startMs, atempo });
    cursor = startMs + effMs + GAP_MS;
  }

  // 5) mux: video CÓ SUB (0:v) + nền sạch (1) + clip Việt -> final
  const inputs = ["-i", subbed, "-i", bg];
  clips.forEach((c) => inputs.push("-i", c.file));
  const parts = [`[1:a]volume=${BG_VOL}[bg]`];
  const labels = ["[bg]"];
  clips.forEach((c, k) => {
    const idx = k + 2;
    const speed = c.atempo > 1 ? `atempo=${c.atempo},` : "";
    parts.push(`[${idx}:a]${speed}volume=${VOICE_VOL},adelay=${c.startMs}:all=1[c${k}]`);
    labels.push(`[c${k}]`);
  });
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[mix]`);
  parts.push(`[mix]alimiter=limit=0.9:attack=5:release=50[aout]`);
  const filterFile = path.join(OUT_DIR, "filter_subdub.txt");
  fs.writeFileSync(filterFile, parts.join(";\n"));

  const outFile = path.join(OUT_DIR, `${BASE}_subdub.mp4`);
  console.log("[subdub] ghép video(sub) + nền + giọng Việt đa vai...");
  await run("ffmpeg", ["-y", ...inputs, "-filter_complex_script", filterFile, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outFile]);
  console.log(`\n✅ XONG (Vietsub + Vietdub đa giọng) -> ${outFile}`);
}

main().catch((e) => { console.error("\n[subdub] LỖI:", e.message); process.exit(1); });
