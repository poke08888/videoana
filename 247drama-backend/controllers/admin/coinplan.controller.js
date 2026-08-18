const CoinPlan = require("../../models/coinplan.model");

//mongoose
const mongoose = require("mongoose");

//import model
const CoinPlanHistory = require("../../models/coinplanHistory.model");
const History = require("../../models/history.model");

//create coinplan
exports.store = async (req, res) => {
  try {
    if (!req.body.coin || !req.body.price || !req.body.productKey) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    const { coin, bonusCoin, price, offerPrice, productKey } = req.body;

    const coinplan = new CoinPlan();
    coinplan.coin = coin;
    coinplan.bonusCoin = bonusCoin || 0;
    coinplan.price = price;
    coinplan.offerPrice = offerPrice || 0;
    coinplan.productKey = productKey;
    coinplan.icon = req.body.icon ? req.body.icon : "";
    await coinplan.save();

    return res.status(200).json({
      status: true,
      message: "coinplan create Successfully",
      data: coinplan,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//update coinplan
exports.update = async (req, res) => {
  try {
    if (!req.body.coinPlanId) {
      return res.status(200).json({ status: false, message: "coinPlanId must be needed." });
    }

    const coinplan = await CoinPlan.findById(req.body.coinPlanId);
    if (!coinplan) {
      return res.status(200).json({ status: false, message: "CoinPlan does not found." });
    }

    coinplan.coin = req.body.coin ? Number(req.body.coin) : coinplan.coin;
    coinplan.bonusCoin = req.body.bonusCoin ? Number(req.body.bonusCoin) : coinplan.bonusCoin;
    coinplan.price = req.body.price ? Number(req.body.price) : coinplan.price;
    coinplan.offerPrice = req.body.offerPrice ? Number(req.body.offerPrice) : coinplan.offerPrice;
    coinplan.productKey = req.body.productKey ? req.body.productKey : coinplan.productKey;

    await coinplan.save();

    return res.status(200).json({
      status: true,
      message: "Coinplan update Successfully",
      data: coinplan,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//handle isActive switch
exports.handleSwitch = async (req, res) => {
  try {
    if (!req.query.coinPlanId) {
      return res.status(200).json({ status: false, message: "coinPlanId must be needed." });
    }

    const coinplan = await CoinPlan.findById(req.query.coinPlanId);
    if (!coinplan) {
      return res.status(200).json({ status: false, message: "CoinPlan does not found." });
    }

    coinplan.isActive = !coinplan.isActive;
    await coinplan.save();

    return res.status(200).json({ status: true, message: "Success", data: coinplan });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get coinPlan
exports.get = async (req, res) => {
  try {
    const coinPlan = await CoinPlan.find().sort({ coin: 1, amount: 1 }).lean();

    return res.status(200).json({
      status: true,
      message: "Retrive CoinPlan Successfully",
      data: coinPlan,
    });
  } catch {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//delete coinplan
exports.delete = async (req, res) => {
  try {
    if (!req.query.coinPlanId) {
      return res.status(200).json({ status: false, message: "coinPlanId must be needed." });
    }

    const coinplan = await CoinPlan.findById(req.query.coinPlanId);
    if (!coinplan) {
      return res.status(200).json({ status: false, message: "CoinPlan does not found." });
    }

    await coinplan.deleteOne();

    return res.status(200).json({
      status: true,
      message: "Coinplan deleted Successfully",
      data: coinplan,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//get user's coinplan order histories
exports.fetchCoinplanHistory = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const search = req.query.search ? req.query.search.trim() : null;
    const paymentGateway = req.query.paymentGateway?.trim() ? req.query.paymentGateway?.trim() : "";

    let dateFilterQuery = {};
    if (req?.query?.startDate !== "All" && req?.query?.endDate !== "All") {
      const startDate = new Date(req?.query?.startDate);
      const endDate = new Date(req?.query?.endDate);
      endDate.setHours(23, 59, 59, 999);

      dateFilterQuery.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    if (req.query.userId) {
      dateFilterQuery.userId = new mongoose.Types.ObjectId(req.query.userId);
    }

    let searchMatch = {};

    if (search) {
      searchMatch = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { userUniqueId: { $regex: search, $options: "i" } },
          { uniqueId: { $regex: search, $options: "i" } },
          { paymentGateway: { $regex: search, $options: "i" } },
        ],
      };
    }

    const matchQuery = {
      ...dateFilterQuery,
      type: 5,
      price: { $exists: true, $ne: 0 },
    };

    if (paymentGateway && paymentGateway?.toLowerCase() !== "all") {
      matchQuery.paymentGateway = paymentGateway;
    }

    const [totalHistory, history] = await Promise.all([
      History.countDocuments(matchQuery),
      History.aggregate([
        {
          $match: {
            ...matchQuery,
          },
        },
        {
          $lookup: {
            from: "users",
            let: { userId: "$userId" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$userId"] },
                },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  username: 1,
                  uniqueId: 1,
                  profilePic: 1,
                },
              },
            ],
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
            _id: 1,
            userId: "$user._id",
            name: "$user.name",
            username: "$user.username",
            userUniqueId: "$user.uniqueId",
            profilePic: "$user.profilePic",
            coin: "$coin",
            uniqueId: "$uniqueId",
            paymentGateway: "$paymentGateway",
            price: "$price",
            offerPrice: "$offerPrice",
            date: "$date",
            createdAt: 1,
          },
        },
        ...(search ? [{ $match: searchMatch }] : []),
        { $sort: { createdAt: -1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
      ]),
    ]);

    return res.status(200).json({
      status: true,
      message: "Success",
      totalHistory,
      history: history,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

// coin analytics cards (Coins Economy)
exports.getAdminCoinAnalytics = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    const matchQuery = {
      type: 6, // UNLOCK_VIDEO
    };

    if (startDate?.toLowerCase() !== "all" || endDate?.toLowerCase() !== "all") {
      if (!startDate || !endDate) {
        return res.status(400).json({
          status: false,
          message: "startDate and endDate are required",
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

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

      matchQuery.createdAt = { $gte: start, $lte: end };
    }

    const [analytics] = await History.aggregate([
      {
        $match: matchQuery,
      },
      {
        $group: {
          _id: null,
          adCoinsUsed: { $sum: "$adCoinUsed" },
          dailyCoinsUsed: { $sum: "$dailyCoinUsed" },
          // loginCoinsUsed: { $sum: "$loginCoinUsed" },
          purchasedCoinsUsed: { $sum: "$purchasedCoinUsed" },
        },
      },
    ]);

    const purchasedCoinsUsed = analytics?.purchasedCoinsUsed || 0;
    const adCoinsUsed = analytics?.adCoinsUsed || 0;
    const dailyCoinsUsed = analytics?.dailyCoinsUsed || 0;
    const loginCoinsUsed = analytics?.loginCoinsUsed || 0;

    const freeCoinsTotal = adCoinsUsed + dailyCoinsUsed + loginCoinsUsed;
    const totalCoinsSpent = purchasedCoinsUsed + freeCoinsTotal;

    const paidCoinsRatio = totalCoinsSpent > 0 ? Number(((purchasedCoinsUsed / totalCoinsSpent) * 100).toFixed(2)) : 0;
    const adFreeCoinsRatio = freeCoinsTotal > 0 ? Number(((adCoinsUsed / freeCoinsTotal) * 100).toFixed(2)) : 0;
    const dailyFreeCoinsRatio = freeCoinsTotal > 0 ? Number(((dailyCoinsUsed / freeCoinsTotal) * 100).toFixed(2)) : 0;

    return res.status(200).json({
      status: true,
      message: "Admin coin analytics fetched",
      data: {
        totalCoinsSpent,
        purchasedCoinsUsed,
        freeCoinsTotal,
        adCoinsUsed,
        dailyCoinsUsed,
        loginCoinsUsed,
        paidCoinsRatio,
        adFreeCoinsRatio,
        dailyFreeCoinsRatio,
      },
    });
  } catch (error) {
    console.error("Admin coin analytics error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch coin analytics",
    });
  }
};

// Coin Sources Over Time + Distribution Charts (Coins Economy)
exports.getAdminCoinCharts = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    const matchQuery = {
      type: 6, // UNLOCK_VIDEO
    };

    if (startDate?.toLowerCase() !== "all" || endDate?.toLowerCase() !== "all") {
      if (!startDate || !endDate) {
        return res.status(400).json({
          status: false,
          message: "startDate and endDate are required",
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

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

      matchQuery.createdAt = { $gte: start, $lte: end };
    }

    const timezone = "UTC";

    const [result] = await History.aggregate([
      {
        $match: matchQuery,
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: "$createdAt",
              unit: "day",
              timezone,
            },
          },
          paidCoins: { $sum: "$purchasedCoinUsed" },
          adCoins: { $sum: "$adCoinUsed" },
          dailyTaskCoins: { $sum: "$dailyCoinUsed" },
        },
      },
      {
        $project: {
          _id: 0,
          date: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$_id",
              timezone,
            },
          },
          paidCoins: 1,
          adCoins: 1,
          dailyTaskCoins: 1,
        },
      },
      { $sort: { date: 1 } },

      {
        $group: {
          _id: null,
          trend: { $push: "$$ROOT" },
          totalPaid: { $sum: "$paidCoins" },
          totalAd: { $sum: "$adCoins" },
          totalDaily: { $sum: "$dailyTaskCoins" },
        },
      },
      {
        $addFields: {
          totalCoins: {
            $add: ["$totalPaid", "$totalAd", "$totalDaily"],
          },
        },
      },
      {
        $match: {
          totalCoins: { $gt: 0 },
        },
      },
      {
        $project: {
          _id: 0,
          trend: 1,
          distribution: {
            $let: {
              vars: {
                grandTotal: { $add: ["$totalPaid", "$totalAd", "$totalDaily"] },
                freeTotal: { $add: ["$totalAd", "$totalDaily"] },
              },
              in: {
                paidCoinsPercentage: {
                  $cond: [
                    { $gt: ["$$grandTotal", 0] },
                    {
                      $round: [
                        {
                          $multiply: [{ $divide: ["$totalPaid", "$$grandTotal"] }, 100],
                        },
                        1,
                      ],
                    },
                    0,
                  ],
                },

                adCoinsPercentage: {
                  $cond: [
                    { $gt: ["$$grandTotal", 0] },
                    {
                      $round: [
                        {
                          $multiply: [{ $divide: ["$totalAd", "$$grandTotal"] }, 100],
                        },
                        1,
                      ],
                    },
                    0,
                  ],
                },

                dailyTaskCoinsPercentage: {
                  $cond: [
                    { $gt: ["$$grandTotal", 0] },
                    {
                      $round: [
                        {
                          $multiply: [{ $divide: ["$totalDaily", "$$grandTotal"] }, 100],
                        },
                        1,
                      ],
                    },
                    0,
                  ],
                },

                // revenueGeneratingPercentage: {
                //   $cond: [
                //     { $gt: ["$$grandTotal", 0] },
                //     {
                //       $round: [
                //         {
                //           $multiply: [{ $divide: ["$totalPaid", "$$grandTotal"] }, 100],
                //         },
                //         1,
                //       ],
                //     },
                //     0,
                //   ],
                // },

                // engagementOnlyPercentage: {
                //   $cond: [
                //     { $gt: ["$$grandTotal", 0] },
                //     {
                //       $round: [
                //         {
                //           $multiply: [{ $divide: ["$$freeTotal", "$$grandTotal"] }, 100],
                //         },
                //         1,
                //       ],
                //     },
                //     0,
                //   ],
                // },
              },
            },
          },
        },
      },
    ]);

    // console.log("Coin Charts Result:", result);

    return res.status(200).json({
      status: true,
      message: "Admin coin analytics fetched",
      data: result || { trend: [], distribution: {} },
    });
  } catch (error) {
    console.error("Admin coin analytics error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch coin analytics",
    });
  }
};

// Top Episodes by Coin Usage (Coins Economy)
exports.getTopEpisodesByCoinUsage = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    const matchQuery = {
      type: 6, // UNLOCK_VIDEO
      videoId: { $ne: null },
    };

    if (startDate?.toLowerCase() !== "all" || endDate?.toLowerCase() !== "all") {
      if (!startDate || !endDate) {
        return res.status(400).json({
          status: false,
          message: "startDate and endDate are required",
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

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

      matchQuery.createdAt = { $gte: start, $lte: end };
    }

    const limit = Number(req.query.limit) || 10;

    const data = await History.aggregate([
      {
        $match: matchQuery,
      },
      {
        $group: {
          _id: "$videoId",
          paidCoins: { $sum: "$purchasedCoinUsed" },
          adCoins: { $sum: "$adCoinUsed" },
          dailyTaskCoins: { $sum: "$dailyCoinUsed" },
        },
      },
      {
        $addFields: {
          totalCoins: { $add: ["$paidCoins", "$adCoins", "$dailyTaskCoins"] },
        },
      },
      {
        $match: {
          totalCoins: { $gt: 0 },
        },
      },
      { $sort: { totalCoins: -1 } },
      { $limit: limit },

      {
        $lookup: {
          from: "shortvideos",
          let: { videoId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$videoId"] } } },
            { $project: { episodeNumber: 1, movieSeries: 1 } },
            {
              $lookup: {
                from: "movieseries",
                let: { seriesId: "$movieSeries" },
                pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$seriesId"] } } }, { $project: { name: 1 } }],
                as: "series",
              },
            },
            { $unwind: { path: "$series", preserveNullAndEmptyArrays: false } },
          ],
          as: "episode",
        },
      },
      { $unwind: { path: "$episode", preserveNullAndEmptyArrays: false } },

      {
        $project: {
          _id: 0,
          episodeId: "$_id",
          episodeNumber: "$episode.episodeNumber",
          seriesName: "$episode.series.name",
          paidCoins: 1,
          adCoins: 1,
          dailyTaskCoins: 1,
          totalCoins: 1,
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "Top episodes by coin usage fetched",
      data,
    });
  } catch (error) {
    console.error("Top episodes analytics error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch top episodes analytics",
    });
  }
};

// get coin + vip history (all users)
exports.fetchCoinAndVipHistory = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const search = req.query.search ? req.query.search.trim() : null;
    const paymentGateway = req.query.paymentGateway?.trim() ? req.query.paymentGateway?.trim() : "";

    let dateFilterQuery = {};

    if (req.query.startDate !== "All" && req.query.endDate !== "All") {
      const startDate = new Date(req.query.startDate);
      const endDate = new Date(req.query.endDate);
      endDate.setHours(23, 59, 59, 999);

      dateFilterQuery.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    let searchMatch = {};

    if (search) {
      searchMatch = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { userUniqueId: { $regex: search, $options: "i" } },
          { uniqueId: { $regex: search, $options: "i" } },
          { paymentGateway: { $regex: search, $options: "i" } },
        ],
      };
    }

    const matchQuery = {
      ...dateFilterQuery,
      type: { $in: [5, 8] }, // 5 for coinplan purchase, 8 for vip purchase
    };

    if (paymentGateway && paymentGateway?.toLowerCase() !== "all") {
      matchQuery.paymentGateway = paymentGateway;
    }

    const [totalHistory, history] = await Promise.all([
      History.countDocuments(matchQuery),
      History.aggregate([
        {
          $match: matchQuery,
        },
        {
          $lookup: {
            from: "users",
            let: { userId: "$userId" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$userId"] },
                },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  username: 1,
                  uniqueId: 1,
                  profilePic: 1,
                },
              },
            ],
            as: "user",
          },
        },
        {
          $unwind: {
            path: "$user",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 1,
            userId: "$user._id",
            name: "$user.name",
            username: "$user.username",
            userUniqueId: "$user.uniqueId",
            profilePic: "$user.profilePic",
            paymentGateway: 1,
            price: 1,
            offerPrice: 1,
            date: 1,
            createdAt: 1,
            uniqueId: 1,
            type: 1,
          },
        },
        ...(search ? [{ $match: searchMatch }] : []),
        { $sort: { createdAt: -1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
      ]),
    ]);

    return res.status(200).json({
      status: true,
      message: "Success",
      totalHistory,
      history,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
