const mongoose = require("mongoose");

const SearchCountSchema = new mongoose.Schema(
  {
    movieSeriesId: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries", default: null },
    count: { type: Number, default: 1 },
    lastSearchedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("SearchCount", SearchCountSchema);
