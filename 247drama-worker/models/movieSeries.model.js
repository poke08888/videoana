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
    sourceEpisodeCount: { type: Number, default: 0 } // tổng số tập bên nguồn (biết khi nào import xong -> auto-resume sau restart)
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
