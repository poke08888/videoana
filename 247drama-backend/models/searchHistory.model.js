const mongoose = require("mongoose");

const SearchHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    movieSeriesId: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries", default: null },
    keyword: { type: String, trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Optional TTL index if you want to remove old searches after 1 year
// SearchHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 365*24*60*60 });

module.exports = mongoose.model("SearchHistory", SearchHistorySchema);
