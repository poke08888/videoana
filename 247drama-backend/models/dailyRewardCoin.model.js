const mongoose = require("mongoose");

const dailyRewardSchema = new mongoose.Schema(
  {
    day: { type: Number, required: true }, // Day from 1 to 7
    dailyRewardCoin: { type: Number, default: 100 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

dailyRewardSchema.index({ day: 1 });

module.exports = mongoose.model("DailyReward", dailyRewardSchema);
