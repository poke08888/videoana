const DailyRewardCoin = require("../../models/dailyRewardCoin.model");

//import model
const User = require("../../models/user.model");
const History = require("../../models/history.model");
const CheckIn = require("../../models/checkIn.model");

//generateHistoryUniqueId
const { generateHistoryUniqueId } = require("../../util/generateHistoryUniqueId");

//mongoose
const mongoose = require("mongoose");

//private key
const admin = require("../../util/privateKey");

//get daily reward coin
exports.getDailyRewardCoinByUser = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({
        status: false,
        message: "Oops! Invalid details!",
      });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);

    const [user, userCheckIn, dailyRewards] = await Promise.all([User.findOne({ _id: userId }).lean(), CheckIn.findOne({ userId }).lean(), DailyRewardCoin.find({}).sort({ day: 1 }).lean()]);

    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' format
    // console.log("Today's Date 'YYYY-MM-DD' format: ", today);
    // console.log("User Check-In Data: ", userCheckIn);

    const checkInStatus = dailyRewards.map((rewardDay) => {
      const userReward = userCheckIn?.rewardsCollected?.find((r) => r.day === rewardDay.day);

      let isCheckIn = false;
      let checkInDate = null;

      if (userReward?.checkInDate) {
        const rewardDate = new Date(userReward.checkInDate).toISOString().slice(0, 10);

        if (rewardDate === today) {
          console.log(`User has checked in for day ${rewardDay.day} on ${rewardDate}`);
          isCheckIn = true;
          checkInDate = rewardDate;
        }
      }

      return {
        day: rewardDay.day,
        reward: rewardDay.dailyRewardCoin,
        isCheckIn,
        checkInDate,
      };
    });

    return res.status(200).json({
      status: true,
      message: "Retrieve DailyRewardCoin Successfully",
      data: checkInStatus,
      streak: userCheckIn?.consecutiveDays || 0,
      totalCoins: user?.coin || 0,
    });
  } catch (error) {
    console.error("❌ getDailyRewardCoinByUser error:", error);
    return res.status(500).json({
      status: false,
      message: error.message || "Internal Server Error",
    });
  }
};

//earn coin from daily check In
exports.handleDailyCheckInReward = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details!" });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const dailyRewardCoin = req.query.dailyRewardCoin ? parseInt(req.query.dailyRewardCoin) : 0;

    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' format
    const dayOfWeek = ((new Date(today).getDay() + 6) % 7) + 1; // Monday = 1, Sunday = 7

    console.log("Today's Date 'YYYY-MM-DD' format:        ", today);
    console.log("Day of Week:                             ", dayOfWeek);
    // Removed client dailyRewardCoin dependency

    const [uniqueId, user, userCheckIn, rewardForToday] = await Promise.all([
      generateHistoryUniqueId(),
      User.findOne({ _id: userId }),
      CheckIn.findOne({ userId: userId }),
      DailyRewardCoin.findOne({ day: dayOfWeek }),
    ]);

    console.log("userCheckIn  ", userCheckIn);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found!" });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by the admin." });
    }

    if (!rewardForToday) {
      return res.status(200).json({ status: false, message: "No reward configured for today." });
    }

    if (userCheckIn) {
      //Find today's check-in for the current week (same day of the week)
      const lastCheckInDate = userCheckIn?.lastCheckInDate ? new Date(userCheckIn.lastCheckInDate).toISOString().slice(0, 10) : null;

      console.log("Check if user has already checked in today (lastCheckInDate)", lastCheckInDate);
      console.log("Check if user has already checked in today                  ", today);

      //Check if user has already checked in today
      if (lastCheckInDate === today) {
        return res.status(200).json({ status: false, message: "You have already checked in today." });
      }
    }

    res.status(200).json({
      status: true,
      message: "Check-in successful",
      isCheckIn: true,
    });

    let updatedUserCheckIn = userCheckIn;
    if (!updatedUserCheckIn) {
      updatedUserCheckIn = new CheckIn({
        userId,
        rewardsCollected: [],
        consecutiveDays: 0,
      });
    }

    updatedUserCheckIn.rewardsCollected.push({
      day: dayOfWeek,
      isCheckIn: true,
      reward: rewardForToday.dailyRewardCoin || dailyRewardCoin,
      checkInDate: today,
    });

    const lastCheckInDate = userCheckIn?.lastCheckInDate ? new Date(userCheckIn.lastCheckInDate).toISOString().slice(0, 10) : null;
    console.log("lastCheckInDate =============================", lastCheckInDate);

    if (lastCheckInDate && (new Date(today) - new Date(lastCheckInDate)) / (1000 * 60 * 60 * 24) === 1) {
      updatedUserCheckIn.consecutiveDays += 1;
    } else {
      updatedUserCheckIn.consecutiveDays = 1;
    }

    updatedUserCheckIn.lastCheckInDate = today; // YYYY-MM-DD

    // ✅ FIX: actualRewardCoin was undefined — caused ReferenceError → HTTP 500 → check-in always failed
    const actualRewardCoin = rewardForToday.dailyRewardCoin || dailyRewardCoin;
    console.log("actualRewardCoin to grant:", actualRewardCoin);

    await Promise.all([
      updatedUserCheckIn.save(),
      User.findOneAndUpdate(
        { _id: user._id },
        {
          $inc: {
            coin: actualRewardCoin,
            rewardCoin: actualRewardCoin,
            dailyRewardCoin: actualRewardCoin,
          },
        },
        { new: true },
      ),
      History({
        userId: user._id,
        uniqueId: uniqueId,
        coin: actualRewardCoin,
        type: 1,
        date: new Date().toISOString(),
      }).save(),
    ]);


    if (user.fcmToken && user.fcmToken !== null) {
      const adminPromise = await admin;

      const payload = {
        token: user.fcmToken,
        notification: {
          title: "🌟 Daily Check-in Reward Unlocked! 💰",
          body: `Way to go! You've earned ${actualRewardCoin} coins for checking in today. Come back tomorrow for more rewards! 🌟💸`,
        },
        data: {
          type: "DAILY_CHECKIN_REWARD",
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
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
