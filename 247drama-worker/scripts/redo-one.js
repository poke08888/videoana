// Render lại 1 tập cụ thể ngay (không chờ worker) -> up R2 ghi đè + upsert Mongo.
// Dùng: node scripts/redo-one.js <bookId> <episodeIndex>
//   vd: node scripts/redo-one.js hg:7602648757238254654 4
require("dotenv").config();
const db = require("./../db");
const duanju = require("./../util/duanjuProvider");
const { renderEpisode } = require("./../render");
const { extract52apiSource } = require("./../work");

async function main() {
  const bookId = process.argv[2];
  const epIndex = parseInt(process.argv[3], 10);
  if (!bookId || Number.isNaN(epIndex)) { console.error("cần: <bookId> <episodeIndex>"); process.exit(1); }

  await db.connect();
  await db.loadSettings();

  const series = await db.MovieSeries.findOne({ bookId }).lean();
  if (!series) throw new Error("không thấy phim " + bookId);
  const { provider, sourceId } = extract52apiSource(series);
  if (!provider || !sourceId) throw new Error("bookId không hợp lệ");

  const info = await duanju.detail(provider, sourceId);
  const ep = (info.episodes || []).find((e) => e.index === epIndex);
  if (!ep) throw new Error(`không thấy tập index ${epIndex} (phim có ${info.episodes?.length || 0} tập)`);

  console.log(`Render lại "${series.name}" tập index ${epIndex} (${provider}:${sourceId})...`);
  const r = await renderEpisode({ series, provider, sourceId, ep });
  console.log("Kết quả:", JSON.stringify(r));

  // xác nhận kết quả sau render (đủ thông tin nghiệm thu cho cả đường burn lẫn soft)
  const doc = await db.ShortVideo.findOne({ movieSeries: series._id, episodeNumber: epIndex })
    .select("subLang videoUrl burnedLang subTracks")
    .lean();
  console.log("Sau render -> subLang:", doc?.subLang || "(none)", "| url:", doc?.videoUrl);
  console.log("  burnedLang:", doc?.burnedLang === "" ? '"" (video sạch)' : doc?.burnedLang || "(thiếu)");
  const tracks = doc?.subTracks || [];
  console.log("  subTracks:", tracks.length ? tracks.map((t) => `${t.lang}=${t.url}`).join("\n             ") : "(không có)");
  await db.mongoose.disconnect();
}

main().catch((e) => { console.error("LỖI", e.message); process.exit(1); });
