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
    sourceProvider: { type: String, default: "" }, // "52api-hg" | "52api-hm" ...
    sourceVideoId: { type: String, default: "" }, // video_id gốc bên 52api (để re-mirror nếu cần)
    subLang: { type: String, default: "" }, // ngôn ngữ phụ đề đã burn ("vi" nếu đã auto-sub tiếng Việt)
    subSource: { type: String, default: "" }, // nguồn phụ đề: "ocr" | "whisper" (đánh dấu để resume import)
    subTracks: { type: [{ lang: String, url: String, _id: false }], default: undefined }, // track WebVTT rời (chế độ soft)
    burnedLang: { type: String, default: "" }, // ngôn ngữ đã đốt vào video ("" nếu video sạch/soft)
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("ShortVideo", shortVideoSchema);
