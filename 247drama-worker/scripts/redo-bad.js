// Sửa những TẬP HỎNG mà cổng lên app đã chỉ mặt (completeness.badEps): tập đã có bản ghi
// nhưng không có lấy một dòng phụ đề Việt, hoặc mất link video.
//
// Điểm mấu chốt: KHÔNG tải lại từ nguồn. Bản mp4 của những tập này đã nằm trên R2 của mình,
// còn nguyên chữ Trung — OCR lại là đủ. Nhờ vậy sửa được cả phim nguồn hg dù 52api đã hết
// quota hg_play và luồng hg giờ chỉ còn bytevc1 không giải mã nổi.
//
// Dùng:
//   node scripts/redo-bad.js --dry              # chỉ liệt kê việc sẽ làm
//   node scripts/redo-bad.js                    # sửa hết
//   node scripts/redo-bad.js hg:7663434332274428952   # chỉ một phim (bookId hoặc một phần tên)
//   node scripts/redo-bad.js --luong 3          # số tập chạy song song (mặc định 2)
require("dotenv").config();
const pLimit = require("p-limit");
const db = require("./../db");
const { renderEpisode } = require("./../render");
const { claimEpisode, releaseEpisode } = require("./../util/claims");
const { extract52apiSource } = require("./../work");

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const laneIdx = argv.indexOf("--luong");
const lanes = laneIdx >= 0 ? Math.max(1, parseInt(argv[laneIdx + 1], 10) || 2) : 2;
const target = argv.find((a) => !a.startsWith("--") && a !== String(lanes));

async function main() {
  await db.connect();
  await db.loadSettings();

  const films = (
    await db.MovieSeries.find({ "completeness.badEps.0": { $exists: true } })
      .select("name thumbnail bookId sourceProvider zhBottomRatio zhBottomSource completeness.badEps")
      .lean()
  ).filter((f) => {
    if (!target) return true;
    const t = target.toLowerCase();
    return (f.bookId || "").toLowerCase() === t || (f.name || "").toLowerCase().includes(t);
  });

  // Dựng danh sách việc: mỗi việc là một tập, kèm link bản mirror trên R2 nếu còn.
  const jobs = [];
  for (const f of films) {
    const { provider, sourceId } = extract52apiSource(f);
    if (!provider || !sourceId) {
      console.warn(`bỏ "${f.name}": bookId không đọc được (${f.bookId})`);
      continue;
    }
    const rows = await db.ShortVideo.find({ movieSeries: f._id, episodeNumber: { $in: f.completeness.badEps } })
      .select("episodeNumber videoUrl sourceVideoId")
      .lean();
    const byEp = new Map(rows.map((r) => [r.episodeNumber, r]));
    for (const index of f.completeness.badEps) {
      const row = byEp.get(index);
      jobs.push({
        series: f,
        provider,
        sourceId,
        index,
        fromUrl: (row && row.videoUrl) || "",
        videoId: (row && row.sourceVideoId) || "",
      });
    }
  }

  const mirrored = jobs.filter((j) => j.fromUrl).length;
  console.log(`${jobs.length} tập hỏng ở ${films.length} phim — ${mirrored} tập sửa được từ bản trên R2, ${jobs.length - mirrored} tập phải lấy lại từ nguồn.`);
  if (dry) {
    for (const j of jobs) {
      console.log(`  ${j.provider}:${j.sourceId} tập ${j.index + 1}  ${j.fromUrl ? "R2" : "NGUỒN"}  ${j.series.name.slice(0, 40)}`);
    }
    await db.mongoose.disconnect();
    return;
  }
  if (!jobs.length) {
    await db.mongoose.disconnect();
    return;
  }

  // Nhận phần như worker: máy khác (hoặc daemon trên chính máy này) đang làm tập nào thì bỏ qua.
  const claims = db.mongoose.connection.db.collection("renderclaims");
  const limit = pLimit(lanes);
  let ok = 0, fail = 0, skip = 0;
  const lỗi = [];

  await Promise.all(
    jobs.map((j) =>
      limit(async () => {
        const tag = `${j.provider}:${j.sourceId} tập ${j.index + 1}`;
        const mine = await claimEpisode(claims, {
          provider: j.provider, sourceId: j.sourceId, index: j.index, worker: "sua-tap-hong",
        }).catch(() => true);
        if (!mine) { skip++; console.log(`⏭  ${tag}: máy khác đang làm`); return; }
        try {
          const r = await renderEpisode({
            series: j.series,
            provider: j.provider,
            sourceId: j.sourceId,
            ep: { index: j.index, videoId: j.videoId },
            fromUrl: j.fromUrl || undefined,
          });
          if (r.ok) { ok++; console.log(`✅ ${tag}`); }
          else { fail++; lỗi.push(`${tag}: ${r.reason}`); console.log(`❌ ${tag}: ${r.reason}`); }
        } finally {
          await releaseEpisode(claims, { provider: j.provider, sourceId: j.sourceId, index: j.index }).catch(() => {});
        }
      }),
    ),
  );

  console.log(`\nXong: ${ok} tập sửa được, ${fail} tập vẫn hỏng${skip ? `, ${skip} tập máy khác đang làm` : ""}.`);
  if (lỗi.length) {
    console.log("Còn hỏng:");
    lỗi.forEach((l) => console.log("  " + l));
  }
  console.log("Cổng lên app tự chấm lại trong 2 phút; phim nào đủ sẽ tự hiện.");
  await db.mongoose.disconnect();
}

main().catch((e) => {
  console.error("LỖI", e.message);
  process.exit(1);
});
