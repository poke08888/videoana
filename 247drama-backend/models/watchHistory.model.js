const mongoose = require("mongoose");

const watchHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    movieSeries: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries" },
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "ShortVideo" },
    totalWatchTime: { type: Number, default: 0 }, //that value always save in seconds
    videoDuration: { type: Number, default: 0 },
    accessModeUsed: { type: String, enum: ["FREE", "COIN", "VIP"], default: "FREE" },
    watchedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

watchHistorySchema.index({ userId: 1 });
watchHistorySchema.index({ videoId: 1 });
watchHistorySchema.index({ watchedAt: 1 });

module.exports = mongoose.model("WatchHistory", watchHistorySchema);
