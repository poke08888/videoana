// Bắt buộc file tạm nằm trên BINGNET (autosub/transcode dùng os.tmpdir()).
const fs = require("fs");
const { env } = require("./config");
process.env.TMPDIR = env.tmpDir;

const pLimit = require("p-limit");
const db = require("./db");
const { findPendingWork, extract52apiSource } = require("./work");
const { mirrorCover, isMirrored } = require("./util/cover");
const { ensureTunnel } = require("./util/tunnel");
const { claimEpisode, releaseEpisode, sweepExpired } = require("./util/claims");
const os = require("os");
const path = require("path");
const duanju = require("./util/duanjuProvider");
const { renderEpisode } = require("./render");
const status = require("./status");

// Daemon: quét việc mỗi POLL_INTERVAL_SEC (mặc định 120s) -> phim/tập mới add trên
// admin server tự được nhặt mà KHÔNG cần restart tay.
const POLL_SEC = Math.max(30, parseInt(process.env.POLL_INTERVAL_SEC) || 120);
// Tên máy render: hiện trên bảng trạng thái và ghi vào phần nhận việc, để biết tập nào
// máy nào đang làm khi chạy nhiều máy cùng lúc.
const WORKER_NAME = process.env.WORKER_NAME || os.hostname().replace(/\.local$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nạp trạng thái mọi phim 52api (kể cả phim đã xong) cho dashboard — làm lại mỗi vòng
// để phim mới + tiến độ mới hiện đúng.
async function refreshMovieRows() {
  const allMovies = await db.MovieSeries.find({ sourceProvider: /^52api-/ })
    .select("_id name bookId sourceProvider sourceEpisodeCount")
    .lean();
  const movieRows = [];
  const nameById = new Map();
  for (const m of allMovies) {
    const { provider, sourceId } = extract52apiSource(m);
    if (!provider || !sourceId) continue;
    nameById.set(String(m._id), m.name);
    const done = await db.ShortVideo.countDocuments({ movieSeries: m._id });
    movieRows.push({ key: `${provider}:${sourceId}`, name: m.name, done, target: m.sourceEpisodeCount || 0 });
  }
  status.initMovies(movieRows);

  // Tập TRỐNG vietsub: render xong nhưng OCR không ra câu nào -> subLang != "vi" (render.js đặt
  // "" khi !r.subbed). Gom theo phim cho khu "Cần làm lại" trên dashboard (để check + render lại).
  const blanks = await db.ShortVideo.find({ sourceProvider: /^52api-/, subLang: { $ne: "vi" } })
    .select("movieSeries episodeNumber")
    .lean();
  const byMovie = {};
  for (const b of blanks) {
    const nm = nameById.get(String(b.movieSeries));
    if (!nm) continue; // bỏ tập không map được phim (dữ liệu lạc)
    (byMovie[nm] ||= []).push(b.episodeNumber);
  }
  const needsRedo = Object.keys(byMovie)
    .sort()
    .map((name) => ({ name, eps: byMovie[name].sort((a, b) => a - b) }));
  status.setNeedsRedo(needsRedo);
}

// Ảnh bìa 52api trỏ vào CDN ByteDance — ngoài tầm kiểm soát, nhà mạng chặn là phim mất ảnh.
// Mỗi vòng sao vài phim về R2 rồi trỏ lại link của mình, cả bản ghi phim lẫn ảnh từng tập.
// Giới hạn mỗi vòng để không kéo dài pass; phim mới nhập chậm nhất vài vòng là có ảnh.
const COVERS_PER_PASS = 40; // đủ dọn hết tồn đọng trong 1-2 vòng, mà không kéo dài pass
const COVER_CONCURRENCY = 3;

// Khoá ảnh cho phim KHÔNG phải nguồn 52api (nhập tay, nguồn cũ): dùng chính id phim.
function coverIdOf(m) {
  const { provider, sourceId } = extract52apiSource(m);
  if (provider && sourceId) return { provider, sourceId };
  return { provider: "ms", sourceId: String(m._id) };
}

async function mirrorPendingCovers() {
  // MỌI phim, không riêng phim 52api: link ảnh nằm ngoài hệ thống (CDN ByteDance, hay chính
  // http://<ip>/uploads trên máy chủ) đều là chỗ có thể hỏng mà mình không sửa được.
  const movies = await db.MovieSeries.find({}).select("_id name thumbnail bookId sourceProvider").lean();
  const pending = movies.filter((m) => m.thumbnail && !isMirrored(m.thumbnail));
  const noCover = movies.filter((m) => !m.thumbnail);
  if (!pending.length) {
    if (noCover.length) console.log(`[cover] ${noCover.length} phim không có ảnh bìa ở nguồn: ${noCover.slice(0, 3).map((m) => m.name).join(", ")}`);
    return;
  }

  const todo = pending.slice(0, COVERS_PER_PASS);
  let ok = 0, fail = 0, i = 0;
  await Promise.all(
    Array.from({ length: Math.min(COVER_CONCURRENCY, todo.length) }, async () => {
      while (i < todo.length) {
        const m = todo[i++];
        const { provider, sourceId } = coverIdOf(m);
        try {
          const r = await mirrorCover({
            provider,
            sourceId,
            url: m.thumbnail,
            download: (u) => duanju.downloadToBuffer(u, { timeout: 30000, retries: 2 }),
          });
          await db.MovieSeries.updateOne({ _id: m._id }, { $set: { thumbnail: r.url, banner: r.url } });
          const up = await db.ShortVideo.updateMany({ movieSeries: m._id }, { $set: { videoImage: r.url } });
          ok++;
          console.log(`[cover] ${m.name}: đã sao ảnh về (${Math.round(r.bytes / 1024)}KB, ${up.modifiedCount} tập)`);
        } catch (e) {
          fail++;
          console.error(`[cover] ${m.name}: ${e.message}`);
        }
      }
    })
  );
  const left = pending.length - todo.length;
  console.log(`[cover] vòng này: ${ok} xong, ${fail} lỗi${left ? `, còn ${left} phim chờ vòng sau` : ", đã hết tồn đọng"}`);
}

// 1 vòng quét: tìm việc còn thiếu -> render hết. Trả về số tập đã xử lý trong vòng.
async function runPass() {
  await db.loadSettings(); // refresh settings mỗi vòng (đề phòng admin đổi)

  // Tunnel HK phải sống thì tập hm mới tải được. Nó là tiến trình ssh nên máy ngủ hay rớt
  // mạng là chết lặng lẽ; kiểm mỗi vòng và tự mở lại, thay vì để hàng chục tập hm lỗi.
  const tun = await ensureTunnel({ port: 1080, script: path.join(__dirname, "ops", "hk-tunnel.sh") });
  if (!tun.ok) console.error(`[tunnel] SOCKS 1080 hỏng: ${tun.reason} -> tập nguồn hm sẽ lỗi cho tới khi mở lại được`);
  else if (tun.action !== "đang chạy") console.log(`[tunnel] SOCKS 1080 ${tun.action}`);

  await refreshMovieRows();
  await mirrorPendingCovers().catch((e) => console.error("[cover] lỗi:", e.message));

  const work = await findPendingWork();
  // Cập nhật target thật NGAY khi biết số tập (phim mới đầu pass còn epCount=0) -> dashboard
  // hiện đúng % suốt pass dài, không đứng hình ở target cũ.
  for (const it of work) status.setTarget(`${it.provider}:${it.sourceId}`, it.episodes.length);
  const totalMissing = work.reduce((n, w) => n + w.missing.length, 0);
  const totalDrift = work.reduce((n, w) => n + (w.drift ? w.drift.length : 0), 0);
  console.log(`[worker] quét: ${work.length} phim, ${totalMissing} tập cần render` + (totalDrift ? `, ${totalDrift} tập lệch videoId` : ""));
  if (!totalMissing) return 0;

  const claims = db.mongoose.connection.db.collection("renderclaims");
  const swept = await sweepExpired(claims).catch(() => 0);
  if (swept) console.log(`[việc] dọn ${swept} phần nhận quá hạn (máy nào đó tắt giữa chừng)`);

  const limit = pLimit(env.concurrency);
  let done = 0, ok = 0, fail = 0, skip = 0;
  const jobs = [];
  for (const it of work) {
    // Cập nhật tổng số tập nguồn (khớp process52apiEpisodes) — 1 lần/phim.
    await db.MovieSeries.updateOne({ _id: it.series._id }, { $set: { sourceEpisodeCount: it.episodes.length } }).catch(() => {});
    for (const ep of it.missing) {
      jobs.push(limit(async () => {
        // Nhận phần trước khi làm: máy khác đang giữ tập này thì bỏ qua, không làm trùng.
        const mine = await claimEpisode(claims, {
          provider: it.provider, sourceId: it.sourceId, index: ep.index, worker: WORKER_NAME,
        }).catch(() => true); // kho lỗi thì cứ làm, thà trùng còn hơn đứng im
        if (!mine) { skip++; return; }
        try {
          const r = await renderEpisode({ series: it.series, provider: it.provider, sourceId: it.sourceId, ep });
          done++; r.ok ? ok++ : fail++;
          if (done % 5 === 0 || done === totalMissing) console.log(`[worker] tiến độ ${done}/${totalMissing} (ok ${ok}, lỗi ${fail}${skip ? `, ${skip} tập máy khác nhận` : ""})`);
        } finally {
          await releaseEpisode(claims, { provider: it.provider, sourceId: it.sourceId, index: ep.index }).catch(() => {});
        }
      }));
    }
  }
  await Promise.all(jobs);
  console.log(`[worker] pass xong: ${ok} ok, ${fail} lỗi${skip ? `, ${skip} tập do máy khác làm` : ""} / ${totalMissing}`);
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
  console.log(`[worker] DAEMON máy "${WORKER_NAME}" concurrency=${env.concurrency}, ocrThreads=${env.ocrThreads}, poll=${POLL_SEC}s, tmp=${env.tmpDir}`);

  const pushTimer = setInterval(() => status.pushToServer(), 3000);

  // Dọn phần nhận quá hạn theo giờ, KHÔNG chỉ ở đầu mỗi vòng quét: một vòng có thể kéo dài
  // nhiều giờ (hàng nghìn tập), nên tập do máy chết bỏ lại sẽ bị khoá suốt chừng đó thời gian
  // dù hạn giữ chỉ 20 phút. Thực tế đã gặp: 6 tập kẹt 40 phút vì máy kia tắt giữa chừng.
  const sweepTimer = setInterval(async () => {
    try {
      const claims = db.mongoose.connection.db.collection("renderclaims");
      const n = await sweepExpired(claims);
      if (n) console.log(`[việc] dọn ${n} phần nhận quá hạn`);
    } catch (e) {
      console.error("[việc] dọn phần nhận lỗi:", e.message);
    }
  }, 5 * 60 * 1000);

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
