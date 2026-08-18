const mongoose = require("mongoose");

const { LOGIN_TYPE } = require("../types/constant");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    username: { type: String, trim: true, default: "" },
    gender: { type: String, trim: true, default: "" },
    bio: { type: String, trim: true, default: "" },
    age: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    profilePic: { type: String, trim: true, default: "" },
    fcmToken: { type: String, trim: true, default: null },

    email: { type: String, trim: true, unique: true, default: "" },
    mobileNumber: { type: String, trim: true, default: "" },
    identity: { type: String, trim: true, default: "" },
    uniqueId: { type: String, trim: true, unique: true, default: "" },

    loginType: { type: Number, enum: LOGIN_TYPE }, //1.mobileNumber 2.google 3.quick(identity) 4.apple

    coin: { type: Number, default: 0 }, //total coin of the user ( reward coin + purchased coin)
    rewardCoin: { type: Number, default: 0 },
    purchasedCoin: { type: Number, default: 0 },

    adRewardCoin: { type: Number, default: 0 },
    dailyRewardCoin: { type: Number, default: 0 },
    loginRewardCoin: { type: Number, default: 0 },
    // referralRewardCoin: { type: Number, default: 0 },

    isVip: { type: Boolean, default: false },
    vipPlanStartDate: { type: String, default: null },
    vipPlanEndDate: { type: String, default: null },
    currentPlan: {
      validity: { type: Number, default: 1 },
      validityType: { type: String, default: "" },
      price: { type: Number, default: 0 },
      offerPrice: { type: Number, default: 0 },
      tags: { type: String, default: "" },
    },

    coinplan: [
      {
        coin: { type: Number, default: 0 },
        bonusCoin: { type: Number, default: 0 },
        price: { type: Number, default: 0 },
        offerPrice: { type: Number, default: 0 },
        purchasedAt: { type: Date, default: Date.now },
      },
    ],

    isBlock: { type: Boolean, default: false },

    watchAds: {
      count: { type: Number, default: 0 },
      date: { type: Date, default: null },
    },

    episodeUnlockAds: [
      {
        movieWebseriesId: { type: mongoose.Schema.Types.ObjectId, ref: "MovieSeries", default: null },
        count: { type: Number, default: 0 },
        date: { type: Date, default: null },
      },
    ],

    referralCode: { type: String, trim: true, unique: true },
    isReferral: { type: Boolean, default: false }, //True if the user was used referral code
    referralCount: { type: Number, default: 0 }, //how many users have signed up using a specific user's referral code

    date: { type: String, default: "" },
    lastLogin: { type: Date, default: null },
    hasLinkedPhone: { type: Boolean, default: false },
    hasLinkedEmail: { type: Boolean, default: false },
    hasLinkedZalo: { type: Boolean, default: false },
    hasEnabledNotification: { type: Boolean, default: false },
    socialFollows: { type: mongoose.Schema.Types.Mixed, default: {} },
    completedCustomTasks: { type: Array, default: [] },
    watchTimeDate: { type: Date, default: null },
    watchTimeTasksClaimed: { type: Array, default: [] },
    dailyWatchTime: { type: Number, default: 0 },

    firebaseUid: { type: String, default: "" }, //firebase uid
    signInProvider: { type: String, default: "" },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: false,
  }
);

module.exports = mongoose.model("User", userSchema);
