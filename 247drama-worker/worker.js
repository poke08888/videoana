// Bắt buộc file tạm nằm trên BINGNET (autosub/transcode dùng os.tmpdir()).
const fs = require("fs");
const { env } = require("./config");
process.env.TMPDIR = env.tmpDir;

const pLimit = require("p-limit");
const db = require("./db");
const { findPendingWork, extract52apiSource } = require("./work");
const { renderEpisode } = require("./render");
const status = require("./status");

// Daemon: quét việc mỗi POLL_INTERVAL_SEC (mặc định 120s) -> phim/tập mới add trên
// admin server tự được nhặt mà KHÔNG cần restart tay.
const POLL_SEC = Math.max(30, parseInt(process.env.POLL_INTERVAL_SEC) || 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nạp trạng thái mọi phim 52api (kể cả phim đã xong) cho dashboard — làm lại mỗi vòng
// để phim mới + tiến độ mới hiện đúng.
async function refreshMovieRows() {
  const allMovies = await db.MovieSeries.find({ sourceProvider: /^52api-/ })
    .select("_id name bookId sourceProvider sourceEpisodeCount")
    .lean();
  const movieRows = [];
  for (const m of allMovies) {
    const { provider, sourceId } = extract52apiSource(m);
    if (!provider || !sourceId) continue;
    const done = await db.ShortVideo.countDocuments({ movieSeries: m._id });
    movieRows.push({ key: `${provider}:${sourceId}`, name: m.name, done, target: m.sourceEpisodeCount || 0 });
  }
  status.initMovies(movieRows);
}

// 1 vòng quét: tìm việc còn thiếu -> render hết. Trả về số tập đã xử lý trong vòng.
async function runPass() {
  await db.loadSettings(); // refresh settings mỗi vòng (đề phòng admin đổi)
  await refreshMovieRows();

  const work = await findPendingWork();
  const totalMissing = work.reduce((n, w) => n + w.missing.length, 0);
  console.log(`[worker] quét: ${work.length} phim, ${totalMissing} tập cần render`);
  if (!totalMissing) return 0;

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
  console.log(`[worker] pass xong: ${ok} ok, ${fail} lỗi / ${totalMissing}`);
  return totalMissing;
}

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
  console.log(`[worker] DAEMON concurrency=${env.concurrency}, ocrThreads=${env.ocrThreads}, poll=${POLL_SEC}s, tmp=${env.tmpDir}`);

  const pushTimer = setInterval(() => status.pushToServer(), 3000);

  // Vòng lặp daemon: quét -> render -> chờ -> lặp. Không thoát (phim mới tự nhặt).
  // Mỗi pass bọc try/catch để 1 lỗi không giết daemon.
  for (;;) {
    try {
      const n = await runPass();
      if (!n) console.log(`[worker] không có việc, chờ ${POLL_SEC}s...`);
    } catch (e) {
      console.error("[worker] lỗi pass:", e.message);
    }
    await status.pushToServer();
    await sleep(POLL_SEC * 1000);
  }
}

main().catch((e) => { console.error("[worker] fatal:", e); process.exit(1); });
