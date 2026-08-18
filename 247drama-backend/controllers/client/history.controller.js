const History = require("../../models/history.model");

//import model
const User = require("../../models/user.model");
const VipPlanHistory = require("../../models/vipPlanHistory.model");
const CoinPlanHistory = require("../../models/coinplanHistory.model");

//mongoose
const mongoose = require("mongoose");

//get referral history of particular user
exports.loadReferralHistoryByUser = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate || !req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const startDate = req?.query?.startDate || "All";
    const endDate = req?.query?.endDate || "All";
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    let dateFilterQuery = {};
    if (startDate !== "All" && endDate !== "All") {
      const formatStartDate = new Date(startDate);
      const formatEndDate = new Date(endDate);
      formatEndDate.setHours(23, 59, 59, 999);

      dateFilterQuery = {
        createdAt: {
          $gte: formatStartDate,
          $lte: formatEndDate,
        },
      };
    }

    const [user, referralHistory] = await Promise.all([
      User.findOne({ _id: userId }),
      History.find({ userId: userId, type: 4, ...dateFilterQuery })
        .populate("userId", "name username")
        .sort({ createdAt: -1 })
        .skip((start - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by admin!" });
    }

    return res.status(200).json({
      status: true,
      message: "Retrive Refferal history for that user.",
      data: referralHistory,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get coin history of particular user
exports.fetchCoinHistoryByUser = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate || !req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const startDate = req?.query?.startDate || "All";
    const endDate = req?.query?.endDate || "All";
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    let dateFilterQuery = {};
    if (startDate !== "All" && endDate !== "All") {
      const formatStartDate = new Date(startDate);
      const formatEndDate = new Date(endDate);
      formatEndDate.setHours(23, 59, 59, 999);

      dateFilterQuery = {
        createdAt: {
          $gte: formatStartDate,
          $lte: formatEndDate,
        },
      };
    }

    const [user, coinHistory] = await Promise.all([
      User.findOne({ _id: userId }),
      History.find({
        userId: userId,
        ...dateFilterQuery,
        // type: { $in: [1, 2, 3, 4] },
        coin: { $ne: 0 },
      })
        .sort({ createdAt: -1 })
        .skip((start - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by admin!" });
    }

    return res.status(200).json({
      status: true,
      message: "Retrive coin history for that user.",
      data: coinHistory,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get transaction history
exports.retrieveUserSubscriptionHistory = async (req, res) => {
  try {
    if (!req.query.userId || !mongoose.Types.ObjectId.isValid(req.query.userId)) {
      return res.status(200).json({ status: false, message: "userId must be passed and valid!" });
    }

    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const userId = new mongoose.Types.ObjectId(req.query.userId);

    const [user, history] = await Promise.all([
      User.findById(userId),
      VipPlanHistory.aggregate([
        {
          $match: { userId: userId },
        },
        { $sort: { createdAt: -1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        {
          $unwind: {
            path: "$user",
            preserveNullAndEmptyArrays: false,
          },
        },
        {
          $project: {
            paymentGateway: 1,
            // name: "$user.name",
            // username: "$user.username",
            // profilePic: "$user.profilePic",
            isVip: "$user.isVip",
            vipPlanStartDate: "$user.vipPlanStartDate",
            vipPlanEndDate: "$user.vipPlanEndDate",
            price: "$user.currentPlan.price",
            validity: "$user.currentPlan.validity",
            validityType: "$user.currentPlan.validityType",
            tags: "$user.currentPlan.tags",
          },
        },
      ]),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by the admin." });
    }

    return res.status(200).json({ status: true, message: "Success", planHistory: history });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get coin plan history
exports.fetchCoinplanHistoryOfUser = async (req, res) => {
  try {
    if (!req.query.userId || !mongoose.Types.ObjectId.isValid(req.query.userId)) {
      return res.status(200).json({ status: false, message: "userId must be passed and valid!" });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const [user, history] = await Promise.all([
      User.findOne({ _id: userId }).lean(),
      History.aggregate([
        {
          $match: {
            type: 5,
            price: { $exists: true, $ne: 0 },
            userId: userId,
          },
        },
        {
          $project: {
            _id: 1,
            type: 1,
            coin: 1,
            price: 1,
            uniqueId: 1,
            paymentGateway: 1,
            date: 1,
            createdAt: 1,
          },
        },
        { $sort: { createdAt: -1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
      ]),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by the admin." });
    }

    return res.status(200).json({ status: true, message: "Retrieve all histories.", data: history });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
};

//get episodes unlocked history of particular user
exports.getEpisodeUnlockHistory = async (req, res) => {
  try {
    if (!req.query.userId || !mongoose.Types.ObjectId.isValid(req.query.userId)) {
      return res.status(200).json({ status: false, message: "userId must be passed and valid!" });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const [user, history] = await Promise.all([
      User.findOne({ _id: userId }),
      History.aggregate([
        {
          $match: {
            userId: userId,
            type: 6,
            coin: { $ne: 0 },
          },
        },
        {
          $sort: { createdAt: -1 },
        },
        {
          $skip: (start - 1) * limit,
        },
        {
          $limit: limit,
        },
        {
          $lookup: {
            from: "movieseries",
            localField: "movieSeries",
            foreignField: "_id",
            as: "movies",
          },
        },
        {
          $unwind: {
            path: "$movies",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "shortvideos",
            localField: "videoId",
            foreignField: "_id",
            as: "shortVideos",
          },
        },
        {
          $unwind: {
            path: "$shortVideos",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            uniqueId: 1,
            coin: 1,
            date: 1,
            name: "$movies.name",
            episodeNumber: "$shortVideos.episodeNumber",
          },
        },
      ]),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by admin!" });
    }

    return res.status(200).json({
      status: true,
      message: "Successfully retrieved the episode unlock history for the specified user.",
      data: history,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get episodes auto-unlocked history of particular user~
exports.fetchEpisodeAutoUnlockHistory = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details!" });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const [user, history] = await Promise.all([
      User.findOne({ _id: userId }),
      History.aggregate([
        {
          $match: {
            userId: userId,
            type: 7,
            coin: { $ne: 0 },
          },
        },
        { $sort: { createdAt: -1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
        {
          $lookup: {
            from: "movieseries",
            localField: "movieSeries",
            foreignField: "_id",
            as: "movies",
          },
        },
        {
          $unwind: {
            path: "$movies",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "userautounlockstatuses",
            let: { movieSeriesId: "$movies._id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$movieSeries", "$$movieSeriesId"] }, { $eq: ["$userId", userId] }],
                  },
                },
              },
            ],
            as: "autoUnlockStatus",
          },
        },
        {
          $unwind: {
            path: "$autoUnlockStatus",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            uniqueId: 1,
            date: 1,
            movieSeriesId: "$movies._id",
            name: "$movies.name",
            thumbnail: "$movies.thumbnail",
            isAutoUnlockEpisodes: {
              $ifNull: ["$autoUnlockStatus.isAutoUnlockEpisodes", false],
            },
          },
        },
      ]),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by admin!" });
    }

    return res.status(200).json({
      status: true,
      message: "Successfully retrieved episode auto-unlock history.",
      data: history,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
