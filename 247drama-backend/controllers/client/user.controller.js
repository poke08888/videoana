const User = require("../../models/user.model");
const Setting = require("../../models/setting.model");

//import model
const WatchHistory = require("../../models/watchHistory.model");
const CheckIn = require("../../models/checkIn.model");
const CoinPlanHistory = require("../../models/coinplanHistory.model");
const History = require("../../models/history.model");
const LikeHistoryOfVideo = require("../../models/likeHistoryOfVideo.model");
const Report = require("../../models/report.model");
const UserVideoList = require("../../models/userVideoList.model");
const VipPlanHistory = require("../../models/vipPlanHistory.model");
const WithdrawRequest = require("../../models/withDrawRequest.model");
const VideoUniqueView = require("../../models/videoUniqueView.model");
const AdRewardCoin = require("../../models/adRewardCoin.model");
const SearchHistory = require("../../models/searchHistory.model");
const UserVideoStatus = require("../../models/userVideoStatus.model");
const UserAutoUnlockStatus = require("../../models/userAutoUnlockStatus.model");

//mongoose
const mongoose = require("mongoose");

//Cryptr
const Cryptr = require("cryptr");
const cryptr = new Cryptr("myTotallySecretKey");

//generateUniqueId
const { generateUniqueId } = require("../../util/generateUniqueId");

//generateHistoryUniqueId
const { generateHistoryUniqueId } = require("../../util/generateHistoryUniqueId");

//generateReferralCode
const { generateReferralCode } = require("../../util/generateReferralCode");

//private key
const admin = require("../../util/privateKey");

//deleteFromStorage
const { deleteFromStorage } = require("../../util/storageHelper");

//checkVipPlan
const { checkVipPlan } = require("../../util/checkVipPlan");

//user function
const userFunction = async (user, data_) => {
  const data = data_.body;

  user.name = data?.name ? data?.name?.trim() : user.name;
  user.username = data?.username ? data?.username?.trim() : user.username;
  user.gender = data?.gender ? data?.gender?.toLowerCase().trim() : user.gender;
  user.bio = data?.bio ? data?.bio?.trim() : user.bio;
  user.age = data?.age ? data?.age : user.age;
  user.profilePic = data?.profilePic ? data?.profilePic : user.profilePic;
  user.country = data.country ? data.country.toLowerCase() : user.country;
  user.email = data?.email ? data?.email?.trim() : user.email;
  user.mobileNumber = data.mobileNumber ? data.mobileNumber : user.mobileNumber;
  user.identity = data.identity ? data.identity : user.identity;
  user.loginType = data.loginType ? data.loginType : user.loginType;
  user.fcmToken = data.fcmToken ? data.fcmToken : user.fcmToken;
  user.uniqueId = !user.uniqueId ? await generateUniqueId() : user.uniqueId;
  user.lastLogin = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

  await user.save();
  return user;
};

//check the user is exists or not with loginType 3 quick(identity)
exports.checkUser = async (req, res) => {
  try {
    if (!req.query.identity) {
      return res.status(200).json({ status: false, message: "identity must be requried." });
    }

    const user = await User.findOne({ identity: req.query.identity.trim(), loginType: 3 });
    if (user) {
      return res.status(200).json({
        status: true,
        message: "User login Successfully.",
        isLogin: true,
      });
    } else {
      return res.status(200).json({
        status: true,
        message: "User must have to sign up.",
        isLogin: false,
      });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Sever Error" });
  }
};

//user login and sign up
exports.loginOrSignUp = async (req, res) => {
  try {
    if (!req.body.identity || !req.body.loginType || !req.body.fcmToken) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    let userQuery;

    const loginType = req?.body?.loginType;
    const identity = req?.body?.identity;

    if (loginType === 1) {
      if (!req.body.mobileNumber) {
        return res.status(200).json({ status: false, message: "mobileNumber must be required." });
      }

      userQuery = await User.findOne({ mobileNumber: req.body.mobileNumber?.trim() });
    } else if (loginType === 2 || loginType === 4) {
      if (!req.body.email) {
        return res.status(200).json({ status: false, message: "email must be required." });
      }

      userQuery = await User.findOne({ email: req?.body?.email?.trim() });
    } else if (loginType === 3) {
      if (!req.body.identity) {
        return res.status(200).json({ status: false, message: "identity must be required." });
      }

      userQuery = await User.findOne({ identity: identity, email: req?.body?.email?.trim() }); //email field always be identity
    } else {
      return res.status(200).json({ status: false, message: "loginType must be passed valid." });
    }

    const user = userQuery;

    if (user) {
      console.log("User is already exist ............");

      if (user.isBlock) {
        return res.status(200).json({ status: false, message: "You are blocked by the admin." });
      }

      user.profilePic = req.body.profilePic ? req.body.profilePic : user.profilePic;
      user.name = req.body.name ? req.body.name : user.name;
      user.username = req.body.username ? req.body.username : user.username;
      user.fcmToken = req.body.fcmToken ? req.body.fcmToken : user.fcmToken;
      user.lastLogin = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

      if (loginType !== 3 && identity) {
        let guestUser = await User.findOne({ identity: identity, loginType: 3 });
        if (guestUser) {
          console.log("Merging Guest Account into permanent account!");
          
          user.coin = (user.coin || 0) + (guestUser.coin || 0);
          user.rewardCoin = (user.rewardCoin || 0) + (guestUser.rewardCoin || 0);
          user.purchasedCoin = (user.purchasedCoin || 0) + (guestUser.purchasedCoin || 0);
          user.adRewardCoin = (user.adRewardCoin || 0) + (guestUser.adRewardCoin || 0);
          user.dailyRewardCoin = (user.dailyRewardCoin || 0) + (guestUser.dailyRewardCoin || 0);
          user.loginRewardCoin = (user.loginRewardCoin || 0) + (guestUser.loginRewardCoin || 0);

          // Transfer VIP: if guest has active VIP, transfer it to permanent account
          if (guestUser.isVip && guestUser.vipExpiry && new Date(guestUser.vipExpiry) > new Date()) {
            if (!user.isVip || !user.vipExpiry || new Date(user.vipExpiry) < new Date(guestUser.vipExpiry)) {
              user.isVip = guestUser.isVip;
              user.vipExpiry = guestUser.vipExpiry;
              console.log("VIP transferred from guest to permanent account, expires:", guestUser.vipExpiry);
            }
          }

          // ✅ FIX: VideoUniqueView has unique compound index {videoId, userId}.
          // updateMany would cause E11000 if permanent user already viewed the same video.
          // Solution: find conflicting videoIds first, delete guest's duplicates, then update the rest.
          if (VideoUniqueView) {
            const permanentViews = await VideoUniqueView.find({ userId: user._id }).select('videoId').lean();
            const permanentVideoIds = permanentViews.map(v => v.videoId.toString());

            // Delete guest records that would conflict (permanent user already has that videoId)
            if (permanentVideoIds.length > 0) {
              await VideoUniqueView.deleteMany({ userId: guestUser._id, videoId: { $in: permanentVideoIds } });
            }

            // Now safely update remaining non-conflicting records
            await VideoUniqueView.updateMany({ userId: guestUser._id }, { $set: { userId: user._id } });
          }

          const modelsToUpdate = [
            WatchHistory, CheckIn, CoinPlanHistory, History, LikeHistoryOfVideo, 
            Report, UserVideoList, VipPlanHistory, WithdrawRequest,
            AdRewardCoin, SearchHistory, UserVideoStatus, UserAutoUnlockStatus
          ];
          
          for (const Model of modelsToUpdate) {
            if (Model) {
              await Model.updateMany({ userId: guestUser._id }, { $set: { userId: user._id } });
            }
          }

          await User.deleteOne({ _id: guestUser._id });
        }
      }

      if (loginType === 3) {
        const user_ = await userFunction(user, req);

        return res.status(200).json({
          status: true,
          message: "The user has successfully logged in.",
          user: user_,
          signUp: false,
        });
      }

      await user.save();
      return res.status(200).json({
        status: true,
        message: "The user has successfully logged in.",
        user: user,
        signUp: false,
      });
    } else {
      console.log("User signup:    ");

      // Check if there's a guest account to upgrade to permanent account
      if (loginType !== 3 && identity) {
        let guestUser = await User.findOne({ identity: identity, loginType: 3 });
        if (guestUser) {
          console.log("Upgrading Guest Account to permanent account!");
          guestUser.loginType = loginType;
          if (loginType === 1) {
            guestUser.mobileNumber = req.body.mobileNumber?.trim();
            guestUser.email = `user_${req.body.mobileNumber?.trim()}@otp.storybox`;
          } else if (loginType === 2 || loginType === 4) {
            guestUser.email = req.body.email?.trim();
          }
          
          guestUser.profilePic = req.body.profilePic ? req.body.profilePic : guestUser.profilePic;
          guestUser.name = req.body.name ? req.body.name : guestUser.name;
          guestUser.username = req.body.username ? req.body.username : guestUser.username;
          guestUser.fcmToken = req.body.fcmToken ? req.body.fcmToken : guestUser.fcmToken;
          guestUser.lastLogin = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
          
          const upgradedUser = await userFunction(guestUser, req);
          
          return res.status(200).json({
            status: true,
            message: "Account upgraded successfully.",
            signUp: false,
            user: upgradedUser,
          });
        }
      }

      let referralCode;
      let isUnique = false;

      while (!isUnique) {
        referralCode = generateReferralCode();
        const existingUser = await User.findOne({ referralCode });
        if (!existingUser) {
          isUnique = true;
        }
      }

      const bonusCoins = settingJSON.loginRewardCoins ? settingJSON.loginRewardCoins : 5000;

      const newUser = new User();
      newUser.referralCode = referralCode;
      newUser.coin = bonusCoins;
      newUser.rewardCoin = bonusCoins;
      newUser.loginRewardCoin = bonusCoins;
      newUser.date = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      newUser.lastLogin = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

      const user = await userFunction(newUser, req);

      res.status(200).json({
        status: true,
        message: "A new user has registered an account.",
        signUp: true,
        user: user,
      });

      const uniqueId = await generateHistoryUniqueId();
      await History.create({
        userId: newUser._id,
        coin: bonusCoins,
        uniqueId: uniqueId,
        type: 3,
        date: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
      });

      if (user.fcmToken && user.fcmToken !== null) {
        const adminPromise = await admin;

        const payload = {
          token: user.fcmToken,
          notification: {
            title: "🎁 Welcome Bonus! 🎁",
            body: "✨ Congratulations! You have received a login bonus. Thank you for joining us.",
          },
          data: {
            type: "LOGINBONUS",
          },
        };

        adminPromise
          .messaging()
          .send(payload)
          .then((response) => {
            console.log("Successfully sent with response: ", response);
          })
          .catch((error) => {
            console.log("Error sending message: ", error);
          });
      }
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Sever Error" });
  }
};

//update profile of the user
exports.updateProfile = async (req, res) => {
  try {
    if (!req.query.userId) {
      if (req?.body?.profilePic) {
        await deleteFromStorage(req?.body?.profilePic);
      }

      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const user = await User.findOne({ _id: req.query.userId });
    if (!user) {
      if (req?.body?.profilePic) {
        await deleteFromStorage(req?.body?.profilePic);
      }

      return res.status(200).json({ status: false, message: "User does not found." });
    }

    if (user.isBlock) {
      if (req?.body?.profilePic) {
        await deleteFromStorage(req?.body?.profilePic);
      }

      return res.status(200).json({ status: false, message: "you are blocked by the admin." });
    }

    if (req?.body?.profilePic) {
      if (user?.profilePic) {
        await deleteFromStorage(user?.profilePic);
      }

      user.profilePic = req?.body?.profilePic ? req?.body?.profilePic : user.profilePic;
    }

    user.name = req.body.name ? req.body.name : user.name;
    user.username = req.body.username ? req.body.username : user.username;
    user.mobileNumber = req.body.mobileNumber ? req.body.mobileNumber : user.mobileNumber;
    user.gender = req.body.gender ? req.body.gender?.toLowerCase()?.trim() : user.gender;
    user.bio = req.body.bio ? req.body.bio : user.bio;
    user.country = req.body.country ? req.body.country.toLowerCase() : user.country;
    await user.save();

    return res.status(200).json({ status: true, message: "The user's profile has been modified.", user: user });
  } catch (error) {
    if (req?.body?.profilePic) {
      await deleteFromStorage(req?.body?.profilePic);
    }

    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//link phone number
exports.linkPhone = async (req, res) => {
  try {
    if (!req.body.userId || !req.body.mobileNumber) {
      return res.status(200).json({ status: false, message: "UserId or Mobile Number is missing." });
    }

    const userId = req.body.userId.trim();
    const mobileNumber = req.body.mobileNumber.trim();

    const user = await User.findById(userId);
    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by the admin." });
    }

    const existingUser = await User.findOne({ mobileNumber: mobileNumber, _id: { $ne: userId } });
    if (existingUser) {
      return res.status(200).json({ status: false, message: "This mobile number is already linked to another account." });
    }

    const wasEmpty = !user.mobileNumber;
    user.mobileNumber = mobileNumber;

    if (wasEmpty && !user.hasLinkedPhone) {
      const settings = await Setting.findOne();
      const reward = settings?.linkPhoneRewardCoins || 100;
      user.coin += reward;
      user.hasLinkedPhone = true;
    }

    await user.save();

    return res.status(200).json({ status: true, message: "Phone number linked successfully.", user: user });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get user profile who login
exports.fetchProfile = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const user = await User.findOne({ _id: req.query.userId }).lean();
    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found!" });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by the admin." });
    }

    if (user.isVip && user.vipPlanStartDate !== null) {
      console.log("VIP User :              ", user.isVip);

      const updatedUserData = await checkVipPlan(user._id);

      return res.status(200).json({
        status: true,
        message: "The user has retrieved their profile.",
        user: updatedUserData,
      });
    }

    return res.status(200).json({ status: true, message: "The user has retrieved their profile.", user: user });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//check referral code is valid and apply referral code by user
exports.validateAndApplyReferralCode = async (req, res) => {
  try {
    const { userId, referralCode } = req.query;

    if (!userId || !referralCode) {
      return res.status(200).json({ status: false, message: "Invalid input details." });
    }

    if (!settingJSON) {
      return res.status(200).json({ message: "Referral settings not found" });
    }

    const [uniqueId, user, referralCodeUser] = await Promise.all([
      generateHistoryUniqueId(),
      User.findById(userId), //the user being referred
      User.findOne({ referralCode: referralCode.trim() }), //the referring user (who share their referral code) by their referral code
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "Referred user does not found!" });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "Your account has been blocked by the administrator." });
    }

    if (user.referralCode === referralCode.trim()) {
      return res.status(200).json({ status: false, message: "You cannot use your own referral code." });
    }

    if (!referralCodeUser) {
      return res.status(200).json({ status: false, message: "Invalid referral code. The referred user does not exist." });
    }

    if (!user.isReferral) {
      res.status(200).json({ message: "Referral tracked and updated successfully" });

      const [updatedUser, updatedReferralCodeUser, referralHistory] = await Promise.all([
        User.findOneAndUpdate(
          { _id: user._id },
          {
            $set: { isReferral: true },
          },
          { new: true },
        ),
        User.findOneAndUpdate(
          { _id: referralCodeUser._id },
          {
            $inc: {
              coin: settingJSON?.referralRewardCoins,
              rewardCoin: settingJSON?.referralRewardCoins,
              referralCount: 1,
            },
          },
          { new: true },
        ),
        History({
          userId: referralCodeUser._id,
          uniqueId: uniqueId,
          coin: settingJSON?.referralRewardCoins,
          type: 4,
          date: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
        }).save(),
      ]);
    } else {
      return res.status(200).json({ status: false, message: "Referral code has already been used by this user." });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//earn coin from watching ad
exports.handleAdWatchReward = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const [uniqueId, user, adRewards] = await Promise.all([
      generateHistoryUniqueId(), 
      User.findOne({ _id: req.query.userId }),
      AdRewardCoin.find().sort({ coinEarnedFromAd: 1 })
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found!" });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by the admin." });
    }

    const today = new Date().toISOString().slice(0, 10);
    const isNewDay = !(user.watchAds && user.watchAds.date !== null && new Date(user.watchAds.date).toISOString().slice(0, 10) === today);
    console.log("Today in Ad reward: ", today);

    if (user.watchAds && user.watchAds.date !== null && new Date(user.watchAds.date).toISOString().slice(0, 10) === today && user.watchAds.count >= settingJSON.maxAdPerDay) {
      return res.status(200).json({ status: false, message: "Ad view limit exceeded for today." });
    }

    // Securely get the configured reward instead of trusting the client
    let coinEarnedFromAd = 0;
    if (req.query.adRewardId) {
      const selectedAd = adRewards.find(ad => ad._id.toString() === req.query.adRewardId);
      if (selectedAd) coinEarnedFromAd = selectedAd.coinEarnedFromAd;
    } else {
      // Fallback for older clients, we only allow the minimum ad reward available
      coinEarnedFromAd = adRewards.length > 0 ? adRewards[0].coinEarnedFromAd : 0;
    }
    
    if (coinEarnedFromAd <= 0) {
      return res.status(200).json({ status: false, message: "No ad reward configured by admin." });
    }

    const [updatedReceiver, historyEntry] = await Promise.all([
      User.findOneAndUpdate(
        { _id: user._id },
        {
          $inc: {
            coin: coinEarnedFromAd,
            rewardCoin: coinEarnedFromAd,
            adRewardCoin: coinEarnedFromAd,
            ...(isNewDay ? {} : { "watchAds.count": 1 }),
          },
          $set: {
            "watchAds.date": today, ...(isNewDay ? { "watchAds.count": 1 } : {}),
          },
        },
        { new: true },
      ),
      History({
        userId: user._id,
        uniqueId: uniqueId,
        coin: coinEarnedFromAd,
        type: 2,
        date: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
      }).save(),
    ]);

    console.log("updatedReceiver", updatedReceiver.coin);

    return res.status(200).json({ status: true, message: "Coin earned successfully.", data: updatedReceiver });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//delete user account
exports.deleteUserAccount = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "userId must be required!" });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);

    const user = await User.findOne({ _id: userId });

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found!" });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by the admin." });
    }

    res.status(200).json({ status: true, message: "User has been successfully deleted." });

    if (user?.profilePic) {
      await deleteFromStorage(user?.profilePic);
    }

    await Promise.all([
      WatchHistory.deleteMany({ userId: user?._id }),
      CheckIn.deleteMany({ userId: user?._id }),
      CoinPlanHistory.deleteMany({ userId: user?._id }),
      History.deleteMany({ userId: user?._id }),
      LikeHistoryOfVideo.deleteMany({ userId: user?._id }),
      Report.deleteMany({ userId: user?._id }),
      UserVideoList.deleteMany({ userId: user?._id }),
      VipPlanHistory.deleteMany({ userId: user?._id }),
      WithdrawRequest.deleteMany({ userId: user?._id }),
      VideoUniqueView.deleteMany({ userId: user?._id }),
    ]);

    await User.deleteOne({ _id: user?._id });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//user login or sign up ( web )
exports.authenticateOrRegister = async (req, res) => {
  try {
    const { loginType, fcmToken, email } = req.body;

    if (
      loginType === undefined
      //|| !fcmToken
    ) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details!!" });
    }

    // Retrieve uid and provider from the validated Firebase token
    const { uid, provider } = req.user; // ✅ Get values from req.user

    let userQuery;

    switch (loginType) {
      case 2:
        if (!email) return res.status(200).json({ status: false, message: "email is required." });
        userQuery = { email };
        break;

      default:
        return res.status(200).json({ status: false, message: "Invalid loginType." });
    }

    let user = null;
    if (Object.keys(userQuery).length > 0) {
      // ✅ Only query if there are conditions
      user = await User.findOne(userQuery);
    }

    if (user) {
      console.log("✅ User already exists, logging in...");

      if (user.isBlock) {
        return res.status(403).json({ status: false, message: "🚷 User is blocked by the admin." });
      }

      user.fcmToken = fcmToken ? fcmToken : user.fcmToken;
      user.lastLogin = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      await user.save();

      return res.status(200).json({ status: true, message: "User logged in.", signUp: false, user });
    } else {
      console.log("🆕 Registering new user...");

      let referralCode;
      let isUnique = false;

      while (!isUnique) {
        referralCode = generateReferralCode();
        const existingUser = await User.findOne({ referralCode });
        if (!existingUser) {
          isUnique = true;
        }
      }

      const bonusCoins = settingJSON.loginRewardCoins ? settingJSON.loginRewardCoins : 5000;

      const newUser = new User();
      newUser.firebaseUid = uid;
      newUser.signInProvider = provider;
      newUser.referralCode = referralCode;
      newUser.coin = bonusCoins;
      newUser.rewardCoin = bonusCoins;
      newUser.loginRewardCoin = bonusCoins;
      newUser.date = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

      const user = await userFunction(newUser, req);

      res.status(200).json({
        status: true,
        message: "A new user has registered an account.",
        signUp: true,
        user,
      });

      const uniqueId = await generateHistoryUniqueId();

      const [historyEntry] = await Promise.all([
        History.create({
          userId: newUser._id,
          coin: bonusCoins,
          uniqueId: uniqueId,
          type: 3,
          date: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
        }),
      ]);

      if (user.fcmToken && user.fcmToken !== null) {
        const adminPromise = await admin;

        const payload = {
          token: user.fcmToken,
          notification: {
            title: "🎊 Welcome Bonus Activated! 🎁✨",
            body: "🥳 Hooray! You've received an exclusive login bonus. Enjoy your reward and have a great experience with us! 🚀💎",
          },
          data: {
            type: "LOGINBONUS",
          },
        };

        adminPromise
          .messaging()
          .send(payload)
          .then((response) => {
            console.log("Successfully sent with response: ", response);
          })
          .catch((error) => {
            console.log("Error sending message: ", error);
          });
      }
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ status: false, message: "Internal Server Error" });
  }
};

exports.claimExtraTask = async (req, res) => {
  try {
    if (!req.query.userId || !req.body.taskId) {
      return res.status(200).json({ status: false, message: "Invalid details!" });
    }
    const [user, settings] = await Promise.all([
      User.findById(req.query.userId),
      Setting.findOne()
    ]);
    if (!user) return res.status(200).json({ status: false, message: "User not found!" });
    if (user.isBlock) return res.status(200).json({ status: false, message: "You are blocked by admin." });

    const taskId = req.body.taskId;
    let rewardCoin = 0;
    let updateQuery = {};

    if (taskId === "notification") {
      if (user.hasEnabledNotification) return res.status(200).json({ status: false, message: "Task already claimed." });
      rewardCoin = settings.notificationRewardCoins || 50;
      updateQuery = { $set: { hasEnabledNotification: true } };
    } else if (taskId === "zalo") {
      if (user.hasLinkedZalo) return res.status(200).json({ status: false, message: "Task already claimed." });
      rewardCoin = settings.zaloRewardCoins || 80;
      updateQuery = { $set: { hasLinkedZalo: true } };
    } else if (taskId === "email") {
      if (user.hasLinkedEmail) return res.status(200).json({ status: false, message: "Task already claimed." });
      rewardCoin = settings.emailRewardCoins || 80;
      updateQuery = { $set: { hasLinkedEmail: true } };
      if (req.body.email) {
        updateQuery.$set.email = req.body.email.trim();
      }
    } else if (taskId === "youtube") {
      if (user.socialFollows && user.socialFollows.youtube) return res.status(200).json({ status: false, message: "Task already claimed." });
      rewardCoin = settings.youtubeRewardCoins || 20;
      updateQuery = { $set: { "socialFollows.youtube": true } };
    } else if (taskId === "tiktok") {
      if (user.socialFollows && user.socialFollows.tiktok) return res.status(200).json({ status: false, message: "Task already claimed." });
      rewardCoin = settings.tiktokRewardCoins || 20;
      updateQuery = { $set: { "socialFollows.tiktok": true } };
    } else if (taskId === "facebook") {
      if (user.socialFollows && user.socialFollows.facebook) return res.status(200).json({ status: false, message: "Task already claimed." });
      rewardCoin = settings.facebookRewardCoins || 20;
      updateQuery = { $set: { "socialFollows.facebook": true } };
    } else if (taskId === "instagram") {
      if (user.socialFollows && user.socialFollows.instagram) return res.status(200).json({ status: false, message: "Task already claimed." });
      rewardCoin = settings.instagramRewardCoins || 20;
      updateQuery = { $set: { "socialFollows.instagram": true } };
    } else if (taskId.startsWith("custom_")) {
      const idx = parseInt(taskId.split("_")[1]);
      if (isNaN(idx) || !settings.customTasks || !settings.customTasks[idx] || !settings.customTasks[idx].isActive) {
         return res.status(200).json({ status: false, message: "Invalid task." });
      }
      if (user.completedCustomTasks && user.completedCustomTasks.includes(taskId)) {
         return res.status(200).json({ status: false, message: "Task already claimed." });
      }
      rewardCoin = settings.customTasks[idx].rewardCoins;
      updateQuery = { $push: { completedCustomTasks: taskId } };
    } else if (taskId === "watch_10m" || taskId === "watch_15m" || taskId === "watch_20m") {
      const minutes = parseInt(taskId.split('_')[1].replace('m',''));
      
      const today = new Date().toISOString().slice(0, 10);
      let isNewDay = !(user.watchTimeDate && new Date(user.watchTimeDate).toISOString().slice(0, 10) === today);
      
      let claimedArray = isNewDay ? [] : (user.watchTimeTasksClaimed || []);
      
      if (claimedArray.includes(minutes)) return res.status(200).json({ status: false, message: "Task already claimed today." });
      
      const requiredSeconds = minutes * 60;
      const userDailyWatchTime = isNewDay ? 0 : (user.dailyWatchTime || 0);

      if (userDailyWatchTime < requiredSeconds) {
        return res.status(200).json({ status: false, message: "Watch time requirement not met." });
      }

      if (taskId === "watch_10m") rewardCoin = settings.watchTime10mRewardCoins || 10;
      else if (taskId === "watch_15m") rewardCoin = settings.watchTime15mRewardCoins || 20;
      else if (taskId === "watch_20m") rewardCoin = settings.watchTime20mRewardCoins || 40;

      claimedArray.push(minutes);
      updateQuery = { $set: { watchTimeDate: new Date(), watchTimeTasksClaimed: claimedArray } };
    } else {
      return res.status(200).json({ status: false, message: "Invalid task ID." });
    }

    // Apply reward
    if (rewardCoin > 0) {
      updateQuery.$inc = { coin: rewardCoin, rewardCoin: rewardCoin };
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id },
      updateQuery,
      { new: true }
    );

    return res.status(200).json({ status: true, message: "Success", data: updatedUser, rewardedCoin: rewardCoin });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Server Error" });
  }
};

exports.incrementWatchTime = async (req, res) => {
  try {
    if (!req.query.userId || !req.body.seconds) {
      return res.status(200).json({ status: false, message: "Invalid details" });
    }

    const user = await User.findById(req.query.userId);
    if (!user) return res.status(200).json({ status: false, message: "User not found" });

    const seconds = parseInt(req.body.seconds) || 0;
    const today = new Date().toISOString().slice(0, 10);
    const isNewDay = !(user.watchTimeDate && new Date(user.watchTimeDate).toISOString().slice(0, 10) === today);

    if (isNewDay) {
      user.dailyWatchTime = 0;
      user.watchTimeDate = new Date();
    }

    user.dailyWatchTime = (user.dailyWatchTime || 0) + seconds;
    await user.save();

    return res.status(200).json({ status: true, message: "Watch time updated", dailyWatchTime: user.dailyWatchTime });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal Server Error" });
  }
};
