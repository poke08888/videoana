const mongoose = require("mongoose");

const CoinPlanHistorySchema = new mongoose.Schema(
  {
    uniqueId: { type: String, default: "" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    coinplanId: { type: mongoose.Schema.Types.ObjectId, ref: "CoinPlan", default: null },
    coin: { type: Number, default: 0 },
    bonusCoin: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    offerPrice: { type: Number, default: 0 },
    paymentGateway: { type: String },
    purchaseToken: { type: String, unique: true, sparse: true, trim: true },
    productId: { type: String, default: "" },
    date: { type: String, default: "" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

CoinPlanHistorySchema.index({ userId: 1 });
CoinPlanHistorySchema.index({ coinplanId: 1 });

module.exports = mongoose.model("CoinPlanHistory", CoinPlanHistorySchema);
