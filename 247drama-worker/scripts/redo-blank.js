// Làm lại các tập TRỐNG vietsub (subLang != "vi"): xoá doc ShortVideo -> worker coi là tập
// thiếu -> render lại (ghi đè cùng key R2). Dùng khi OCR fail tạm thời, thử lại có thể ra sub.
//
// Dùng:
//   node scripts/redo-blank.js list                 # chỉ liệt kê, KHÔNG xoá
//   node scripts/redo-blank.js <bookId|tên phim>    # làm lại 1 phim (vd hg:7663... hoặc "Ông trùm")
//   node scripts/redo-blank.js all yes              # làm lại TẤT CẢ (cần chữ "yes" để chắc chắn)
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const target = process.argv[2];
  const confirm = process.argv[3];
  if (!target) {
    console.error("cần tham số: list | <bookId|tên phim> | all yes");
    process.exit(1);
  }
  await mongoose.connect(process.env.MongoDb_Connection_String, { serverSelectionTimeoutMS: 15000 });
  const conn = mongoose.connection.db;

  // map phim để lọc theo bookId/tên
  const movies = await conn.collection("movieseries").find({ sourceProvider: /^52api-/ }).project({ name: 1, bookId: 1 }).toArray();
  const nameById = new Map(movies.map((m) => [String(m._id), m.name]));

  const blanks = await conn.collection("shortvideos")
    .find({ sourceProvider: /^52api-/, subLang: { $ne: "vi" } })
    .project({ movieSeries: 1, episodeNumber: 1, videoUrl: 1 }).toArray();

  // lọc theo target
  let sel = blanks;
  if (target !== "all" && target !== "list") {
    const t = target.toLowerCase();
    const matchIds = new Set(movies.filter((m) => (m.bookId || "").toLowerCase() === t || (m.name || "").toLowerCase().includes(t)).map((m) => String(m._id)));
    sel = blanks.filter((b) => matchIds.has(String(b.movieSeries)));
  }

  // gom hiển thị
  const byMovie = {};
  for (const b of sel) (byMovie[nameById.get(String(b.movieSeries)) || "?"] ||= []).push(b.episodeNumber);
  console.log(`Tập trống vietsub khớp: ${sel.length}`);
  for (const nm of Object.keys(byMovie).sort()) console.log(`  ${nm}: tập ${byMovie[nm].sort((a, b) => a - b).join(", ")}`);

  if (target === "list") { await mongoose.disconnect(); return; }
  if (target === "all" && confirm !== "yes") {
    console.log('\nĐể làm lại TẤT CẢ, chạy: node scripts/redo-blank.js all yes');
    await mongoose.disconnect(); return;
  }
  if (!sel.length) { await mongoose.disconnect(); return; }

  const ids = sel.map((b) => b._id);
  const r = await conn.collection("shortvideos").deleteMany({ _id: { $in: ids } });
  console.log(`\n✅ Đã xoá ${r.deletedCount} doc tập trống -> worker sẽ render lại trong pass kế (~2 phút).`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error("LỖI", e.message); process.exit(1); });
