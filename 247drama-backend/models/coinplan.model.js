const mongoose = require("mongoose");

const coinplanSchema = new mongoose.Schema(
  {
    icon: { type: String, default: "" },
    coin: { type: Number, default: 0 },
    bonusCoin: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    offerPrice: { type: Number, default: 0 },
    productKey: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

coinplanSchema.index({ coin: 1 });
coinplanSchema.index({ isActive: 1 });

module.exports = new mongoose.model("CoinPlan", coinplanSchema);
