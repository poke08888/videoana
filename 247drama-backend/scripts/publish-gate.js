// Chấm lại cổng lên app cho toàn kho, chạy tay khi cần (server tự chạy mỗi 2 phút).
//   node scripts/publish-gate.js --dry   # chỉ xem, không ghi
//   node scripts/publish-gate.js         # ghi cờ isComplete + lý do vào từng phim
require("dotenv").config({ path: ".env" });
const mongoose = require("mongoose");
const MovieSeries = require("../models/movieSeries.model");
const ShortVideo = require("../models/shortVideo.model");
const { evaluateSeries, collectStats, sweepPublishGate } = require("../util/publishGate");

const dry = process.argv.includes("--dry");

(async () => {
  const uri = process.env.MongoDb_Connection_String;
  if (!uri) throw new Error("thiếu MongoDb_Connection_String");
  await mongoose.connect(uri);

  if (dry) {
    const series = await MovieSeries.find({}).select("_id name isActive sourceProvider bookId sourceEpisodeCount").lean();
    const stats = await collectStats(ShortVideo);
    let ok = 0;
    const hidden = [];
    for (const s of series) {
      const r = evaluateSeries(s, stats.get(String(s._id)));
      if (r.isComplete) ok++;
      else hidden.push(`  ${s.name.slice(0, 46).padEnd(46)} ${r.completeness.reason}`);
    }
    console.log(`${series.length} phim -> lên app ${ok}, ẩn ${hidden.length}`);
    hidden.forEach((h) => console.log(h));
  } else {
    const r = await sweepPublishGate({ MovieSeries, ShortVideo, log: console.log });
    console.log(`đã chấm ${r.checked} phim: lên app ${r.published}, ẩn ${r.hidden}, ghi lại ${r.changed} phim`);
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
