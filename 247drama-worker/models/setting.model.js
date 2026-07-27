//Mongoose
const mongoose = require("mongoose");

//Setting Schema
const settingSchema = new mongoose.Schema(
  {
    googlePlaySwitch: { type: Boolean, default: false },
    googlePayIosEnabled: { type: Boolean, default: false },

    stripeSwitch: { type: Boolean, default: false },
    stripeIosEnabled: { type: Boolean, default: false },
    stripePublishableKey: { type: String, default: "STRIPE PUBLISHABLE KEY" },
    stripeSecretKey: { type: String, default: "STRIPE SECRET KEY" },

    razorPaySwitch: { type: Boolean, default: false },
    razorpayIosEnabled: { type: Boolean, default: false },
    razorPayId: { type: String, default: "RAZOR PAY ID" },
    razorSecretKey: { type: String, default: "RAZOR SECRET KEY" },

    flutterWaveSwitch: { type: Boolean, default: false },
    flutterWaveId: { type: String, default: "FLUTTER WAVE ID" },
    flutterwaveIosEnabled: { type: Boolean, default: false },

    paystackAndroidEnabled: { type: Boolean, default: false },
    paystackIosEnabled: { type: Boolean, default: false },
    paystackPublicKey: { type: String, default: "PAYSTACK PUBLIC KEY" },
    paystackSecretKey: { type: String, default: "PAYSTACK SECRET KEY" },

    cashfreeAndroidEnabled: { type: Boolean, default: false },
    cashfreeIosEnabled: { type: Boolean, default: false },
    cashfreeClientId: { type: String, default: "CASHFREE CLIENT ID" },
    cashfreeClientSecret: { type: String, default: "CASHFREE CLIENT SECRET" },

    paypalAndroidEnabled: { type: Boolean, default: false },
    paypalIosEnabled: { type: Boolean, default: false },
    paypalClientId: { type: String, default: "PAYPAL CLIENT ID" },
    paypalSecretKey: { type: String, default: "PAYPAL SECRET KEY" },

    privacyPolicyLink: { type: String, default: "PRIVACY POLICY LINK" },
    termsOfUsePolicyLink: { type: String, default: "TERMS OF USE POLICY LINK" },
    contactEmail: { type: String, default: "support@example.com" },

    resendApiKey: { type: String, default: "RESEND API KEY" },

    androidAppVersion: { type: String, default: "" },
    iosAppVersion: { type: String, default: "" },
    androidAppLink: { type: String, default: "" },
    iosAppLink: { type: String, default: "" },

    currency: {
      name: { type: String, default: "", unique: true },
      symbol: { type: String, default: "", unique: true },
      countryCode: { type: String, default: "" },
      currencyCode: { type: String, default: "" },
      isDefault: { type: Boolean, default: false },
    }, //default currency

    durationOfShorts: { type: Number, default: 0 }, //that value always save in second
    freeEpisodesForNonVip: { type: Number, default: 5 }, //non-VIP users get a limited number of free episodes
    privateKey: { type: Object, default: {} }, //firebase.json handle for notification

    //withdrawal setting
    minCoinForCashOut: { type: Number, default: 0 }, //min coin requried for convert coin to default currency i.e., 1000 coin = 1 $
    minWithdrawalRequestedCoin: { type: Number, default: 0 },

    //Referral Setting
    referralRewardCoins: { type: Number, default: 100 },

    //engagement setting
    watchingVideoRewardCoins: { type: Number, default: 100 },
    commentingRewardCoins: { type: Number, default: 100 },
    likeVideoRewardCoins: { type: Number, default: 100 },

    //loginReward setting
    loginRewardCoins: { type: Number, default: 100 },

    // Storage Settings
    storage: {
      local: { type: Boolean, default: true }, // Local storage active by default
      awsS3: { type: Boolean, default: false },
      digitalOcean: { type: Boolean, default: false },
    },

    //DigitalOcean Spaces
    doEndpoint: { type: String, default: "" },
    doAccessKey: { type: String, default: "" },
    doSecretKey: { type: String, default: "" },
    doHostname: { type: String, default: "" },
    doBucketName: { type: String, default: "" },
    doRegion: { type: String, default: "" },

    //AWS S3
    awsEndpoint: { type: String, default: "" },
    awsAccessKey: { type: String, default: "" },
    awsSecretKey: { type: String, default: "" },
    awsHostname: { type: String, default: "" },
    awsBucketName: { type: String, default: "" },
    awsRegion: { type: String, default: "" },

    //Advertisement setting
    maxAdPerDay: { type: Number, default: 1 },

    isGoogle: { type: Boolean, default: false },
    android: {
      google: {
        interstitial: { type: String, default: "android_interstitial_id" },
        native: { type: String, default: "android_native_id" },
        reward: { type: String, default: "android_reward_id" },
        appOpen: { type: String, default: "android_app_open_id" },
      },
    },
    ios: {
      google: {
        interstitial: { type: String, default: "ios_interstitial_id" },
        native: { type: String, default: "ios_native_id" },
        reward: { type: String, default: "ios_reward_id" },
        appOpen: { type: String, default: "ios_app_open_id" },
      },
    },

    androidAssetLinks: { type: Array, default: [] },
    appleAppSiteAssociation: { type: mongoose.Schema.Types.Mixed, default: {} },

    websiteUrl: { type: String, default: "" }
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("Setting", settingSchema);
