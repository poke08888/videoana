const mongoose = require("mongoose");

const adRewardSchema = new mongoose.Schema(
  {
    adLabel: { type: String, trim: true, default: "" },
    adDisplayInterval: { type: Number, default: 2 }, //Indicates the pause duration in seconds between ads
    coinEarnedFromAd: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

adRewardSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AdReward", adRewardSchema);
