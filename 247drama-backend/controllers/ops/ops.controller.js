const Category = require("../../models/category.model");
const Language = require("../../models/language.model");
const axios = require("axios");
const MovieSeries = require("../../models/movieSeries.model");
const Setting = require("../../models/setting.model");
const { createClient } = require("../../util/duanju52");
const { buildSeriesDoc } = require("../../util/opsSeries");
const ShortVideo = require("../../models/shortVideo.model");
const { diffEpisodes } = require("../../util/opsHealth");
const { translateSeriesMeta } = require("../../util/translateMeta");
const { classifySeries } = require("../../util/classifySeries");
const { TAGS } = require("../../util/taxonomy");
const axiosRaw = require("axios");

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

// Key Gemini nằm trong Setting.subtitle (worker dùng chung) -> đọc mỗi lần gọi.
async function getGeminiCfg() {
  const s = await Setting.findOne({}).select("subtitle").lean();
  const sub = (s && s.subtitle) || {};
  // Ngôn ngữ dịch tên/mô tả bám theo đúng danh sách ngôn ngữ phụ đề để app không rơi vào cảnh
  // có phụ đề tiếng Thái mà tên phim vẫn tiếng Việt.
  const langs = Array.isArray(sub.langs) && sub.langs.length
    ? sub.langs
    : [sub.targetLang || "vi", sub.secondLang || "en"];
  return { apiKey: sub.geminiApiKey || "", model: sub.geminiModel || "gemini-2.5-flash", langs };
}

// Kiểm khoá vận hành đúng chưa (trang web dùng để mở khoá).
exports.ping = async (req, res) => {
  return res.status(200).json({ status: true, message: "ok" });
};

// Danh sách category + language để chọn khi nhập phim.
exports.options = async (req, res) => {
  try {
    const [categories, languages] = await Promise.all([
      Category.find({ isActive: true }).select("_id name").sort({ sortOrder: 1, name: 1 }).lean(),
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
    // page chỉ còn ý nghĩa với tìm kiếm: bảng xếp hạng (52api) cấm tham số page.
    const { provider = "hg", type = "top", keyword = "", cellId = "", subCellId = "", page = "1" } = req.query;
    const items =
      type === "search"
        ? await duanju.search(provider, keyword, Number(page) || 1)
        : cellId
          ? await duanju.topList(cellId, subCellId)
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

// Dịch tên/mô tả sau khi đã trả lời người vận hành. Lỗi ở đây không ảnh hưởng phim đã nhập:
// bản ghi vẫn giữ tên tiếng Trung kèm cờ chưa dịch để bấm "Dịch lại".
async function enrichSeriesInBackground(seriesId, info, hasCategory) {
  const cfg = await getGeminiCfg();
  const src = { name: info.name, description: info.description };
  const cats = hasCategory ? [] : await Category.find({ isActive: true }).select("name hint").lean();

  // Dịch và xếp thể loại chạy song song, cả hai đều đọc bản gốc tiếng Trung.
  const [meta, cls] = await Promise.all([
    translateSeriesMeta(src, cfg),
    cats.length
      ? classifySeries(src, { apiKey: cfg.apiKey, model: cfg.model, categories: cats, tags: TAGS })
      : Promise.resolve({ category: "", tags: [], error: "" }),
  ]);

  const set = {};
  const got = Object.keys(meta.i18n || {});
  if (got.length) {
    const vi = meta.i18n.vi || {};
    const en = meta.i18n.en || {};
    set.i18n = meta.i18n;
    set.metaMissingLangs = meta.missing || [];
    set.metaTranslatedAt = new Date();
    if (vi.name) {
      set.name = vi.name;
      set.description = vi.description || "";
    }
    if (en.name) {
      set.nameEn = en.name;
      set.descriptionEn = en.description || "";
    }
  } else {
    console.error(`ops nền: không dịch được phim ${seriesId} (${meta.error})`);
  }

  if (cls.tags && cls.tags.length) set.tags = cls.tags;
  if (cls.category) {
    const c = cats.find((x) => x.name === cls.category);
    if (c) set.category = c._id;
  } else if (cats.length) {
    console.error(`ops nền: không xếp được thể loại cho ${seriesId} (${cls.error})`);
  }

  if (!Object.keys(set).length) return;
  await MovieSeries.updateOne({ _id: seriesId }, { $set: set });
  console.log(`ops nền xong: ${seriesId} -> dịch [${got.join(", ")}]${cls.category ? `, thể loại "${cls.category}"` : ""}`);
}

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
    // Tạo phim NGAY với tên gốc rồi mới dịch ở nền: dịch mất ~5 giây, bắt người vận hành ngồi
    // nhìn nút "Đang nhập..." chừng đó là vô ích — worker cũng chỉ cần bản ghi để bắt đầu tải.
    // Dịch xong thì cập nhật vào chính bản ghi đó; bảng sức khoẻ tự làm mới 15 giây một lần.
    const doc = buildSeriesDoc({ provider, sourceId, info, categoryId, languageId, type: Number(type) });
    const created = await MovieSeries.create(doc);
    enrichSeriesInBackground(created._id, info, !!categoryId).catch((e) => console.error("ops xử lý nền lỗi:", e.message));
    return res.status(200).json({
      status: true,
      message: `Đã nhập "${created.name}" (${doc.sourceEpisodeCount} tập). Worker sẽ render ở vòng quét kế tiếp; tên phim và thể loại đang được xử lý.`,
      data: { _id: created._id, bookId: created.bookId },
    });
  } catch (error) {
    console.error("ops import error:", error.message);
    return res.status(error.is52api ? 502 : 400).json({ status: false, message: error.message });
  }
};

// Bảng sức khoẻ: chỉ đọc Mongo, KHÔNG gọi 52api -> bấm bao nhiêu lần cũng không tốn quota.
exports.queue = async (req, res) => {
  try {
    const series = await MovieSeries.find({ sourceProvider: /^52api-/ })
      .select("_id name nameEn bookId sourceEpisodeCount updatedAt zhBottomRatio zhBottomSource metaTranslatedAt metaMissingLangs")
      .sort({ updatedAt: -1 })
      .lean();

    const ids = series.map((s) => s._id);
    const [stats, trackStats] = await Promise.all([
      ShortVideo.aggregate([
        { $match: { movieSeries: { $in: ids } } },
        {
          $group: {
            _id: "$movieSeries",
            rendered: { $sum: 1 },
            burned: { $sum: { $cond: [{ $eq: ["$burnedLang", "vi"] }, 1, 0] } },
          },
        },
      ]),
      // Đếm theo từng ngôn ngữ thay vì cứng vi/en: thêm tiếng Thái hay Indo là bảng tự có cột.
      ShortVideo.aggregate([
        { $match: { movieSeries: { $in: ids } } },
        { $unwind: "$subTracks" },
        { $group: { _id: { series: "$movieSeries", lang: "$subTracks.lang" }, n: { $sum: 1 } } },
      ]),
    ]);
    const byId = new Map(stats.map((s) => [String(s._id), s]));
    const langsById = new Map();
    for (const t of trackStats) {
      const key = String(t._id.series);
      const cur = langsById.get(key) || {};
      cur[t._id.lang] = t.n;
      langsById.set(key, cur);
    }

    return res.status(200).json({
      status: true,
      data: series.map((s) => {
        const st = byId.get(String(s._id)) || { rendered: 0, burned: 0 };
        const langs = langsById.get(String(s._id)) || {};
        return {
          _id: s._id,
          name: s.name,
          bookId: s.bookId || "",
          total: s.sourceEpisodeCount || 0,
          rendered: st.rendered,
          langs,
          burned: st.burned,
          nameEn: s.nameEn || "",
          translated: !!s.metaTranslatedAt,
          missingLangs: s.metaMissingLangs || [],
          zhBottomRatio: typeof s.zhBottomRatio === "number" ? s.zhBottomRatio : null,
          zhBottomSource: s.zhBottomSource || "",
          updatedAt: s.updatedAt,
        };
      }),
    });
  } catch (error) {
    console.error("ops queue error:", error.message);
    return res.status(500).json({ status: false, message: "Không lấy được bảng sức khoẻ" });
  }
};

// Dịch lại tên + mô tả của một phim đã có trong kho (dùng cho phim nhập trước khi có tính
// năng dịch, hoặc khi Gemini dịch hụt lúc nhập). Luôn dịch từ bản gốc tiếng Trung đã lưu.
exports.translateMeta = async (req, res) => {
  try {
    const bookId = String((req.body && req.body.bookId) || "");
    if (!bookId.includes(":")) return res.status(400).json({ status: false, message: "Thiếu bookId" });
    const doc = await MovieSeries.findOne({ bookId }).select("name description nameOriginal descriptionOriginal").lean();
    if (!doc) return res.status(404).json({ status: false, message: "Không tìm thấy phim" });

    // Phim nhập trước khi có tính năng này chưa có bản gốc riêng -> chính name/description
    // đang là tiếng Trung, lấy luôn làm nguồn dịch.
    const src = {
      name: doc.nameOriginal || doc.name,
      description: doc.descriptionOriginal || doc.description || "",
    };
    const meta = await translateSeriesMeta(src, await getGeminiCfg());
    const got = Object.keys(meta.i18n || {});
    if (!got.length) return res.status(502).json({ status: false, message: `Dịch không thành công: ${meta.error}` });

    const vi = meta.i18n.vi || {};
    const en = meta.i18n.en || {};
    const set = {
      i18n: meta.i18n,
      metaMissingLangs: meta.missing || [],
      nameOriginal: src.name,
      descriptionOriginal: src.description,
      metaTranslatedAt: new Date(),
    };
    // Chỉ ghi đè name/description khi có bản tiếng Việt mới, tránh xoá tên đang dùng.
    if (vi.name) {
      set.name = vi.name;
      set.description = vi.description || "";
    }
    if (en.name) {
      set.nameEn = en.name;
      set.descriptionEn = en.description || "";
    }
    await MovieSeries.updateOne({ bookId }, { $set: set });

    const shown = got.map((l) => `${l}: ${meta.i18n[l].name}`).join(" · ");
    const missing = meta.missing && meta.missing.length ? ` (chưa được: ${meta.missing.join(", ")})` : "";
    return res.status(200).json({ status: true, message: `Đã dịch ${shown}${missing}` });
  } catch (error) {
    console.error("ops translateMeta error:", error.message);
    return res.status(500).json({ status: false, message: "Không dịch được tên phim" });
  }
};

// Đặt tay vị trí đáy chữ Hán cho một phim (0-1 theo chiều cao khung hình).
// Dùng khi muốn CHỐT TRƯỚC khi render, hoặc khi OCR đo sai. Số đặt tay luôn thắng OCR.
exports.setSubPosition = async (req, res) => {
  try {
    const bookId = String((req.body && req.body.bookId) || "");
    const ratio = Number((req.body && req.body.ratio) != null ? req.body.ratio : NaN);
    if (!bookId.includes(":")) {
      return res.status(400).json({ status: false, message: "Thiếu bookId" });
    }
    // Chữ Hán của phim dọc luôn nằm nửa dưới khung hình; ngoài dải này là gõ nhầm.
    if (!isFinite(ratio) || ratio < 0.3 || ratio > 0.95) {
      return res.status(400).json({ status: false, message: "Vị trí phải trong khoảng 0.30 - 0.95" });
    }
    const r = await MovieSeries.updateOne(
      { bookId },
      { $set: { zhBottomRatio: ratio, zhBottomSource: "manual" } }
    );
    if (!r.matchedCount) {
      return res.status(404).json({ status: false, message: "Không tìm thấy phim" });
    }
    return res.status(200).json({ status: true, message: `Đã chốt vị trí ${Math.round(ratio * 100)}% cho phim.` });
  } catch (error) {
    console.error("ops setSubPosition error:", error.message);
    return res.status(500).json({ status: false, message: "Không lưu được vị trí phụ đề" });
  }
};

// Kiểm lệch một phim: tốn 1 lượt 52api nên chỉ chạy khi bấm nút.
exports.health = async (req, res) => {
  try {
    await getKey52();
    const bookId = String(req.query.bookId || "");
    const [provider, sourceId] = bookId.split(":");
    if (!provider || !sourceId) {
      return res.status(400).json({ status: false, message: "bookId phải dạng hg:123" });
    }
    const series = await MovieSeries.findOne({ bookId }).select("_id").lean();
    if (!series) return res.status(404).json({ status: false, message: "Không thấy phim" });

    const base = provider === "hm" ? "https://www.52api.cn/api/hm_duanju" : "https://www.52api.cn/api/hg_duanju";
    const r = await axiosRaw.get(base, { params: { key: cachedKey, type: "detail", id: sourceId }, timeout: 60000 });
    const body = r.data || {};
    if (body.code && Number(body.code) !== 200) {
      return res.status(502).json({ status: false, message: body.msg || "52api lỗi" });
    }
    const lists = ((body.data || body).lists) || [];
    const sourceEpisodes = lists.map((ep, i) => ({ index: i, videoId: String(ep.video_id) }));

    const rows = await ShortVideo.find({ movieSeries: series._id }).select("episodeNumber sourceVideoId").lean();
    return res.status(200).json({ status: true, data: diffEpisodes(sourceEpisodes, rows) });
  } catch (error) {
    console.error("ops health error:", error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};
