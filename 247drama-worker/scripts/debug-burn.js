// Debug bước burn sub: chạy OCR+dịch 1 lần rồi CACHE, giữ lại .ass, in FULL stderr ffmpeg.
// Dùng: node scripts/debug-burn.js <input.mp4> [outdir]
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const mongoose = require("mongoose");
const { env, buildSubtitleConfig } = require("../config");
const { ocrSubtitles } = require("../util/asrOcr");
const { translateSegments } = require("../util/translate");
const { probeDimensions, buildAss } = require("../util/subtitle");

const cleanOcrSegs = (segs) =>
  (segs || []).filter((s) => s && s.text && /[一-鿿]/.test(s.text) && s.text.replace(/\s/g, "").length >= 2);

(async () => {
  const inFile = process.argv[2];
  const outDir = process.argv[3] || path.join(process.env.HOME, "Downloads", "dongli-test");
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(inFile, ".mp4");
  const cacheF = path.join(outDir, `${base}.segs.json`);
  const assF = path.join(outDir, `${base}.ass`);
  const outF = path.join(outDir, `${base}_vi.mp4`);

  await mongoose.connect(env.mongoUri);
  const Setting = require("../models/setting.model");
  const s = await Setting.findOne().lean();
  global.settingJSON = s;
  const cfg = buildSubtitleConfig(s);
  await mongoose.disconnect();

  const dims = await probeDimensions(inFile);
  console.log("dims:", dims);

  let viSegs, chineseBottomRatio;
  if (fs.existsSync(cacheF)) {
    const c = JSON.parse(fs.readFileSync(cacheF, "utf8"));
    viSegs = c.viSegs; chineseBottomRatio = c.chineseBottomRatio;
    console.log(`↻ dùng cache: ${viSegs.length} câu`);
  } else {
    console.log("▶ OCR…");
    const t0 = Date.now();
    const ocr = await ocrSubtitles(inFile);
    const zhSegs = cleanOcrSegs(ocr.segments);
    chineseBottomRatio = ocr.chineseBottomRatio;
    console.log(`  OCR: ${zhSegs.length} câu Trung, bottomRatio=${chineseBottomRatio}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log("▶ Gemini dịch…");
    viSegs = await translateSegments(zhSegs, {
      apiKey: cfg.apiKey, model: cfg.geminiModel,
      sourceLang: cfg.sourceLang, targetLang: cfg.targetLang, batchSize: cfg.translateBatchSize,
    });
    fs.writeFileSync(cacheF, JSON.stringify({ viSegs, chineseBottomRatio }, null, 2));
    console.log(`  dịch xong: ${viSegs.length} câu -> cache ${cacheF}`);
  }

  buildAss(viSegs, { ...dims, assPath: assF, chineseBottomRatio });
  console.log(`✎ .ass: ${assF} (${fs.statSync(assF).size} bytes)`);

  const drawbox = cfg.coverEnabled === false ? "" :
    `drawbox=x=0:y=ih*${cfg.coverBoxYRatio}:w=iw:h=ih*${cfg.coverBoxHeightRatio}:color=${cfg.coverBoxColor}:t=fill,`;
  const vf = `${drawbox}ass=${assF}`;
  console.log(`▶ ffmpeg -vf "${vf}"`);

  execFile("ffmpeg", [
    "-y", "-i", inFile, "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outF,
  ], { maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60 * 1000 }, (err, so, se) => {
    if (err) {
      console.log("\n❌ FFMPEG LỖI — 40 dòng cuối stderr:");
      console.log(String(se || err.message).split("\n").slice(-40).join("\n"));
      process.exit(1);
    }
    console.log(`\n✅ OK -> ${outF} (${(fs.statSync(outF).size / 1048576).toFixed(1)}MB)`);
  });
})().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
