// POC: lấy 1 tập netshort (short-drama-pro RapidAPI) -> tải mp4 sạch + VTT (id) -> dịch id->vi
// (Gemini) -> burn sub Việt (KHÔNG cần OCR, KHÔNG hộp che). Xuất file local để xem.
// Dùng: node poc/netshort.js [dramaId] [epNo]
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const db = require("./../db");
const { env, buildSubtitleConfig } = require("./../config");
const { translateSegments } = require("./../util/translate");
const { buildAss, probeDimensions } = require("./../util/subtitle");
const { transcodeBurnSub } = require("./../util/transcode");

const KEY = process.env.RAPIDAPI_KEY || "cee31f2c99msh445c5332f542ae1p17d985jsnada158cf3717";
const HOST = "short-drama-pro.p.rapidapi.com";
const DRAMA = process.argv[2] || "2074786583708323841";
const EP = process.argv[3] || "1";
const OUT_DIR = process.env.POC_OUT || path.join(env.workDir, "dub-poc");

const api = (p) => axios.get(`https://${HOST}${p}`, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST }, timeout: 30000, validateStatus: () => true });

// VTT -> [{start,end,text}] (giây).
function parseVtt(vtt) {
  const toSec = (t) => {
    const m = t.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
    if (!m) return 0;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+("0." + m[4]));
  };
  const segs = [];
  for (const block of String(vtt).replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n").filter((l) => l && !/^WEBVTT/i.test(l) && !/^NOTE/i.test(l));
    const tl = lines.find((l) => l.includes("-->"));
    if (!tl) continue;
    const [a, b] = tl.split("-->");
    const text = lines.slice(lines.indexOf(tl) + 1).join(" ").trim();
    if (text) segs.push({ start: toSec(a), end: toSec(b), text });
  }
  return segs;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await db.connect();
  await db.loadSettings();
  const cfg = buildSubtitleConfig(global.settingJSON);

  // 1) detail + episode
  const det = await api(`/netshort/api/v1/detail/${DRAMA}`);
  const title = det.data?.data?.title || DRAMA;
  console.log(`[netshort] phim: ${title} | tập ${EP}`);
  const e = await api(`/netshort/api/v1/episode/${DRAMA}/${EP}`);
  const d = e.data?.data;
  if (!d || !d.videos?.length) throw new Error("tập không có video: " + JSON.stringify(e.data).slice(0, 200));
  const video = (d.videos.find((v) => v.quality === "720p") || d.videos[0]);
  const sub = (d.subtitles || []).find((s) => /webvtt|vtt/i.test(s.format)) || d.subtitles?.[0];
  if (!sub) throw new Error("tập không có phụ đề");
  console.log(`[netshort] video ${video.quality} + sub ${sub.language}`);

  // 2) tải mp4 sạch
  const raw = path.join(OUT_DIR, `netshort_${DRAMA}_ep${EP}.mp4`);
  if (!fs.existsSync(raw)) {
    console.log("[netshort] tải mp4...");
    const r = await axios.get(video.url, { responseType: "arraybuffer", timeout: 120000 });
    fs.writeFileSync(raw, Buffer.from(r.data));
  }

  // 3) VTT -> segments
  const vtt = await axios.get(sub.url, { timeout: 30000, transformResponse: (x) => x });
  const idSegs = parseVtt(vtt.data);
  console.log(`[netshort] ${idSegs.length} câu (${sub.language})`);

  // 4) dịch id -> vi (Gemini)
  console.log("[netshort] dịch sang tiếng Việt...");
  const viSegs = await translateSegments(idSegs, { apiKey: cfg.apiKey, model: cfg.geminiModel, sourceLang: "tiếng Indonesia", targetLang: "vi" });
  await db.mongoose.disconnect();

  // 5) build ASS + burn (video SẠCH -> KHÔNG hộp che)
  const dims = await probeDimensions(raw);
  const assF = path.join(OUT_DIR, `netshort_${DRAMA}_ep${EP}.ass`);
  buildAss(viSegs, { width: dims.width, height: dims.height, assPath: assF }); // không chineseBottomRatio
  console.log("[netshort] burn sub Việt (không hộp che)...");
  const out = await transcodeBurnSub(raw, assF, { enabled: false });
  const outFile = path.join(OUT_DIR, `netshort_${DRAMA}_ep${EP}_vietsub.mp4`);
  fs.writeFileSync(outFile, out);
  console.log(`\n✅ XONG -> ${outFile}`);
  console.log(`   (${viSegs.length} câu Việt, video sạch ${dims.width}x${dims.height})`);
}

main().catch((e) => { console.error("[netshort] LỖI:", e.message); process.exit(1); });
