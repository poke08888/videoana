// Đánh dấu các tập render TRƯỚC khi có soft-sub: phụ đề tiếng Việt đã cháy vào video
// -> app phải ẩn nút chọn phụ đề. Chạy 1 lần, chạy lại cũng vô hại.
require("dotenv").config();
const mongoose = require("mongoose");
const ShortVideo = require("../models/shortVideo.model");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL);
  const r = await ShortVideo.updateMany(
    { burnedLang: { $exists: false } },
    { $set: { burnedLang: "vi", subTracks: [] } },
  );
  console.log("đã đánh dấu:", r.modifiedCount);
  await mongoose.disconnect();
})();
