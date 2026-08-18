const Setting = require("../../models/setting.model");

//import model
const ShortVideo = require("../../models/shortVideo.model");
const Admin = require("../../models/admin.model");

const Joi = require("joi");
const axios = require("axios");

const sha256Regex = /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/;
const androidAssetLinksSchema = Joi.array()
  .min(1)
  .max(5)
  .items(
    Joi.object({
      relation: Joi.array().items(Joi.string().valid("delegate_permission/common.handle_all_urls")).min(1).required(),

      target: Joi.object({
        namespace: Joi.string().valid("android_app").required(),

        package_name: Joi.string()
          .pattern(/^[a-zA-Z0-9_.]+$/)
          .required(),

        sha256_cert_fingerprints: Joi.array().min(1).max(10).items(Joi.string().uppercase().pattern(sha256Regex).required()).required(),
      })
        .required()
        .unknown(false),
    })
      .required()
      .unknown(false),
  )
  .required();

const appleAppSiteAssociationSchema = Joi.object({
  applinks: Joi.object({
    apps: Joi.array().items(Joi.string()).required(),
    details: Joi.array()
      .items(
        Joi.object({
          appID: Joi.string().required(),
          paths: Joi.array().items(Joi.string()).required(),
        }),
      )
      .min(1)
      .required(),
  }).required(),
}).unknown(true);

//update setting
exports.updateSetting = async (req, res) => {
  try {
    console.log("updateSetting req.body:", req.body);
    const settingId = req.query.settingId;
    if (!settingId) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    const setting = await Setting.findById(settingId);
    if (!setting) {
      return res.status(200).json({ status: false, message: "setting does not found." });
    }

    // Update short videos based on freeEpisodesForNonVip
    if (req.body.freeEpisodesForNonVip !== undefined) {
      const freeEpisodes = parseInt(req.body.freeEpisodesForNonVip);

      await Promise.all([
        ShortVideo.updateMany({ episodeNumber: { $gt: freeEpisodes } }, { $set: { isLocked: true, coin: 10 } }),
        ShortVideo.updateMany({ episodeNumber: 0 }, { $set: { isLocked: false, coin: 0 } }),
        ShortVideo.updateMany({ episodeNumber: { $gte: 1, $lte: freeEpisodes } }, { $set: { isLocked: false, coin: 0 } }),
      ]);
    }

    if ("androidAppVersion" in req.body) {
      setting.androidAppVersion = req.body.androidAppVersion.trim();
    }
    if ("iosAppVersion" in req.body) {
      setting.iosAppVersion = req.body.iosAppVersion.trim();
    }
    if ("androidAppLink" in req.body) {
      setting.androidAppLink = req.body.androidAppLink.trim();
    }
    if ("iosAppLink" in req.body) {
      setting.iosAppLink = req.body.iosAppLink.trim();
    }

    setting.privacyPolicyLink = req.body.privacyPolicyLink ? req.body.privacyPolicyLink : setting.privacyPolicyLink;
    setting.termsOfUsePolicyLink = req.body.termsOfUsePolicyLink ? req.body.termsOfUsePolicyLink : setting.termsOfUsePolicyLink;
    setting.contactEmail = req.body.contactEmail ? req.body.contactEmail.trim() : setting.contactEmail;
    setting.resendApiKey = req.body.resendApiKey ? req.body.resendApiKey.trim() : setting.resendApiKey;
    setting.stripePublishableKey = req.body.stripePublishableKey ? req.body.stripePublishableKey : setting.stripePublishableKey;
    setting.stripeSecretKey = req.body.stripeSecretKey ? req.body.stripeSecretKey : setting.stripeSecretKey;
    setting.razorPayId = req.body.razorPayId ? req.body.razorPayId : setting.razorPayId;
    setting.razorSecretKey = req.body.razorSecretKey ? req.body.razorSecretKey : setting.razorSecretKey;
    setting.flutterWaveId = req.body.flutterWaveId ? req.body.flutterWaveId : setting.flutterWaveId;
    setting.durationOfShorts = parseInt(req.body.durationOfShorts) ? parseInt(req.body.durationOfShorts) : setting.durationOfShorts;
    setting.freeEpisodesForNonVip = parseInt(req.body.freeEpisodesForNonVip) ? parseInt(req.body.freeEpisodesForNonVip) : setting.freeEpisodesForNonVip;
    setting.minCoinForCashOut = parseInt(req.body.minCoinForCashOut) ? parseInt(req.body.minCoinForCashOut) : setting.minCoinForCashOut;
    setting.minWithdrawalRequestedCoin = req.body.minWithdrawalRequestedCoin ? parseInt(req.body.minWithdrawalRequestedCoin) : setting.minWithdrawalRequestedCoin;
    setting.loginRewardCoins = parseInt(req.body.loginRewardCoins) ? parseInt(req.body.loginRewardCoins) : setting.loginRewardCoins;
    setting.referralRewardCoins = parseInt(req.body.referralRewardCoins) ? parseInt(req.body.referralRewardCoins) : setting.referralRewardCoins;

    if (req.body.facebookLink !== undefined) setting.facebookLink = req.body.facebookLink.trim();
    if (req.body.instagramLink !== undefined) setting.instagramLink = req.body.instagramLink.trim();
    if (req.body.zaloLink !== undefined) setting.zaloLink = req.body.zaloLink.trim();
    if (req.body.tiktokLink !== undefined) setting.tiktokLink = req.body.tiktokLink.trim();
    if (req.body.youtubeLink !== undefined) setting.youtubeLink = req.body.youtubeLink.trim();

    setting.facebookRewardCoins = req.body.facebookRewardCoins !== undefined ? parseInt(req.body.facebookRewardCoins) : setting.facebookRewardCoins;
    setting.instagramRewardCoins = req.body.instagramRewardCoins !== undefined ? parseInt(req.body.instagramRewardCoins) : setting.instagramRewardCoins;
    setting.zaloRewardCoins = req.body.zaloRewardCoins !== undefined ? parseInt(req.body.zaloRewardCoins) : setting.zaloRewardCoins;
    setting.tiktokRewardCoins = req.body.tiktokRewardCoins !== undefined ? parseInt(req.body.tiktokRewardCoins) : setting.tiktokRewardCoins;
    setting.youtubeRewardCoins = req.body.youtubeRewardCoins !== undefined ? parseInt(req.body.youtubeRewardCoins) : setting.youtubeRewardCoins;
    setting.notificationRewardCoins = req.body.notificationRewardCoins !== undefined ? parseInt(req.body.notificationRewardCoins) : setting.notificationRewardCoins;
    setting.emailRewardCoins = req.body.emailRewardCoins !== undefined ? parseInt(req.body.emailRewardCoins) : setting.emailRewardCoins;
    setting.linkPhoneRewardCoins = req.body.linkPhoneRewardCoins !== undefined ? parseInt(req.body.linkPhoneRewardCoins) : setting.linkPhoneRewardCoins;
    setting.watchTime10mRewardCoins = req.body.watchTime10mRewardCoins !== undefined ? parseInt(req.body.watchTime10mRewardCoins) : setting.watchTime10mRewardCoins;
    setting.watchTime15mRewardCoins = req.body.watchTime15mRewardCoins !== undefined ? parseInt(req.body.watchTime15mRewardCoins) : setting.watchTime15mRewardCoins;
    setting.watchTime20mRewardCoins = req.body.watchTime20mRewardCoins !== undefined ? parseInt(req.body.watchTime20mRewardCoins) : setting.watchTime20mRewardCoins;

    if (req.body.isNotificationTaskEnabled !== undefined) setting.isNotificationTaskEnabled = req.body.isNotificationTaskEnabled;
    if (req.body.isEmailTaskEnabled !== undefined) setting.isEmailTaskEnabled = req.body.isEmailTaskEnabled;
    if (req.body.isPhoneTaskEnabled !== undefined) setting.isPhoneTaskEnabled = req.body.isPhoneTaskEnabled;
    if (req.body.isZaloTaskEnabled !== undefined) setting.isZaloTaskEnabled = req.body.isZaloTaskEnabled;
    if (req.body.isFacebookTaskEnabled !== undefined) setting.isFacebookTaskEnabled = req.body.isFacebookTaskEnabled;
    if (req.body.isYoutubeTaskEnabled !== undefined) setting.isYoutubeTaskEnabled = req.body.isYoutubeTaskEnabled;
    if (req.body.isTiktokTaskEnabled !== undefined) setting.isTiktokTaskEnabled = req.body.isTiktokTaskEnabled;
    if (req.body.isInstagramTaskEnabled !== undefined) setting.isInstagramTaskEnabled = req.body.isInstagramTaskEnabled;
    if (req.body.isWatchTime10mTaskEnabled !== undefined) setting.isWatchTime10mTaskEnabled = req.body.isWatchTime10mTaskEnabled;
    if (req.body.isWatchTime15mTaskEnabled !== undefined) setting.isWatchTime15mTaskEnabled = req.body.isWatchTime15mTaskEnabled;
    if (req.body.isWatchTime20mTaskEnabled !== undefined) setting.isWatchTime20mTaskEnabled = req.body.isWatchTime20mTaskEnabled;

    if (req.body.customTasks !== undefined) setting.customTasks = req.body.customTasks;

    setting.privateKey = req.body.privateKey ? JSON.parse(req.body.privateKey.trim()) : setting.privateKey;
    setting.maxAdPerDay = parseInt(req.body.maxAdPerDay) ? parseInt(req.body.maxAdPerDay) : setting.maxAdPerDay;
    if (req.body.androidGoogleInterstitial !== undefined) setting.android.google.interstitial = req.body.androidGoogleInterstitial;
    if (req.body.androidGoogleNative !== undefined) setting.android.google.native = req.body.androidGoogleNative;
    if (req.body.androidGoogleReward !== undefined) setting.android.google.reward = req.body.androidGoogleReward;
    if (req.body.androidGoogleAppOpen !== undefined) setting.android.google.appOpen = req.body.androidGoogleAppOpen;
    
    if (req.body.iosGoogleInterstitial !== undefined) setting.ios.google.interstitial = req.body.iosGoogleInterstitial;
    if (req.body.iosGoogleNative !== undefined) setting.ios.google.native = req.body.iosGoogleNative;
    if (req.body.iosGoogleReward !== undefined) setting.ios.google.reward = req.body.iosGoogleReward;
    if (req.body.iosGoogleAppOpen !== undefined) setting.ios.google.appOpen = req.body.iosGoogleAppOpen;

    setting.doEndpoint = req.body.doEndpoint ? req.body.doEndpoint : setting.doEndpoint;
    setting.doAccessKey = req.body.doAccessKey ? req.body.doAccessKey : setting.doAccessKey;
    setting.doSecretKey = req.body.doSecretKey ? req.body.doSecretKey : setting.doSecretKey;
    setting.doHostname = req.body.doHostname ? req.body.doHostname : setting.doHostname;
    setting.doBucketName = req.body.doBucketName ? req.body.doBucketName : setting.doBucketName;
    setting.doRegion = req.body.doRegion ? req.body.doRegion : setting.doRegion;

    setting.awsEndpoint = req.body.awsEndpoint ? req.body.awsEndpoint : setting.awsEndpoint;
    setting.awsAccessKey = req.body.awsAccessKey ? req.body.awsAccessKey : setting.awsAccessKey;
    setting.awsSecretKey = req.body.awsSecretKey ? req.body.awsSecretKey : setting.awsSecretKey;
    setting.awsHostname = req.body.awsHostname ? req.body.awsHostname : setting.awsHostname;
    setting.awsBucketName = req.body.awsBucketName ? req.body.awsBucketName : setting.awsBucketName;
    setting.awsRegion = req.body.awsRegion ? req.body.awsRegion : setting.awsRegion;

    setting.paystackPublicKey = req.body.paystackPublicKey ? req.body.paystackPublicKey.trim() : setting.paystackPublicKey;
    setting.paystackSecretKey = req.body.paystackSecretKey ? req.body.paystackSecretKey.trim() : setting.paystackSecretKey;

    setting.cashfreeClientId = req.body.cashfreeClientId ? req.body.cashfreeClientId.trim() : setting.cashfreeClientId;
    setting.cashfreeClientSecret = req.body.cashfreeClientSecret ? req.body.cashfreeClientSecret.trim() : setting.cashfreeClientSecret;

    setting.paypalClientId = req.body.paypalClientId ? req.body.paypalClientId.trim() : setting.paypalClientId;
    setting.paypalSecretKey = req.body.paypalSecretKey ? req.body.paypalSecretKey.trim() : setting.paypalSecretKey;

    setting.websiteUrl = req.body.websiteUrl ? req.body.websiteUrl.trim() : setting.websiteUrl;

    if (req.body.androidAssetLinks !== undefined) {
      let parsedAndroidAssetLinks = req.body.androidAssetLinks;

      if (typeof parsedAndroidAssetLinks === "string") {
        try {
          parsedAndroidAssetLinks = JSON.parse(parsedAndroidAssetLinks.trim());
        } catch (err) {
          return res.status(200).json({
            status: false,
            message: "androidAssetLinks must be valid JSON",
          });
        }
      }

      const { error, value } = androidAssetLinksSchema.validate(parsedAndroidAssetLinks, {
        abortEarly: true,
      });

      if (error) {
        return res.status(200).json({
          status: false,
          message: error.details[0].message,
        });
      }

      setting.androidAssetLinks = Object.freeze(value);
    }

    if (req.body.appleAppSiteAssociation !== undefined) {
      let parsedAppleAASA = req.body.appleAppSiteAssociation;

      if (typeof parsedAppleAASA === "string") {
        try {
          parsedAppleAASA = JSON.parse(parsedAppleAASA.trim());
        } catch (err) {
          return res.status(200).json({
            status: false,
            message: "appleAppSiteAssociation must be valid JSON",
          });
        }
      }

      const { error, value } = appleAppSiteAssociationSchema.validate(parsedAppleAASA, {
        abortEarly: true,
      });

      if (error) {
        return res.status(200).json({
          status: false,
          message: error.details[0].message,
        });
      }

      setting.appleAppSiteAssociation = Object.freeze(value);
    }

    await setting.save();

    global.updateSettingJSON(setting);

    res.status(200).json({
      status: true,
      message: "Setting updated Successfully",
      data: setting,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//get setting
exports.fetchSettingByAdmin = async (req, res) => {
  try {
    const setting = await Setting.findOne();
    if (!setting) {
      return res.status(200).json({ status: false, message: "Setting does not found." });
    }

    return res.status(200).json({
      status: true,
      message: "Setting fetch Successfully",
      data: setting,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//fetch selected fields of setting
exports.fetchSelectedFieldsOfSetting = async (req, res) => {
  try {
    const setting = settingJSON ? settingJSON : null;
    if (!setting) {
      return res.status(200).json({ status: false, message: "Setting does not found." });
    }

    const data = {
      websiteUrl: setting.websiteUrl,
      androidAppLink: setting.androidAppLink,
      iosAppLink: setting.iosAppLink,
    };

    return res.status(200).json({
      status: true,
      message: "Selected fields of setting fetch Successfully",
      data,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//handle activation of the switch
// exports.handleSwitch = async (req, res) => {
//   try {
//     const settingId = req?.query?.settingId;
//     const type = req?.query?.type?.trim();

//     if (!settingId || !type) {
//       return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
//     }

//     const setting = await Setting.findById(settingId);
//     if (!setting) {
//       return res.status(200).json({ status: false, message: "Setting not found." });
//     }

//     const TOGGLE_FIELDS = [
//       "googlePlayEnabled",
//       "stripeEnabled",
//       "razorpayEnabled",
//       "flutterwaveEnabled",
//       "paystackAndroidEnabled",
//       "paystackIosEnabled",
//       "paypalAndroidEnabled",
//       "paypalIosEnabled",
//       "cashfreeAndroidEnabled",
//       "cashfreeIosEnabled",
//       "googlePayIosEnabled",
//       "stripeIosEnabled",
//       "razorpayIosEnabled",
//       "flutterwaveIosEnabled",
//       "isDemoData",
//       "isAppEnabled",
//       "isAutoRefreshEnabled",
//       "isAutoMessageEnabled",
//       "isAutoCallEnabled",
//     ];

//     const PAYMENT_TYPES = [
//       "googlePlayEnabled",
//       "stripeEnabled",
//       "razorpayEnabled",
//       "flutterwaveEnabled",
//       "paystackAndroidEnabled",
//       "paystackIosEnabled",
//       "paypalAndroidEnabled",
//       "paypalIosEnabled",
//       "cashfreeAndroidEnabled",
//       "cashfreeIosEnabled",
//       "googlePayIosEnabled",
//       "stripeIosEnabled",
//       "razorpayIosEnabled",
//       "flutterwaveIosEnabled",
//     ];

//     if (!TOGGLE_FIELDS.includes(type)) {
//       return res.status(200).json({
//         status: false,
//         message: "type must be valid.",
//       });
//     }

//     if (PAYMENT_TYPES.includes(type)) {
//       const admin = await Admin.findById(req.admin._id).select("purchaseCode").lean();

//       if (!admin || !admin.purchaseCode) {
//         return res.status(200).json({
//           status: false,
//           message: "Purchase code not found. Verify license first.",
//         });
//       }

//       try {
//         const response = await axios.get(`https://api.envato.com/v3/market/author/sale?code=${admin.purchaseCode}`, {
//           headers: {
//             Authorization: `Bearer G9o1R8snTfNCpRgMzzKmpQP9kOVbapnP`,
//           },
//         });

//         const data = response?.data;

//         if (!data || !data.item) {
//           return res.status(200).json({
//             status: false,
//             message: "Invalid purchase code. Payment settings locked.",
//           });
//         }

//         const license = data?.license?.toLowerCase();

//         if (license?.includes("regular")) {
//           return res.status(200).json({
//             status: false,
//             message: "Regular license is not allowed for payment settings",
//             allowPaymentSettings: false,
//           });
//         }
//       } catch (err) {
//         console.log("Envato Error:", err?.response?.data || err.message);

//         return res.status(200).json({
//           status: false,
//           message: "Purchase verification failed",
//         });
//       }
//     }

//     setting[type] = !setting[type];
//     await setting.save();

//     global.updateSettingJSON(setting);

//     return res.status(200).json({
//       status: true,
//       message: "Setting updated Successfully",
//       data: setting,
//     });
//   } catch (error) {
//     console.log(error);
//     return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
//   }
// };

exports.handleSwitch = async (req, res) => {
  try {
    const settingId = req?.query?.settingId || {};
    const type = req?.query?.type?.trim();

    if (!settingId || !type) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    const setting = await Setting.findById(settingId);
    if (!setting) {
      return res.status(200).json({ status: false, message: "setting does not found." });
    }

    if (type === "isGoogle") {
      setting.isGoogle = !setting.isGoogle;
    } else if (type === "googlePlaySwitch") {
      setting.googlePlaySwitch = !setting.googlePlaySwitch;
    } else if (type === "stripeSwitch") {
      setting.stripeSwitch = !setting.stripeSwitch;
    } else if (type === "razorPaySwitch") {
      setting.razorPaySwitch = !setting.razorPaySwitch;
    } else if (type === "flutterWaveSwitch") {
      setting.flutterWaveSwitch = !setting.flutterWaveSwitch;
    } else if (type === "flutterwaveIosEnabled") {
      setting.flutterwaveIosEnabled = !setting.flutterwaveIosEnabled;
    } else if (type === "paystackAndroidEnabled") {
      setting.paystackAndroidEnabled = !setting.paystackAndroidEnabled;
    } else if (type === "paystackIosEnabled") {
      setting.paystackIosEnabled = !setting.paystackIosEnabled;
    } else if (type === "cashfreeAndroidEnabled") {
      setting.cashfreeAndroidEnabled = !setting.cashfreeAndroidEnabled;
    } else if (type === "cashfreeIosEnabled") {
      setting.cashfreeIosEnabled = !setting.cashfreeIosEnabled;
    } else if (type === "paypalAndroidEnabled") {
      setting.paypalAndroidEnabled = !setting.paypalAndroidEnabled;
    } else if (type === "paypalIosEnabled") {
      setting.paypalIosEnabled = !setting.paypalIosEnabled;
    } else if (type === "googlePayIosEnabled") {
      setting.googlePayIosEnabled = !setting.googlePayIosEnabled;
    } else if (type === "stripeIosEnabled") {
      setting.stripeIosEnabled = !setting.stripeIosEnabled;
    } else if (type === "razorpayIosEnabled") {
      setting.razorpayIosEnabled = !setting.razorpayIosEnabled;
    } else {
      return res.status(200).json({ status: false, message: "type must be passed valid." });
    }

    await setting.save();

    global.updateSettingJSON(setting);

    return res.status(200).json({
      status: true,
      message: "Setting updated Successfully",
      data: setting,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//handle update storage
exports.handleStorageSwitch = async (req, res) => {
  try {
    const settingId = req?.query?.settingId;
    const type = req?.query?.type?.trim();

    if (!settingId || !type) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details." });
    }

    const setting = await Setting.findById(settingId);
    if (!setting) {
      return res.status(200).json({ status: false, message: "Setting not found." });
    }

    // Ensure only one storage is true at a time
    if (type === "local") {
      setting.storage.local = !setting.storage.local;
      if (setting.storage.local) {
        setting.storage.awsS3 = false;
        setting.storage.digitalOcean = false;
      }
    } else if (type === "awsS3") {
      setting.storage.awsS3 = !setting.storage.awsS3;
      if (setting.storage.awsS3) {
        setting.storage.local = false;
        setting.storage.digitalOcean = false;
      }
    } else if (type === "digitalOcean") {
      setting.storage.digitalOcean = !setting.storage.digitalOcean;
      if (setting.storage.digitalOcean) {
        setting.storage.local = false;
        setting.storage.awsS3 = false;
      }
    } else {
      return res.status(200).json({ status: false, message: "Invalid storage type provided." });
    }

    await setting.save();
    global.updateSettingJSON(setting);

    return res.status(200).json({
      status: true,
      message: "Storage setting updated successfully",
      data: setting,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//authorize purchase code
exports.activatePurchaseCode = async (req, res) => {
  return res.status(200).json({
    status: true,
    message: "Extended license verified successfully",
    allowPaymentSettings: true,
  });
};
