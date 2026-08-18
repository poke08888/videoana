// Test pipeline sub (OCR/whisper + Gemini) trên file mp4 local — KHÔNG ghi Mongo, KHÔNG up R2.
// Dùng: node scripts/test-dongli-pipeline.js <input.mp4> <output.mp4>
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env, buildSubtitleConfig } = require("../config");
const { subtitleVideoBuffer } = require("../util/autosub");

(async () => {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile) { console.error("thiếu input.mp4"); process.exit(1); }
  const out = outFile || inFile.replace(/\.mp4$/, "_vi.mp4");

  // Lấy setting.subtitle từ Mongo server (giống worker thật)
  await mongoose.connect(env.mongoUri);
  const Setting = require("../models/setting.model");
  const s = await Setting.findOne().lean();
  global.settingJSON = s;
  const cfg = buildSubtitleConfig(s);
  console.log("subtitleSource:", (s.subtitle || {}).subtitleSource || "ocr");
  console.log("gemini:", cfg.geminiModel, "| ocrFps:", (s.subtitle || {}).ocrFps, "| cover:", cfg.coverEnabled);

  const t0 = Date.now();
  const buf = fs.readFileSync(inFile);
  console.log(`\n▶ render ${path.basename(inFile)} (${(buf.length / 1048576).toFixed(1)}MB)…`);

  const r = await subtitleVideoBuffer(buf, cfg);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.subbed) {
    fs.writeFileSync(out, r.buffer);
    console.log(`\n✅ OK — ${r.segments} câu sub, ${secs}s, out=${out} (${(r.buffer.length / 1048576).toFixed(1)}MB)`);
    fs.writeFileSync(out.replace(/\.mp4$/, ".vi.json"), JSON.stringify(r.viSegs, null, 2));
    console.log("   5 câu đầu:");
    for (const v of (r.viSegs || []).slice(0, 5)) {
      console.log(`   [${Number(v.start).toFixed(1)}-${Number(v.end).toFixed(1)}] ${v.text}`);
    }
  } else {
    console.log(`\n❌ KHÔNG ra sub sau ${secs}s — lý do: ${r.reason}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
