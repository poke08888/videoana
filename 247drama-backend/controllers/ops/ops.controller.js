const Category = require("../../models/category.model");
const Language = require("../../models/language.model");
const axios = require("axios");
const MovieSeries = require("../../models/movieSeries.model");
const Setting = require("../../models/setting.model");
const { createClient } = require("../../util/duanju52");
const { buildSeriesDoc } = require("../../util/opsSeries");

// Key 52api nằm trong Setting (worker dùng chung) -> đọc mỗi lần gọi, đổi key không cần restart.
let cachedKey = "";
async function getKey52() {
  const s = await Setting.findOne({}).select("chineseDramaApi").lean();
  cachedKey = (s && s.chineseDramaApi && s.chineseDramaApi.apiKey) || "";
  return cachedKey;
}

const duanju = createClient({
  getKey: () => cachedKey,
  httpGet: async (url, params) => {
    const r = await axios.get(url, { params, timeout: 60000 });
    const body = r.data || {};
    if (body.code && Number(body.code) !== 200) {
      const err = new Error(body.msg || "52api lỗi");
      err.is52api = true;
      throw err;
    }
    return body.data || body;
  },
});

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

// Duyệt kho phim: bảng xếp hạng hoặc tìm theo từ khoá.
exports.catalog = async (req, res) => {
  try {
    await getKey52();
    const { provider = "hg", type = "top", keyword = "", cellId = "", subCellId = "", page = "1" } = req.query;
    const items =
      type === "search"
        ? await duanju.search(provider, keyword, Number(page) || 1)
        : cellId
          ? await duanju.topList(cellId, subCellId, Number(page) || 1)
          : [];
    const categories = type === "top" && !cellId ? await duanju.topCategories() : [];

    // Đánh dấu phim đã nhập để web tắt nút.
    const bookIds = items.map((i) => `${String(provider).toLowerCase()}:${i.sourceId}`);
    const existed = await MovieSeries.find({ bookId: { $in: bookIds } }).select("bookId").lean();
    const has = new Set(existed.map((e) => e.bookId));

    return res.status(200).json({
      status: true,
      data: {
        categories,
        items: items.map((i) => ({ ...i, imported: has.has(`${String(provider).toLowerCase()}:${i.sourceId}`) })),
      },
    });
  } catch (error) {
    console.error("ops catalog error:", error.message);
    const code = error.is52api ? 502 : 500;
    return res.status(code).json({ status: false, message: error.message });
  }
};

// Xem trước một phim trước khi nhập.
exports.detail = async (req, res) => {
  try {
    await getKey52();
    const { provider = "hg", sourceId } = req.query;
    if (!sourceId) return res.status(400).json({ status: false, message: "thiếu sourceId" });
    const info = await duanju.detail(provider, sourceId);
    return res.status(200).json({ status: true, data: info });
  } catch (error) {
    console.error("ops detail error:", error.message);
    return res.status(error.is52api ? 502 : 500).json({ status: false, message: error.message });
  }
};

// Nhập phim: tạo MovieSeries; worker Mac tự phát hiện và render ở vòng quét kế tiếp.
exports.importSeries = async (req, res) => {
  try {
    await getKey52();
    const { provider, sourceId, categoryId, languageId, type } = req.body || {};
    const bookId = `${String(provider || "").toLowerCase()}:${sourceId}`;
    const existing = await MovieSeries.findOne({ bookId }).select("name").lean();
    if (existing) {
      return res.status(409).json({ status: false, message: `Phim đã có trong hệ thống: ${existing.name}` });
    }
    const info = await duanju.detail(provider, sourceId);
    const doc = buildSeriesDoc({ provider, sourceId, info, categoryId, languageId, type: Number(type) });
    const created = await MovieSeries.create(doc);
    return res.status(200).json({
      status: true,
      message: `Đã nhập "${created.name}" (${doc.sourceEpisodeCount} tập). Worker sẽ render ở vòng quét kế tiếp.`,
      data: { _id: created._id, bookId: created.bookId },
    });
  } catch (error) {
    console.error("ops import error:", error.message);
    return res.status(error.is52api ? 502 : 400).json({ status: false, message: error.message });
  }
};
