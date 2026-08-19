const { CONTENT_TYPE } = require("../types/constant");

const mongoose = require("mongoose");

const movieSeriesSchema = new mongoose.Schema(
  {
    language: { type: mongoose.Schema.Types.ObjectId, ref: "Language", default: null },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    name: { type: String, trim: true, required: true },
    description: { type: String, trim: true },
    banner: { type: String, trim: true },
    thumbnail: { type: String, trim: true },
    type: { type: Number, enum: CONTENT_TYPE, required: true }, // Either 'Movie' or 'WebSeries'
    maxAdsForFreeView: { type: Number, default: 0 }, //if video is locked then to that ad's limit after watching ad he has right to view locked episodes
    releaseDate: { type: Date, default: Date.now },
    isTrending: { type: Boolean, default: false },
    isAutoAnimateBanner: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    bookId: { type: String, unique: true, sparse: true },
    // Worker 52api ghi 2 field này; khai ở đây để backend tạo phim mới không bị Mongoose strict vứt.
    sourceProvider: { type: String, trim: true },
    sourceEpisodeCount: { type: Number, default: 0 },
    // Phim do web vận hành tạo -> chỉ những phim này mới được xoá qua /api/ops.
    createdByOps: { type: Boolean, default: false },
    // Đáy dòng chữ Hán của phim (0-1 theo chiều cao khung hình). Worker đo bằng OCR ở tập
    // đầu rồi chốt cho cả phim; người vận hành có thể đặt tay ("manual") để chốt trước khi chạy.
    // Tên/mô tả: name + description luôn là bản NGƯỜI XEM VIỆT NAM thấy (đã dịch),
    // *En là bản tiếng Anh, *Original giữ nguyên tiếng Trung của nguồn để đối chiếu và dịch lại.
    nameEn: { type: String, trim: true, default: "" },
    descriptionEn: { type: String, trim: true, default: "" },
    // Bản dịch mọi ngôn ngữ: { vi: {name, description}, en: {...}, th: {...}, id: {...} }.
    // name/description ở trên là bản tiếng Việt (app cũ đọc thẳng), i18n là nguồn đầy đủ.
    i18n: { type: Object, default: {} },
    metaMissingLangs: { type: [String], default: [] },
    nameOriginal: { type: String, trim: true, default: "" },
    descriptionOriginal: { type: String, trim: true, default: "" },
    metaTranslatedAt: { type: Date, default: null },
    zhBottomRatio: { type: Number, default: null },
    zhBottomSource: { type: String, default: "" }
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

movieSeriesSchema.index({ isActive: 1 });
movieSeriesSchema.index({ releaseDate: -1 });
movieSeriesSchema.index({ language: 1 });

module.exports = new mongoose.model("MovieSeries", movieSeriesSchema);
