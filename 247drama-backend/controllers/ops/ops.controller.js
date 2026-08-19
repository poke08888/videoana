const Category = require("../../models/category.model");
const Language = require("../../models/language.model");

// Kiểm khoá vận hành đúng chưa (trang web dùng để mở khoá).
exports.ping = async (req, res) => {
  return res.status(200).json({ status: true, message: "ok" });
};

// Danh sách category + language để chọn khi nhập phim.
exports.options = async (req, res) => {
  try {
    const [categories, languages] = await Promise.all([
      Category.find({}).select("_id name").sort({ name: 1 }).lean(),
      Language.find({}).select("_id name").sort({ name: 1 }).lean(),
    ]);
    return res.status(200).json({ status: true, data: { categories, languages } });
  } catch (error) {
    console.error("ops options error:", error);
    return res.status(500).json({ status: false, message: "Không lấy được danh mục" });
  }
};
