const { HISTORY_TYPE } = require("../types/constant");

const mongoose = require("mongoose");

const historySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "ShortVideo", default: null },
    movieSeries: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries", default: null },
    type: { type: Number, enum: HISTORY_TYPE },
    coin: { type: Number, default: 0 },

    rewardCoinUsed: { type: Number, default: 0 },
    purchasedCoinUsed: { type: Number, default: 0 },
    adCoinUsed: { type: Number, default: 0 },
    dailyCoinUsed: { type: Number, default: 0 },
    loginCoinUsed: { type: Number, default: 0 },
    // referralCoinUsed: { type: Number, default: 0 },
      
    price: { type: Number, default: 0 }, //for coin or vip plan purchase
    offerPrice: { type: Number, default: 0 }, //for coin or vip plan purchase
    paymentGateway: { type: String, default: "" },
    purchaseToken: { type: String, unique: true, sparse: true, trim: true },
    productId: { type: String, default: "" },
    uniqueId: { type: String, unique: true, trim: true, default: "" },
    date: { type: String, default: "" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

historySchema.index({ createdAt: -1 });
historySchema.index({ userId: 1 });
historySchema.index({ createdAt: 1, type: 1 });

module.exports = new mongoose.model("History", historySchema);
