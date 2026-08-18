const mongoose = require("mongoose");

const userVideoListSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    videos: [
      {
        movieSeries: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries", required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

userVideoListSchema.index({ userId: 1, "videos.videoId": 1 });

module.exports = mongoose.model("UserVideoList", userVideoListSchema);
