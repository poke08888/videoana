// Chẩn đoán: đối chiếu cờ subLang với sự thật OCR (có vietsub thật không).
// Lấy mẫu tập subLang!=vi (đang bị gắn cờ) + tập subLang=vi (không gắn) -> OCR -> báo vi/cn.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const mongoose = require("mongoose");
const { env } = require("./../config");

const OCR_PY = process.env.OCR_PYTHON || "python3";
const SCAN_PY = path.join(__dirname, "ocr_scan.py");
const FRAMES = 8;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 200)));
      resolve(stdout);
    });
  });
}
async function probeDur(url) {
  try { return parseFloat(String(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", url], { timeout: 40000 })).trim()) || 0; }
  catch { return 0; }
}
async function grab(url, t, out) {
  await run("ffmpeg", ["-y", "-ss", String(t), "-i", url, "-frames:v", "1", "-vf", "crop=iw:ih*0.42:0:ih*0.58", "-q:v", "3", out], { timeout: 50000 });
}

async function main() {
  await mongoose.connect(process.env.MongoDb_Connection_String, { serverSelectionTimeoutMS: 15000 });
  const conn = mongoose.connection.db;
  const flagged = await conn.collection("shortvideos").find({ sourceProvider: /52api/, subLang: { $ne: "vi" } }).project({ videoUrl: 1, subLang: 1 }).toArray();
  const notFlagged = await conn.collection("shortvideos").aggregate([{ $match: { sourceProvider: /52api/, subLang: "vi" } }, { $sample: { size: 15 } }, { $project: { videoUrl: 1, subLang: 1 } }]).toArray();
  await mongoose.disconnect();

  const all = [...flagged.map((x) => ({ ...x, flag: "subLang≠vi (BÁO trống)" })), ...notFlagged.map((x) => ({ ...x, flag: "subLang=vi (KHÔNG báo)" }))];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diag-"));
  const manifest = {};
  const meta = {};
  for (const s of all) {
    const base = (s.videoUrl || "").split("/").pop().replace(/\.mp4$/, "");
    if (!base) continue;
    meta[base] = s.flag;
    const url = `${env.r2.publicBase}/videos/${base}.mp4`;
    const dur = await probeDur(url);
    const files = [];
    if (dur) for (let i = 0; i < FRAMES; i++) {
      const f = path.join(tmp, `${base}__${i}.png`);
      try { await grab(url, dur * (0.1 + 0.8 * i / (FRAMES - 1)), f); if (fs.existsSync(f)) files.push(f); } catch {}
    }
    manifest[base] = files;
    process.stderr.write(`\r  trích ${base}    `);
  }
  const manFile = path.join(tmp, "m.json");
  fs.writeFileSync(manFile, JSON.stringify(manifest));
  console.error("\nOCR...");
  const ocr = JSON.parse(await run(OCR_PY, [SCAN_PY, manFile], { timeout: 20 * 60 * 1000 }));
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("\n=== ĐỐI CHIẾU cờ subLang vs OCR thật ===");
  for (const base of Object.keys(ocr)) {
    const r = ocr[base];
    const hasVi = r.vi >= 1;
    const mismatch = (meta[base].includes("BÁO trống") && hasVi) || (meta[base].includes("KHÔNG báo") && !hasVi);
    console.log(`${mismatch ? "❌SAI" : "  ok "} | ${meta[base]} | OCR vi=${r.vi} cn=${r.cn} empty=${r.empty} | ${base}`);
  }
}
main().catch((e) => { console.error("LỖI", e.message); process.exit(1); });
