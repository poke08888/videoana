const mongoose = require("mongoose");

const UserVideoStatusSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    shortVideoId: { type: mongoose.Schema.Types.ObjectId, ref: "ShortVideo", required: true },
    isLocked: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

UserVideoStatusSchema.index({ userId: 1, shortVideoId: 1 }, { unique: true });
UserVideoStatusSchema.index({ shortVideoId: 1 });

module.exports = mongoose.model("UserVideoStatus", UserVideoStatusSchema);
