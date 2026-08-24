// Đặt LUẬT CHUNG: N tập đầu của MỌI phim đều xem miễn phí.
//
// Luật này được thi hành ở hai chỗ, cả hai đều đọc Setting.freeEpisodesForNonVip:
//   - worker (render.js): mỗi tập render xong tự đặt coin/isLocked theo luật -> phim mới lên
//     là đã đúng, không phải sửa tay.
//   - backend admin (thêm/xoá/đổi thứ tự tập): cũng đọc đúng setting đó.
// Script này chỉ làm phần CÒN LẠI: sửa số trong Setting và áp lại cho kho phim đang có.
//
// LƯU Ý con số: hệ thống đánh số tập từ 0, và cả worker lẫn backend đều tính
// freeLimit = freeEpisodesForNonVip + 1. Muốn 10 tập đầu miễn phí thì phải lưu số 9.
// Script nhận vào SỐ TẬP MIỄN PHÍ (10), tự quy đổi.
//
// Dùng:
//   node scripts/apply-free-episodes.js --dry        # xem sẽ đổi bao nhiêu tập
//   node scripts/apply-free-episodes.js              # áp luật 10 tập đầu (mặc định)
//   node scripts/apply-free-episodes.js --so 5       # đổi luật thành 5 tập đầu
require("dotenv").config();
const { connect, ShortVideo, Setting, mongoose } = require("./../db");

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const i = argv.indexOf("--so");
const SO_TAP_FREE = Math.max(1, parseInt(i >= 0 ? argv[i + 1] : "10", 10) || 10);
const COIN_KHI_KHOA = 10;

async function main() {
  await connect();
  const luuTrongSetting = SO_TAP_FREE - 1; // vì hệ thống tính +1
  const tapCuoiFree = SO_TAP_FREE - 1; // episodeNumber lớn nhất còn miễn phí (đánh số từ 0)

  const s = await Setting.findOne({}).select("freeEpisodesForNonVip").lean();
  const dangCoTrongSetting = s ? s.freeEpisodesForNonVip : null;

  const [canMo, canKhoa] = await Promise.all([
    ShortVideo.countDocuments({ episodeNumber: { $lte: tapCuoiFree }, isLocked: true }),
    ShortVideo.countDocuments({ episodeNumber: { $gt: tapCuoiFree }, isLocked: false }),
  ]);

  console.log(
    `Luật: ${SO_TAP_FREE} tập đầu miễn phí (lưu ${luuTrongSetting} trong Setting, hiện đang là ${dangCoTrongSetting}).`,
  );
  console.log(`  mở khoá: ${canMo} tập | khoá lại: ${canKhoa} tập`);
  if (dry) {
    await mongoose.disconnect();
    return;
  }

  await Setting.updateOne({}, { $set: { freeEpisodesForNonVip: luuTrongSetting } });
  const [mo, khoa] = await Promise.all([
    ShortVideo.updateMany({ episodeNumber: { $lte: tapCuoiFree } }, { $set: { isLocked: false, coin: 0 } }),
    ShortVideo.updateMany({ episodeNumber: { $gt: tapCuoiFree } }, { $set: { isLocked: true, coin: COIN_KHI_KHOA } }),
  ]);
  console.log(`Đã áp: mở ${mo.modifiedCount} tập, khoá ${khoa.modifiedCount} tập.`);
  console.log("Phim render sau này tự theo luật này (worker đọc Setting mỗi vòng quét).");
  console.log("Backend đang chạy giữ setting trong RAM -> nạp lại backend (pm2 reload) để phần admin cũng theo số mới.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("LỖI", e.message);
  process.exit(1);
});
