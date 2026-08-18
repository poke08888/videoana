const User = require("../../models/user.model");

//deleteFromStorage
const { deleteFromStorage } = require("../../util/storageHelper");

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

//mongoose
const mongoose = require("mongoose");

//generateHistoryUniqueId
const { generateHistoryUniqueId } = require("../../util/generateHistoryUniqueId");

//update userInfo
exports.modifyUserInfo = async (req, res) => {
  try {
    if (!req.body.userId) {
      if (req?.body?.profilePic) {
        await deleteFromStorage(req?.body?.profilePic);
      }

      return res.status(200).json({ status: false, message: "userId must be requried." });
    }

    const user = await User.findOne({ _id: req.body.userId });
    if (!user) {
      if (req?.body?.profilePic) {
        await deleteFromStorage(req?.body?.profilePic);
      }

      return res.status(200).json({ status: false, message: "user does not found!" });
    }

    if (req?.body?.profilePic) {
      if (user?.profilePic) {
        await deleteFromStorage(user?.profilePic);
      }

      user.profilePic = req?.body?.profilePic ? req?.body?.profilePic : user.profilePic;
    }

    user.name = req.body.name ? req.body.name : user.name;
    user.username = req.body.username ? req.body.username : user.username;
    user.gender = req.body.gender ? req.body.gender.toLowerCase() : user.gender;
    user.bio = req.body.bio ? req.body.bio : user.bio;
    user.age = req.body.age ? req.body.age : user.age;
    user.country = req.body.country ? req.body.country : user.country;
    user.email = req.body.email ? req.body.email : user.email;
    user.mobileNumber = req.body.mobileNumber ? req.body.mobileNumber : user.mobileNumber;
    await user.save();

    return res.status(200).json({ status: true, message: "Update profile of the user by the admin.", data: user });
  } catch (error) {
    if (req?.body?.profilePic) {
      await deleteFromStorage(req?.body?.profilePic);
    }

    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//handle block of the user
exports.isBlock = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const userId = req.query.userId;

    const user = await User.findOne({ _id: userId });
    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    user.isBlock = !user.isBlock;
    await user.save();

    return res.status(200).json({ status: true, message: "Block of the user handled by admin!", data: user });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get user profile
exports.retriveUserProfile = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const user = await User.findOne({ _id: req.query.userId }).lean();
    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found!" });
    }

    return res.status(200).json({ status: true, message: "The user has retrieved their profile.", user: user });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get users
exports.getUsersByAdmin = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const searchString = req.query.search || "";

    let searchQuery = {};
    if (searchString !== "All" && searchString !== "") {
      searchQuery = {
        $or: [{ name: { $regex: searchString, $options: "i" } }, { username: { $regex: searchString, $options: "i" } }, { uniqueId: { $regex: searchString, $options: "i" } }],
      };
    }

    if (!req.query.startDate || !req.query.endDate) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid Details!" });
    }

    let dateFilterQuery = {};
    if (req?.query?.startDate !== "All" && req?.query?.endDate !== "All") {
      const startDate = new Date(req?.query?.startDate);
      const endDate = new Date(req?.query?.endDate);
      endDate.setHours(23, 59, 59, 999);

      dateFilterQuery = {
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      };
    }

    const [totalUsers, data] = await Promise.all([
      User.countDocuments({ ...dateFilterQuery, ...searchQuery }),
      User.find({ ...dateFilterQuery, ...searchQuery })
        .select("name username gender profilePic isVip coin lastLogin date isBlock loginType uniqueId mobileNumber email")
        .sort({ createdAt: -1 })
        .skip((start - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      status: true,
      message: "Retrive Users Successfully.",
      totalUsers: totalUsers,
      user: data,
    });
  } catch (error) {
    console.log(error);
    return res.status(200).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//delete user
exports.deactivateUser = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "userId must be required!" });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);

    const user = await User.findOne({ _id: userId, loginType: { $in: [1, 2, 4] } });

    if (user && user?.loginType === 3) {
      return res.status(200).json({
        status: false,
        message: "This user cannot be deleted as they are using quick login. Please contact support if necessary.",
      });
    }

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found!" });
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
    ]);

    await User.deleteOne({ _id: user?._id });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get user analytics (users)
exports.getUserAnalytics = async (req, res) => {
  try {
    let { startDate = "all", endDate = "all" } = req.query || {};

    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let start, end;

    const createdAtMatch = {};
    const lastLoginMatch = {};

    if (!isAll) {
      if (!startDate || !endDate) {
        return res.status(400).json({
          status: false,
          message: "startDate and endDate are required",
        });
      }

      start = new Date(startDate);
      end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          status: false,
          message: "Invalid startDate or endDate",
        });
      }

      if (start > end) {
        return res.status(400).json({
          status: false,
          message: "startDate must be before endDate",
        });
      }

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      createdAtMatch.createdAt = { $gte: start, $lte: end };
      lastLoginMatch.lastLogin = { $gte: start, $lte: end };
    }

    const [totalUsers, newUsers, activeUsers] = await Promise.all([
      User.countDocuments({ ...createdAtMatch }),
      User.countDocuments({
        ...createdAtMatch,
      }),
      User.countDocuments({
        ...lastLoginMatch,
      }),
    ]);

    const activeRate = totalUsers > 0 ? Number(((activeUsers / totalUsers) * 100).toFixed(2)) : 0;

    return res.status(200).json({
      status: true,
      message: "User analytics fetched",
      data: {
        totalUsers,
        newUsers,
        activeUsers,
        activeRate,
      },
    });
  } catch (error) {
    console.error("User analytics error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch user analytics",
    });
  }
};

// user analytics cards (User Analytics)
exports.getUserCards = async (req, res) => {
  try {
    let { startDate, endDate } = req.query || {};
    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let start, end, prevStart, prevEnd;
    let createdMatch = {};
    let activeMatch = {};
    let prevCreatedMatch = {};
    let prevActiveMatch = {};

    if (!isAll) {
      if (!startDate || !endDate) {
        return res.status(400).json({
          status: false,
          message: "startDate and endDate are required",
        });
      }

      start = new Date(startDate);
      end = new Date(endDate);

      if (isNaN(start) || isNaN(end) || start > end) {
        return res.status(400).json({
          status: false,
          message: "Invalid date range",
        });
      }

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      createdMatch = { createdAt: { $gte: start, $lte: end } };
      activeMatch = { lastLogin: { $gte: start, $lte: end } };

      const diff = end.getTime() - start.getTime();
      prevStart = new Date(start.getTime() - diff);
      prevEnd = new Date(end.getTime() - diff);

      prevCreatedMatch = { createdAt: { $gte: prevStart, $lte: prevEnd } };
      prevActiveMatch = { lastLogin: { $gte: prevStart, $lte: prevEnd } };
    }

    const [totalUsers, newUsers, activeUsers, prevTotalUsers, prevNewUsers, prevActiveUsers] = await Promise.all([
      User.countDocuments(),
      isAll ? User.countDocuments() : User.countDocuments(createdMatch),
      isAll ? User.countDocuments({ lastLogin: { $ne: null } }) : User.countDocuments(activeMatch),

      isAll ? 0 : User.countDocuments(prevCreatedMatch),
      isAll ? 0 : User.countDocuments(prevCreatedMatch),
      isAll ? 0 : User.countDocuments(prevActiveMatch),
    ]);

    const percentChange = (c, p) => (p > 0 ? (((c - p) / p) * 100).toFixed(1) : "0.0");

    const activeRate = totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : "0.0";

    const prevActiveRate = prevTotalUsers > 0 ? ((prevActiveUsers / prevTotalUsers) * 100).toFixed(1) : "0.0";

    return res.status(200).json({
      status: true,
      totalUsers: {
        total: totalUsers,
        // change: percentChange(totalUsers, prevTotalUsers),
      },
      newUsers: {
        total: newUsers,
        change: percentChange(newUsers, prevNewUsers),
      },
      activeRate: {
        total: activeRate,
        change: percentChange(activeRate, prevActiveRate),
      },
    });
  } catch (error) {
    console.error("User Cards Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch user cards",
    });
  }
};

// user growth chart (User Analytics)
exports.getUserGrowthChart = async (req, res) => {
  try {
    let { startDate, endDate } = req.query || {};
    const timezone = "Asia/Kolkata";

    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let match = {};

    if (!isAll && startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      match.createdAt = { $gte: start, $lte: end };
    } else {
      // default last 8 months
      const start = new Date();
      start.setMonth(start.getMonth() - 7);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);

      match.createdAt = { $gte: start };
    }

    const data = await User.aggregate([
      { $match: match },

      {
        $project: {
          month: {
            $dateTrunc: {
              date: "$createdAt",
              unit: "month",
              timezone,
            },
          },
          active: {
            $cond: [{ $ne: ["$lastLogin", null] }, 1, 0],
          },
        },
      },

      {
        $group: {
          _id: "$month",
          newUsers: { $sum: 1 },
          activeUsers: { $sum: "$active" },
        },
      },

      { $sort: { _id: 1 } },

      {
        $setWindowFields: {
          sortBy: { _id: 1 },
          output: {
            totalUsers: {
              $sum: "$newUsers",
              window: { documents: ["unbounded", "current"] },
            },
          },
        },
      },

      {
        $project: {
          _id: 0,
          month: {
            $dateToString: {
              format: "%Y-%m",
              date: "$_id",
              timezone,
            },
          },
          newUsers: 1,
          activeUsers: 1,
          totalUsers: 1,
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "User growth chart fetched",
      data,
    });
  } catch (error) {
    console.error("User Growth Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch user growth chart",
    });
  }
};

// user retention and engagement chart (User Analytics)
exports.getUserRetentionAndEngagement = async (req, res) => {
  try {
    const now = new Date();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    // Engagement (DAU / WAU / MAU)
    const dayAgo = new Date(now.getTime() - 1 * MS_PER_DAY);
    const weekAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
    const monthAgo = new Date(now.getTime() - 30 * MS_PER_DAY);

    const [totalUsers, dau, wau, mau] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ lastLogin: { $gte: dayAgo } }),
      User.countDocuments({ lastLogin: { $gte: weekAgo } }),
      User.countDocuments({ lastLogin: { $gte: monthAgo } }),
    ]);

    // Retention Cohort (7 days old)
    const cohortStart = new Date(now.getTime() - 8 * MS_PER_DAY);
    const cohortEnd = new Date(now.getTime() - 7 * MS_PER_DAY);

    cohortStart.setHours(0, 0, 0, 0);
    cohortEnd.setHours(23, 59, 59, 999);

    const cohortUsers = await User.find({
      createdAt: { $gte: cohortStart, $lte: cohortEnd },
    }).select("createdAt lastLogin");

    const cohortSize = cohortUsers.length;

    const retentionDays = [1, 2, 3, 4, 5, 6, 7];

    const retentionData = retentionDays.map((day) => {
      if (cohortSize === 0) {
        return { day: `Day ${day}`, retention: "0.0" };
      }

      const retainedCount = cohortUsers.filter((user) => {
        if (!user.lastLogin) return false;

        const targetDate = new Date(user.createdAt.getTime() + day * MS_PER_DAY);

        return user.lastLogin >= targetDate;
      }).length;

      const percentage = ((retainedCount / cohortSize) * 100).toFixed(1);

      return {
        day: `Day ${day}`,
        retention: percentage,
      };
    });

    return res.status(200).json({
      status: true,

      engagement: {
        dailyActive: totalUsers > 0 ? ((dau / totalUsers) * 100).toFixed(1) : "0.0",
        weeklyActive: totalUsers > 0 ? ((wau / totalUsers) * 100).toFixed(1) : "0.0",
        monthlyActive: totalUsers > 0 ? ((mau / totalUsers) * 100).toFixed(1) : "0.0",
      },

      retention: retentionData,
    });
  } catch (error) {
    console.error("User Retention Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch retention & engagement",
    });
  }
};

// update user wallet balance (add / deduct coins)
exports.updateUserWalletBalance = async (req, res) => {
  try {
    const { userId, coin, action } = req.body || {};

    if (!userId || !coin || !action ) {
      return res.status(400).json({
        status: false,
        message: "userId, coin, action are required.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        status: false,
        message: "Invalid userId.",
      });
    }

    if (!["add", "deduct"].includes(action)) {
      return res.status(400).json({
        status: false,
        message: "Invalid action. Use 'add' or 'deduct'.",
      });
    }

    if (isNaN(coin) || coin <= 0) {
      return res.status(400).json({
        status: false,
        message: "Coin must be a positive number.",
      });
    }

    const user = await User.findById(userId).select("_id coin");

    if (!user) {
      return res.status(404).json({
        status: false,
        message: "User not found.",
      });
    }


    if (action === "deduct") {
      if (user.coin < coin) {
        return res.status(400).json({
          status: false,
          message: `Insufficient balance.`,
        });
      }
    }

    if (action === "add") {
      user.coin += coin;
    } else {
      user.coin -= coin;
    }

    await user.save();

    let historyType;
    if (action === "add") {
      historyType = 9
    } else {
      historyType = 10;
    }

    await History.create({
      userId: user._id,
      coin: coin,
      type: historyType,
      uniqueId: await generateHistoryUniqueId(),
      date: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata",
      }),
    });

    return res.status(200).json({
      status: true,
      message: `Successfully ${action}ed ${coin} coins.`,
    });

  } catch (error) {
    console.error("updateUserWalletBalance Error:", error);
    return res.status(500).json({  status: false,message: "Internal server error.",
      error: error.message,
    });
  }
};
