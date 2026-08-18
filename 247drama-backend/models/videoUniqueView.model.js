const mongoose = require("mongoose");

const videoUniqueViewSchema = new mongoose.Schema(
  {
    movieSeriesId: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries", default: null },
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "ShortVideo", default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    accessMode: { type: String, enum: ["FREE", "COIN", "VIP"] },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = mongoose.model("VideoUniqueView", videoUniqueViewSchema);

videoUniqueViewSchema.index({ videoId: 1, userId: 1 }, { unique: true });
