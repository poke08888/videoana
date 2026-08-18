// Đổi base R2 từ r2.dev sang custom domain: viết lại videoUrl trong Mongo + cập nhật .env worker.
// Dùng: node scripts/switch-r2-domain.js <new_host>   (vd cdn.247tv.app)
//   thêm "dryrun" để chỉ đếm, không đổi: node scripts/switch-r2-domain.js cdn.247tv.app dryrun
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const OLD_HOST = (process.env.R2_PUBLIC_BASE || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const NEW_HOST = (process.argv[2] || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const DRY = process.argv[3] === "dryrun";

async function main() {
  if (!NEW_HOST) { console.error("cần <new_host>, vd cdn.247tv.app"); process.exit(1); }
  if (!OLD_HOST) { console.error("không đọc được R2_PUBLIC_BASE cũ trong .env"); process.exit(1); }
  console.log(`Đổi: ${OLD_HOST}  ->  ${NEW_HOST}${DRY ? "  (DRYRUN)" : ""}`);

  await mongoose.connect(process.env.MongoDb_Connection_String, { serverSelectionTimeoutMS: 15000 });
  const col = mongoose.connection.db.collection("shortvideos");
  const rx = new RegExp(OLD_HOST.replace(/[.]/g, "\\."));
  const n = await col.countDocuments({ videoUrl: rx });
  console.log(`videoUrl cần đổi: ${n}`);

  if (!DRY && n) {
    // aggregation-pipeline update: thay chuỗi host trong videoUrl (MongoDB >=4.4)
    const r = await col.updateMany(
      { videoUrl: rx },
      [{ $set: { videoUrl: { $replaceAll: { input: "$videoUrl", find: OLD_HOST, replacement: NEW_HOST } } } }],
    );
    console.log(`✅ Mongo: matched ${r.matchedCount}, modified ${r.modifiedCount}`);
    // xác nhận mẫu
    const one = await col.findOne({ videoUrl: new RegExp(NEW_HOST.replace(/[.]/g, "\\.")) }, { projection: { videoUrl: 1 } });
    console.log("   vd sau đổi:", one && one.videoUrl);
  }
  await mongoose.disconnect();

  if (!DRY) {
    // cập nhật .env worker (render tập MỚI dùng domain mới)
    const envPath = path.join(__dirname, "..", ".env");
    let env = fs.readFileSync(envPath, "utf8");
    env = env.replace(/^R2_PUBLIC_BASE=.*$/m, `R2_PUBLIC_BASE=https://${NEW_HOST}`);
    fs.writeFileSync(envPath, env);
    console.log(`✅ .env: R2_PUBLIC_BASE=https://${NEW_HOST}  (restart worker để áp dụng cho tập mới)`);
  }
}
main().catch((e) => { console.error("LỖI", e.message); process.exit(1); });
