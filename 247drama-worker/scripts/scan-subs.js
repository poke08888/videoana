// Quét tập không sub / còn sub Trung cho 1 hay nhiều phim (theo bookId).
// Trích khung hàng loạt (ffmpeg range-request) -> OCR 1 mẻ (ocr_scan.py) -> phân loại -> report JSON.
// Dùng: node scripts/scan-subs.js <bookId1> [bookId2 ...]
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const mongoose = require("mongoose");
const { env } = require("./../config");

const OCR_PY = process.env.OCR_PYTHON || "python3";
const SCAN_PY = path.join(__dirname, "ocr_scan.py");
const FRAMES = 6;          // khung/tập
const GRAB_CONC = 4;       // ffmpeg song song
const REPORT = path.join(env.tmpDir, "sub-scan-report.json");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 200)));
      resolve(stdout);
    });
  });
}
async function probeDur(url) {
  try {
    const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", url], { timeout: 40000 });
    return parseFloat(String(out).trim()) || 0;
  } catch (e) { return 0; }
}
async function grabFrame(url, t, out) {
  await run("ffmpeg", ["-y", "-ss", String(t), "-i", url, "-frames:v", "1",
    "-vf", "crop=iw:ih*0.38:0:ih*0.60", "-q:v", "3", out], { timeout: 50000 });
}
async function pool(items, conc, fn) {
  const res = []; let i = 0;
  const workers = Array.from({ length: conc }, async () => {
    while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return res;
}

function classify(r) {
  if (!r) return "LỖI";
  if (r.cn >= 2 && r.cn >= r.vi) return "SUB_TRUNG";
  if (r.vi >= 2) return "CÓ_VIETSUB";
  return "KHÔNG_SUB";
}

async function main() {
  const books = process.argv.slice(2);
  if (!books.length) { console.error("cần bookId"); process.exit(1); }
  await mongoose.connect(process.env.MongoDb_Connection_String, { serverSelectionTimeoutMS: 15000 });
  const conn = mongoose.connection.db;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "subscan-"));
  const manifest = {};
  const meta = {}; // base -> {movie, ep, id}

  for (const bk of books) {
    const ms = await conn.collection("movieseries").findOne({ bookId: bk });
    if (!ms) { console.error("bỏ qua, không có phim:", bk); continue; }
    const eps = await conn.collection("shortvideos").find({ movieSeries: ms._id }).sort({ episodeNumber: 1 }).toArray();
    console.error(`\n[${ms.name}] ${eps.length} tập — trích khung...`);
    await pool(eps, GRAB_CONC, async (e) => {
      const base = (e.videoUrl || "").split("/").pop().replace(/\.mp4$/, "");
      if (!base) return;
      const url = `${env.r2.publicBase}/videos/${base}.mp4`;
      meta[base] = { movie: ms.name, ep: e.episodeNumber, id: e._id.toString() };
      const dur = await probeDur(url);
      if (!dur) { manifest[base] = []; return; }
      const files = [];
      for (let i = 0; i < FRAMES; i++) {
        const t = dur * (0.1 + (0.8 * i) / (FRAMES - 1));
        const f = path.join(tmp, `${base}__${i}.png`);
        try { await grabFrame(url, t, f); if (fs.existsSync(f)) files.push(f); } catch (x) {}
      }
      manifest[base] = files;
      process.stderr.write(`\r  ${base} (${files.length} khung)      `);
    });
  }
  await mongoose.disconnect();

  const manFile = path.join(tmp, "manifest.json");
  fs.writeFileSync(manFile, JSON.stringify(manifest));
  console.error("\n\nOCR cả mẻ...");
  const out = await run(OCR_PY, [SCAN_PY, manFile], { timeout: 30 * 60 * 1000 });
  const ocr = JSON.parse(out);
  fs.rmSync(tmp, { recursive: true, force: true });

  const rows = Object.keys(ocr).map((base) => ({ base, ...meta[base], verdict: classify(ocr[base]), ...ocr[base] }));
  rows.sort((a, b) => (a.movie || "").localeCompare(b.movie || "") || (a.ep - b.ep));
  const bad = rows.filter((r) => r.verdict === "SUB_TRUNG" || r.verdict === "KHÔNG_SUB");
  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), rows, bad }, null, 2));

  const byMovie = {};
  for (const r of rows) (byMovie[r.movie] ||= []).push(r);
  for (const m of Object.keys(byMovie)) {
    const g = byMovie[m];
    const st = { CÓ_VIETSUB: 0, SUB_TRUNG: 0, KHÔNG_SUB: 0, LỖI: 0 };
    g.forEach((r) => st[r.verdict]++);
    console.log(`\n### ${m}`);
    console.log(`   OK=${st["CÓ_VIETSUB"]}  SUB_TRUNG=${st.SUB_TRUNG}  KHÔNG_SUB=${st["KHÔNG_SUB"]}  lỗi=${st["LỖI"]}`);
    console.log("   SUB_TRUNG (render lại): " + (g.filter(r => r.verdict === "SUB_TRUNG").map(r => r.ep).join(", ") || "—"));
    console.log("   KHÔNG_SUB (xoá):        " + (g.filter(r => r.verdict === "KHÔNG_SUB").map(r => r.ep).join(", ") || "—"));
  }
  console.log(`\nReport: ${REPORT}  |  tổng tập lỗi: ${bad.length}`);
}

main().catch((e) => { console.error("LỖI", e.message); process.exit(1); });
