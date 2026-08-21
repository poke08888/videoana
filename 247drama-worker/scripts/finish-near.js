// Làm nốt những phim GẦN XONG để chúng lên app ngay, không phải chờ daemon quét hết kho.
//
// Phim chỉ lên app khi đủ tập. Trong kho luôn có một nhúm phim chỉ còn thiếu 1-2 tập — làm nốt
// vài tập đó là thêm ngần ấy phim cho người xem, rẻ hơn nhiều so với bắt đầu một phim 80 tập.
// Script chạy độc lập với WORKER_PROVIDERS (máy đang chạy hm vẫn làm nốt được phim dl) và nhận
// phần qua renderclaims nên không đụng daemon.
//
// Dùng:
//   node scripts/finish-near.js --dry            # xem sẽ làm phim nào
//   node scripts/finish-near.js                  # làm phim thiếu <= 3 tập
//   node scripts/finish-near.js --max 5 --luong 3
//   node scripts/finish-near.js --prov hm        # chỉ một nguồn
require("dotenv").config();
const pLimit = require("p-limit");
const db = require("./../db");
const duanju = require("./../util/duanjuProvider");
const { renderEpisode } = require("./../render");
const { classifyEpisodes, extract52apiSource } = require("./../work");
const { claimEpisode, releaseEpisode } = require("./../util/claims");

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const dry = argv.includes("--dry");
const MAX_MISSING = Math.max(1, parseInt(flag("max", "3"), 10) || 3);
const lanes = Math.max(1, parseInt(flag("luong", "3"), 10) || 3);
// hg trả về luồng bytevc2, ffmpeg không có bộ giải mã -> tải về cũng không ra khung hình nào.
// Bỏ qua mặc định để khỏi đốt thời gian; muốn thử lại thì --prov hg.
const provs = flag("prov", "hm,dl").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

async function main() {
  await db.connect();
  await db.loadSettings();

  const films = await db.MovieSeries.find({
    isComplete: false,
    "completeness.missing": { $gte: 1, $lte: MAX_MISSING },
  })
    .select("_id name thumbnail bookId sourceProvider zhBottomRatio zhBottomSource completeness")
    .sort({ "completeness.missing": 1 })
    .lean();

  const chosen = films.filter((f) => {
    const { provider } = extract52apiSource(f);
    return provider && provs.includes(provider);
  });

  console.log(
    `${films.length} phim còn thiếu <= ${MAX_MISSING} tập; làm ${chosen.length} phim thuộc nguồn ${provs.join(", ")}` +
      (films.length - chosen.length ? ` (bỏ qua ${films.length - chosen.length} phim nguồn khác)` : ""),
  );

  const jobs = [];
  for (const f of chosen) {
    const { provider, sourceId } = extract52apiSource(f);
    let info;
    try {
      info = await duanju.detail(provider, sourceId); // qua throttle 52api
    } catch (e) {
      console.error(`  ✗ ${f.name.slice(0, 34)}: hỏi nguồn lỗi (${e.message})`);
      continue;
    }
    const existing = await db.ShortVideo.find({ movieSeries: f._id }).select("episodeNumber sourceVideoId").lean();
    const badEps = (f.completeness && f.completeness.badEps) || [];
    const { missing } = classifyEpisodes(info.episodes || [], existing, badEps);
    for (const ep of missing) jobs.push({ series: f, provider, sourceId, ep });
    console.log(`  ${f.bookId.padEnd(22)} thiếu ${missing.length} tập  ${f.name.slice(0, 38)}`);
  }

  if (dry || !jobs.length) {
    console.log(`${jobs.length} tập cần render.`);
    await db.mongoose.disconnect();
    return;
  }

  const claims = db.mongoose.connection.db.collection("renderclaims");
  const limit = pLimit(lanes);
  let ok = 0, fail = 0, skip = 0;
  const lỗi = [];

  await Promise.all(
    jobs.map((j) =>
      limit(async () => {
        const tag = `${j.provider}:${j.sourceId} tập ${j.ep.index + 1}`;
        const mine = await claimEpisode(claims, {
          provider: j.provider, sourceId: j.sourceId, index: j.ep.index, worker: "lam-not-phim-gan-xong",
        }).catch(() => true);
        if (!mine) { skip++; console.log(`⏭  ${tag}: máy khác đang làm`); return; }
        try {
          const r = await renderEpisode({ series: j.series, provider: j.provider, sourceId: j.sourceId, ep: j.ep });
          if (r.ok) { ok++; console.log(`✅ ${tag}`); }
          else { fail++; lỗi.push(`${tag}: ${r.reason}`); console.log(`❌ ${tag}: ${r.reason}`); }
        } finally {
          await releaseEpisode(claims, { provider: j.provider, sourceId: j.sourceId, index: j.ep.index }).catch(() => {});
        }
      }),
    ),
  );

  console.log(`\nXong: ${ok} tập render được, ${fail} tập lỗi${skip ? `, ${skip} tập máy khác làm` : ""}.`);
  if (lỗi.length) lỗi.forEach((l) => console.log("  " + l));
  console.log("Cổng lên app chấm lại trong 2 phút; phim nào đủ tập sẽ tự hiện.");
  await db.mongoose.disconnect();
}

main().catch((e) => {
  console.error("LỖI", e.message);
  process.exit(1);
});
