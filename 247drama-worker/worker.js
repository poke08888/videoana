// Bắt buộc file tạm nằm trên BINGNET (autosub/transcode dùng os.tmpdir()).
const fs = require("fs");
const { env } = require("./config");
process.env.TMPDIR = env.tmpDir;

const pLimit = require("p-limit");
const db = require("./db");
const { findPendingWork } = require("./work");
const { renderEpisode } = require("./render");

async function main() {
  // Fail-fast: nếu workDir nằm trên /Volumes (ổ ngoài) thì XÁC MINH đã mount thật, KHÔNG chỉ mkdir.
  // Vì mkdir -p sẽ "thành công" bằng cách tạo thư mục trên ổ CHÍNH khi ổ ngoài chưa mount ->
  // media đổ vào ổ chính (đang đầy 91%). So st_dev với "/" để phát hiện chưa mount.
  if (env.workDir.startsWith("/Volumes/")) {
    const mountRoot = env.workDir.split("/").slice(0, 3).join("/"); // /Volumes/<tên>
    let mountDev;
    try {
      mountDev = fs.statSync(mountRoot).dev;
    } catch (e) {
      console.error(`[worker] ${mountRoot} không tồn tại — ổ ngoài chưa mount. Dừng.`);
      process.exit(1);
    }
    if (mountDev === fs.statSync("/").dev) {
      console.error(`[worker] ${mountRoot} cùng thiết bị với "/" -> chưa mount ổ ngoài. Dừng (tránh ghi lên ổ chính).`);
      process.exit(1);
    }
  }
  // Ổ ngoài đã mount (hoặc workDir trên ổ chính do cấu hình): tạo thư mục làm việc.
  for (const d of [env.downloadDir, env.tmpDir, env.outputDir]) {
    fs.mkdirSync(d, { recursive: true });
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
