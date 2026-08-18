// Đánh dấu các tập render TRƯỚC khi có soft-sub: phụ đề tiếng Việt đã cháy vào video
// -> app phải ẩn nút chọn phụ đề. Chạy 1 lần, chạy lại cũng vô hại.
require("dotenv").config();
const mongoose = require("mongoose");
const ShortVideo = require("../models/shortVideo.model");

(async () => {
  try {
    // Kiểm tra biến môi trường bắt buộc ngay từ đầu
    const mongoUrl = process.env.MongoDb_Connection_String
      || process.env.MONGO_URI
      || process.env.DATABASE_URL;

    if (!mongoUrl) {
      console.error(
        "❌ LỖI: Thiếu biến môi trường kết nối MongoDB\n" +
        "   Cần thiết lập MongoDb_Connection_String (hoặc MONGO_URI/DATABASE_URL làm dự phòng)\n" +
        "   Vui lòng kiểm tra file .env hoặc biến env trên server"
      );
      process.exitCode = 1;
      return;
    }

    await mongoose.connect(mongoUrl);
    const r = await ShortVideo.updateMany(
      { burnedLang: { $exists: false } },
      { $set: { burnedLang: "vi", subTracks: [] } },
    );
    console.log("✓ đã đánh dấu:", r.modifiedCount);
    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ LỖI khi chạy backfill:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    // Đảm bảo ngắt kết nối Mongo
    try {
      await mongoose.disconnect();
    } catch {
      // Lỗi ngắt kết nối không quan trọng nếu kết nối đã lỗi từ trước
    }
  }
})();
