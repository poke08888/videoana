const mongoose = require("mongoose");

const shortVideoSchema = new mongoose.Schema(
  {
    movieSeries: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries", default: null },
    episodeNumber: { type: Number }, //episodeNumber zero consider as trailer
    videoImage: { type: String, trim: true },
    videoUrl: { type: String, trim: true },
    duration: { type: Number, default: 0 }, //that value always save in seconds
    coin: { type: Number, default: 0 }, //if isLocked true then coin must be needed
    isLocked: { type: Boolean, default: true },
    releaseDate: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("ShortVideo", shortVideoSchema);
