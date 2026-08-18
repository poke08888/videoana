// Chạy TRỌN 1 bộ phim từ 东梨 qua pipeline sub (OCR + Gemini) — LOCAL ONLY.
// KHÔNG ghi Mongo, KHÔNG up R2. Output: <outdir>/ep<NN>_vi.mp4 + .vi.json
// Dùng: node scripts/run-dongli-series.js <dramaId> [outdir] [concurrency] [maxEps]
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const mongoose = require("mongoose");
const pLimit = require("p-limit");
const { env, buildSubtitleConfig } = require("../config");
const { subtitleVideoBuffer } = require("../util/autosub");

const API_KEY = process.env.DUANJU_KEY || "KeXgHY5fjRL8V2WLCHeFatULcG";
const API = "https://www.52api.cn/api/dongli";

const getJson = (url) =>
  new Promise((res, rej) => {
    https.get(url, { timeout: 40000 }, (r) => {
      let d = ""; r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error("parse: " + d.slice(0, 200))); } });
    }).on("error", rej);
  });

const download = (url) =>
  new Promise((res, rej) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { timeout: 180000, headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
      if (r.statusCode !== 200) return rej(new Error("HTTP " + r.statusCode));
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => res(Buffer.concat(chunks)));
    }).on("error", rej);
  });

(async () => {
  const dramaId = process.argv[2];
  const outDir = process.argv[3] || path.join(process.env.HOME, "Downloads", "dongli-series");
  const conc = parseInt(process.argv[4]) || 3;
  const maxEps = parseInt(process.argv[5]) || 0;
  if (!dramaId) { console.error("thiếu dramaId"); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });

  await mongoose.connect(env.mongoUri);
  const Setting = require("../models/setting.model");
  const s = await Setting.findOne().lean();
  global.settingJSON = s;
  const cfg = buildSubtitleConfig(s);
  await mongoose.disconnect();

  console.log(`▶ detail id=${dramaId}…`);
  const j = await getJson(`${API}?key=${API_KEY}&type=detail&id=${dramaId}`);
  if (j.code !== 200) throw new Error(`API code=${j.code} msg=${j.msg}`);
  const d = j.data;
  let lists = d.lists || [];
  if (maxEps) lists = lists.slice(0, maxEps);
  console.log(`   "${d.title}" — ${d.total} tập, sẽ render ${lists.length} tập, link hết hạn ${lists[0].video_expiry_time}`);
  fs.writeFileSync(path.join(outDir, "detail.json"), JSON.stringify(d, null, 2));

  const t0 = Date.now();
  let done = 0, subbed = 0, failed = 0;
  const limit = pLimit(conc);

  await Promise.all(lists.map((ep) => limit(async () => {
    const n = String(ep.index).padStart(2, "0");
    const outF = path.join(outDir, `ep${n}_vi.mp4`);
    if (fs.existsSync(outF)) { done++; subbed++; console.log(`⏭  ep${n} đã có, bỏ qua`); return; }
    const t = Date.now();
    try {
      const buf = await download(ep.video_url);
      const r = await subtitleVideoBuffer(buf, cfg);
      fs.writeFileSync(outF, r.buffer);
      if (r.viSegs) fs.writeFileSync(path.join(outDir, `ep${n}.vi.json`), JSON.stringify(r.viSegs, null, 2));
      done++;
      if (r.subbed) { subbed++; } else { failed++; }
      const secs = ((Date.now() - t) / 1000).toFixed(0);
      console.log(
        `${r.subbed ? "✅" : "⚠️ "} ep${n} ${r.subbed ? r.segments + " câu" : "KHÔNG sub: " + r.reason.slice(0, 90)}` +
        ` | ${secs}s | ${done}/${lists.length}`,
      );
    } catch (e) {
      failed++; done++;
      console.log(`❌ ep${n} LỖI: ${e.message.slice(0, 120)} | ${done}/${lists.length}`);
    }
  })));

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n━━━ XONG: ${subbed}/${lists.length} tập có sub Việt, ${failed} lỗi, ${mins} phút ━━━`);
  console.log(`Output: ${outDir}`);
})().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
