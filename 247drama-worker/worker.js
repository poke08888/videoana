// Bắt buộc file tạm nằm trên BINGNET (autosub/transcode dùng os.tmpdir()).
const { env } = require("./config");
process.env.TMPDIR = env.tmpDir;

const pLimit = require("p-limit");
const db = require("./db");
const { findPendingWork } = require("./work");
const { renderEpisode } = require("./render");

async function main() {
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
    for (const ep of it.missing) {
      jobs.push(limit(async () => {
        // Cập nhật tổng số tập nguồn (khớp process52apiEpisodes) — chạy 1 lần/phim là đủ, updateOne rẻ.
        await db.MovieSeries.updateOne({ _id: it.series._id }, { $set: { sourceEpisodeCount: it.episodes.length } }).catch(() => {});
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
