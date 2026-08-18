const mongoose = require("mongoose");

const UserAutoUnlockStatusSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    movieSeries: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries", default: null },
    isAutoUnlockEpisodes: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

UserAutoUnlockStatusSchema.index({ userId: 1, movieSeries: 1 }, { unique: true });

module.exports = mongoose.model("UserAutoUnlockStatus", UserAutoUnlockStatusSchema);
