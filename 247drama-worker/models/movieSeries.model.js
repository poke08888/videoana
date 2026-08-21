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
    bookId: { type: String, unique: true, sparse: true }, // khoá dedup nguồn ngoài; 52api lưu dạng "hg:<id>" / "hm:<id>"
    sourceProvider: { type: String, default: "" }, // "dramabox" | "52api-hg" | "52api-hm"
    sourceEpisodeCount: { type: Number, default: 0 }, // tổng số tập bên nguồn (biết khi nào import xong -> auto-resume sau restart)
    // Đáy dòng chữ Hán của phim này (0-1 theo chiều cao khung hình), đo bằng OCR ở tập đầu
    // rồi chốt cho cả phim -> mọi tập đặt phụ đề cùng một chỗ. Mỗi phim một giá trị khác nhau.
    zhBottomRatio: { type: Number, default: null },
    zhBottomSource: { type: String, default: "" }, // "auto" = OCR đo, "manual" = người vận hành đặt tay
    // Cổng lên app do backend chấm (util/publishGate.js). Worker chỉ ĐỌC: completeness.badEps
    // là danh sách tập hỏng cần render đè lại.
    isComplete: { type: Boolean, default: false },
    completeness: {
      expected: { type: Number, default: 0 },
      have: { type: Number, default: 0 },
      missing: { type: Number, default: 0 },
      badEps: { type: [Number], default: [] },
      reason: { type: String, default: "" },
      checkedAt: { type: Date, default: null },
    }
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
