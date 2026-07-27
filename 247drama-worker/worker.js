// Bắt buộc file tạm nằm trên BINGNET (autosub/transcode dùng os.tmpdir()).
const fs = require("fs");
const { env } = require("./config");
process.env.TMPDIR = env.tmpDir;

const pLimit = require("p-limit");
const db = require("./db");
const { findPendingWork } = require("./work");
const { renderEpisode } = require("./render");

async function main() {
  // Fail-fast: đảm bảo thư mục làm việc tồn tại (nếu ổ ngoài BINGNET chưa mount thì dừng ngay,
  // tránh tải + OCR + DỊCH (tốn quota Gemini) rồi mới chết ở bước ghi file).
  for (const d of [env.downloadDir, env.tmpDir, env.outputDir]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch (e) {
      console.error(`[worker] không tạo được ${d} — ổ BINGNET đã mount chưa?`, e.message);
      process.exit(1);
    }
  }

  await db.connect();
  await db.loadSettings();
  console.log(`[worker] concurrency=${env.concurrency}, ocrThreads=${env.ocrThreads}, tmp=${env.tmpDir}`);

  const work = await findPendingWork();
  const totalMissing = work.reduce((n, w) => n + w.missing.length, 0);
  console.log(`[worker] ${work.length} phim, ${totalMissing} tập cần render`);
  if (!totalMissing) { await db.mongoose.disconnect(); return; }

  const limit = pLimit(env.concurrency);
  let done = 0, ok = 0, fail = 0;

  const jobs = [];
  for (const it of work) {
    // Cập nhật tổng số tập nguồn (khớp process52apiEpisodes) — 1 lần/phim.
    await db.MovieSeries.updateOne({ _id: it.series._id }, { $set: { sourceEpisodeCount: it.episodes.length } }).catch(() => {});
    for (const ep of it.missing) {
      jobs.push(limit(async () => {
        const r = await renderEpisode({ series: it.series, provider: it.provider, sourceId: it.sourceId, ep });
        done++; r.ok ? ok++ : fail++;
        if (done % 5 === 0 || done === totalMissing) console.log(`[worker] tiến độ ${done}/${totalMissing} (ok ${ok}, lỗi ${fail})`);
      }));
    }
  }
  await Promise.all(jobs);

  console.log(`[worker] XONG: ${ok} tập ok, ${fail} lỗi / ${totalMissing}`);
  await db.mongoose.disconnect();
}

main().catch((e) => { console.error("[worker] fatal:", e); process.exit(1); });
