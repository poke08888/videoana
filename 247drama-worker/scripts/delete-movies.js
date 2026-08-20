// Xoá TRỌN phim 52api: file R2 (mp4 + .vi.json) + ShortVideo + MovieSeries.
// Dùng: node scripts/delete-movies.js list <bookId...>     # chỉ xem
//       node scripts/delete-movies.js yes  <bookId...>     # xoá thật
require("dotenv").config();
const mongoose = require("mongoose");
const { S3Client, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { env } = require("./../config");

function r2() {
  return new S3Client({ region: "auto", endpoint: env.r2.endpoint, forcePathStyle: true,
    credentials: { accessKeyId: env.r2.accessKey, secretAccessKey: env.r2.secret } });
}

async function main() {
  const mode = process.argv[2];
  const books = process.argv.slice(3);
  if (!["list", "yes"].includes(mode) || !books.length) {
    console.error("Dùng: node scripts/delete-movies.js list|yes <bookId...>"); process.exit(1);
  }
  await mongoose.connect(process.env.MongoDb_Connection_String, { serverSelectionTimeoutMS: 15000 });
  const conn = mongoose.connection.db;

  for (const bk of books) {
    const ms = await conn.collection("movieseries").findOne({ bookId: bk });
    if (!ms) { console.log(`⚠️  không thấy phim ${bk}`); continue; }
    const eps = await conn.collection("shortvideos").find({ movieSeries: ms._id }).project({ videoUrl: 1, subTracks: 1 }).toArray();
    const keys = [];
    for (const e of eps) {
      const file = (e.videoUrl || "").split("/").pop();
      if (file) { keys.push(`${env.r2.keyPrefix}/${file}`); keys.push(`${env.r2.keyPrefix}/${file.replace(/\.mp4$/, ".vi.json")}`); }
      // File phụ đề rời lấy THẲNG từ subTracks: tên có số phiên bản và mã ngôn ngữ
      // (…_ep5.v2.th.vtt) nên đoán theo mẫu là sót, mà sót thì R2 ôm rác vĩnh viễn.
      for (const t of e.subTracks || []) {
        const f = String(t.url || "").split("/").pop();
        if (f) keys.push(`${env.r2.keyPrefix}/${f}`);
      }
    }
    const nSub = keys.length - eps.length * 2;
    console.log(`\n"${ms.name}" (${bk})`);
    console.log(`  ShortVideo: ${eps.length} | R2: ${eps.length} mp4 + ${nSub} file phụ đề (+${eps.length} sidecar cũ nếu còn)`);
    if (mode !== "yes") continue;

    // 1) xoá R2 (theo lô 1000)
    let delR2 = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
      const r = await r2().send(new DeleteObjectsCommand({ Bucket: env.r2.bucket, Delete: { Objects: batch, Quiet: true } }));
      delR2 += batch.length - ((r.Errors && r.Errors.length) || 0);
    }
    // 2) xoá ShortVideo
    const dv = await conn.collection("shortvideos").deleteMany({ movieSeries: ms._id });
    // 3) xoá MovieSeries
    await conn.collection("movieseries").deleteOne({ _id: ms._id });
    console.log(`  ✅ đã xoá: R2 ~${delR2} objects, ShortVideo ${dv.deletedCount}, MovieSeries 1`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error("LỖI", e.message); process.exit(1); });
