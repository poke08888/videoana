const User = require("../../models/user.model");
const Category = require("../../models/category.model");
const MovieSeries = require("../../models/movieSeries.model");
const ShortVideo = require("../../models/shortVideo.model");
const WithdrawRequest = require("../../models/withDrawRequest.model");
const VipPlanHistory = require("../../models/vipPlanHistory.model");
const CoinPlanHistory = require("../../models/coinplanHistory.model");
const WatchHistory = require("../../models/watchHistory.model");
const History = require("../../models/history.model");
const VideoUniqueView = require("../../models/videoUniqueView.model");

//get dashboard count
exports.dashboardCount = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
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

    const [totalUsers, totalCategory, totalMovieSeries, totalShortVideos, totalWithdrawRequests, vipRevenue, coinRevenue] = await Promise.all([
      User.countDocuments(dateFilterQuery),
      Category.countDocuments(dateFilterQuery),
      MovieSeries.countDocuments(dateFilterQuery),
      ShortVideo.countDocuments(dateFilterQuery),
      WithdrawRequest.countDocuments(dateFilterQuery),
      VipPlanHistory.aggregate([
        {
          $match: dateFilterQuery,
        },
        {
          $group: { _id: null, total: { $sum: { $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"] } } },
        },
      ]),
      CoinPlanHistory.aggregate([
        {
          $match: dateFilterQuery,
        },
        {
          $group: { _id: null, total: { $sum: { $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"] } } },
        },
      ]),
    ]);

    const totalRevenue = (vipRevenue[0]?.total || 0) + (coinRevenue[0]?.total || 0);

    return res.status(200).json({
      status: true,
      message: "Retrieve dashboard count.",
      data: {
        totalUsers,
        totalCategory,
        totalMovieSeries,
        totalShortVideos,
        totalWithdrawRequests,
        totalRevenue,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//get date wise chartAnalytic for users, revenue
exports.chartAnalytic = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate || !req.query.type) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const type = req.query.type.trim().toLowerCase();
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

    if (type === "user") {
      const data = await User.aggregate([
        {
          $match: dateFilterQuery,
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      return res.status(200).json({ status: true, message: "Success", chartAnalyticOfUsers: data });
    } else if (type === "revenue") {
      const [vipPlanRevenue, coinPlanRevenue] = await Promise.all([
        VipPlanHistory.aggregate([
          {
            $match: dateFilterQuery,
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              count: { $sum: 1 },
              price: { $sum: "$price" },
            },
          },
          {
            $sort: { _id: 1 },
          },
        ]),
        CoinPlanHistory.aggregate([
          {
            $match: dateFilterQuery,
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              count: { $sum: 1 },
              price: { $sum: "$price" },
            },
          },
          {
            $sort: { _id: 1 },
          },
        ]),
      ]);

      const data = [...vipPlanRevenue, ...coinPlanRevenue];

      return res.status(200).json({ status: true, message: "Success", chartAnalyticOfRevenue: data });
    } else {
      return res.status(200).json({ status: false, message: "type must be passed valid." });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

// Dashboard Overview: card data (overview)
exports.dashboardOverview = async (req, res) => {
  try {
    let { startDate, endDate } = req.query || {};
    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let start, end, prevStart, prevEnd;
    const createdAtMatch = {};
    const watchedAtMatch = {};

    if (!isAll) {
      if (!startDate || !endDate) {
        return res.status(400).json({ status: false, message: "startDate and endDate are required" });
      }

      start = new Date(startDate);
      end = new Date(endDate);
      if (isNaN(start) || isNaN(end) || start > end) {
        return res.status(400).json({ status: false, message: "Invalid date range" });
      }

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      createdAtMatch.createdAt = { $gte: start, $lte: end };
      watchedAtMatch.watchedAt = { $gte: start, $lte: end };

      const diff = end.getTime() - start.getTime();
      prevStart = new Date(start.getTime() - diff);
      prevEnd = new Date(end.getTime() - diff);
    }

    const prevCreatedAtMatch = !isAll ? { createdAt: { $gte: prevStart, $lte: prevEnd } } : {};
    const prevWatchedAtMatch = !isAll ? { watchedAt: { $gte: prevStart, $lte: prevEnd } } : {};

    const [userAgg, seriesAgg, episodeAgg, watchAgg, historyAgg, currentViews, previousViews] = await Promise.all([
      User.aggregate([
        {
          $facet: {
            current: [{ $match: createdAtMatch }, { $count: "total" }],
            previous: isAll ? [] : [{ $match: prevCreatedAtMatch }, { $count: "total" }],
          },
        },
      ]),

      MovieSeries.aggregate([
        {
          $facet: {
            current: [{ $match: createdAtMatch }, { $count: "total" }],
            previous: isAll ? [] : [{ $match: prevCreatedAtMatch }, { $count: "total" }],
          },
        },
      ]),

      ShortVideo.aggregate([
        {
          $facet: {
            current: [{ $match: createdAtMatch }, { $count: "total" }],
            previous: isAll ? [] : [{ $match: prevCreatedAtMatch }, { $count: "total" }],
            paidEpisodes: [{ $match: { isLocked: true, episodeNumber: { $ne: 0 } } }, { $count: "total" }],
          },
        },
      ]),

      WatchHistory.aggregate([
        {
          $facet: {
            current: [
              { $match: watchedAtMatch },
              {
                $group: {
                  _id: null,
                  watchTime: { $sum: "$totalWatchTime" },
                  totalPossibleWatchTime: { $sum: "$videoDuration" },
                },
              },
            ],
            previous: isAll
              ? []
              : [
                  { $match: prevWatchedAtMatch },
                  {
                    $group: {
                      _id: null,
                      watchTime: { $sum: "$totalWatchTime" },
                      totalPossibleWatchTime: { $sum: "$videoDuration" },
                    },
                  },
                ],
          },
        },
      ]),

      History.aggregate([
        {
          $facet: {
            current: [
              { $match: createdAtMatch },
              {
                $group: {
                  _id: null,
                  paidRevenue: {
                    $sum: {
                      $cond: [{ $eq: ["$type", 5] }, { $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"] }, 0],
                    },
                  },
                  vipRevenue: {
                    $sum: {
                      $cond: [{ $eq: ["$type", 8] }, { $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"] }, 0],
                    },
                  },
                  paidCoins: {
                    $sum: { $cond: [{ $eq: ["$type", 6] }, "$purchasedCoinUsed", 0] },
                  },
                  freeCoins: {
                    $sum: { $cond: [{ $eq: ["$type", 6] }, "$rewardCoinUsed", 0] },
                  },
                },
              },
            ],
            previous: isAll
              ? []
              : [
                  { $match: prevCreatedAtMatch },
                  {
                    $group: {
                      _id: null,
                      paidRevenue: {
                        $sum: {
                          $cond: [{ $eq: ["$type", 5] }, { $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"] }, 0],
                        },
                      },
                      vipRevenue: {
                        $sum: {
                          $cond: [{ $eq: ["$type", 8] }, { $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"] }, 0],
                        },
                      },
                      paidCoins: {
                        $sum: { $cond: [{ $eq: ["$type", 6] }, "$purchasedCoinUsed", 0] },
                      },
                      freeCoins: {
                        $sum: { $cond: [{ $eq: ["$type", 6] }, "$rewardCoinUsed", 0] },
                      },
                    },
                  },
                ],
          },
        },
      ]),

      VideoUniqueView.countDocuments(isAll ? {} : createdAtMatch),
      isAll ? 0 : VideoUniqueView.countDocuments(prevCreatedAtMatch),
    ]);

    const curUser = userAgg[0]?.current?.[0]?.total || 0;
    const prevUser = userAgg[0]?.previous?.[0]?.total || 0;

    const curSeries = seriesAgg[0]?.current?.[0]?.total || 0;
    const prevSeries = seriesAgg[0]?.previous?.[0]?.total || 0;

    const curEpisodes = episodeAgg[0]?.current?.[0]?.total || 0;
    const prevEpisodes = episodeAgg[0]?.previous?.[0]?.total || 0;
    const paidEpisodes = episodeAgg[0]?.paidEpisodes?.[0]?.total || 0;

    const watchCurrent = watchAgg[0]?.current?.[0] || {};
    const watchPrevious = watchAgg[0]?.previous?.[0] || {};

    const currentEngagement = watchCurrent.totalPossibleWatchTime > 0 ? ((watchCurrent.watchTime / watchCurrent.totalPossibleWatchTime) * 100).toFixed(1) : "0.0";

    const previousEngagement = watchPrevious.totalPossibleWatchTime > 0 ? ((watchPrevious.watchTime / watchPrevious.totalPossibleWatchTime) * 100).toFixed(1) : "0.0";

    const historyCurrent = historyAgg[0]?.current?.[0] || {};
    const historyPrevious = historyAgg[0]?.previous?.[0] || {};

    const curTotalRevenue = (historyCurrent.paidRevenue || 0) + (historyCurrent.vipRevenue || 0);
    const prevTotalRevenue = (historyPrevious.paidRevenue || 0) + (historyPrevious.vipRevenue || 0);

    const avgPaidRevenuePerEpisode = paidEpisodes > 0 ? (curTotalRevenue / paidEpisodes).toFixed(0) : "0";

    const percentChange = (c, p) => (p > 0 ? (((c - p) / p) * 100).toFixed(1) : "0.0");

    return res.status(200).json({
      status: true,
      message: "Dashboard overview fetched",

      users: { total: curUser, change: percentChange(curUser, prevUser) },
      series: { total: curSeries, change: percentChange(curSeries, prevSeries) },
      episodes: { total: curEpisodes, change: percentChange(curEpisodes, prevEpisodes) },

      views: { total: currentViews, change: percentChange(currentViews, previousViews) },

      watchTime: {
        hours: ((watchCurrent.watchTime || 0) / 3600).toFixed(1),
        change: percentChange(watchCurrent.watchTime || 0, watchPrevious.watchTime || 0),
      },

      engagementRate: {
        rate: currentEngagement,
        change: percentChange(currentEngagement, previousEngagement),
      },
      avgPaidRevenuePerEpisode,

      revenue: {
        total: curTotalRevenue,
        change: percentChange(curTotalRevenue, prevTotalRevenue),
        paidCoins: { amount: historyCurrent.paidRevenue || 0 },
        vip: { amount: historyCurrent.vipRevenue || 0 },
      },

      coinsSpent: {
        total: (historyCurrent.paidCoins || 0) + (historyCurrent.freeCoins || 0),
        change: percentChange((historyCurrent.paidCoins || 0) + (historyCurrent.freeCoins || 0), (historyPrevious.paidCoins || 0) + (historyPrevious.freeCoins || 0)),
        paid: historyCurrent.paidCoins || 0,
        free: historyCurrent.freeCoins || 0,
      },
    });
  } catch (error) {
    console.error("Dashboard Overview Error:", error);
    return res.status(500).json({ status: false, message: "Failed to load dashboard overview" });
  }
};

// Paid Revenue Trend Chart (overview)
exports.getPaidRevenueTrend = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";
    const matchQuery = {
      type: { $in: [5, 8] }, // coin + vip
    };

    let start, end;

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

      matchQuery.createdAt = { $gte: start, $lte: end };
    }

    const timezone = "Asia/Kolkata";

    const data = await History.aggregate([
      {
        $match: matchQuery,
      },

      {
        $project: {
          day: {
            $dateTrunc: {
              date: "$createdAt",
              unit: "day",
              timezone,
            },
          },

          paidCoinRevenue: {
            $cond: [
              { $eq: ["$type", 5] },
              {
                $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
              },
              0,
            ],
          },

          vipRevenue: {
            $cond: [
              { $eq: ["$type", 8] },
              {
                $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
              },
              0,
            ],
          },
        },
      },

      {
        $group: {
          _id: "$day",
          paidCoinRevenue: { $sum: "$paidCoinRevenue" },
          vipRevenue: { $sum: "$vipRevenue" },
        },
      },

      { $sort: { _id: 1 } },

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
          paidCoinRevenue: 1,
          vipRevenue: 1,
          totalRevenue: { $add: ["$paidCoinRevenue", "$vipRevenue"] },
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "Paid revenue trend fetched",
      data,
    });
  } catch (error) {
    console.error("Paid Revenue Trend Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch revenue trend",
    });
  }
};

// get paid revenue card (Revenue and Monetization)
exports.getRevenueAnalytics = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let start, end, prevStart, prevEnd;

    const matchQuery = {
      type: { $in: [5, 8] }, // coin + vip
    };

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

      matchQuery.createdAt = { $gte: start, $lte: end };

      const diffMs = end.getTime() - start.getTime();
      prevStart = new Date(start.getTime() - diffMs);
      prevEnd = new Date(end.getTime() - diffMs);
    }

    const [result] = await History.aggregate([
      { $match: matchQuery },

      {
        $project: {
          coinRevenueCurrent: {
            $cond: [
              { $eq: ["$type", 5] },
              {
                $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
              },
              0,
            ],
          },

          vipRevenueCurrent: {
            $cond: [
              { $eq: ["$type", 8] },
              {
                $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
              },
              0,
            ],
          },

          coinRevenuePrevious: !isAll
            ? {
                $cond: [
                  {
                    $and: [{ $eq: ["$type", 5] }, { $gte: ["$createdAt", prevStart] }, { $lte: ["$createdAt", prevEnd] }],
                  },
                  {
                    $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
                  },
                  0,
                ],
              }
            : { $literal: 0 },

          vipRevenuePrevious: !isAll
            ? {
                $cond: [
                  {
                    $and: [{ $eq: ["$type", 8] }, { $gte: ["$createdAt", prevStart] }, { $lte: ["$createdAt", prevEnd] }],
                  },
                  {
                    $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
                  },
                  0,
                ],
              }
            : { $literal: 0 },
        },
      },

      {
        $group: {
          _id: null,
          coinRevenue: { $sum: "$coinRevenueCurrent" },
          vipRevenue: { $sum: "$vipRevenueCurrent" },
          prevCoinRevenue: { $sum: "$coinRevenuePrevious" },
          prevVipRevenue: { $sum: "$vipRevenuePrevious" },
        },
      },

      {
        $addFields: {
          totalRevenue: { $add: ["$coinRevenue", "$vipRevenue"] },
          previousTotalRevenue: isAll ? 0 : { $add: ["$prevCoinRevenue", "$prevVipRevenue"] },
        },
      },

      {
        $addFields: {
          coinRevenuePercentage: {
            $cond: [
              { $gt: ["$totalRevenue", 0] },
              {
                $round: [
                  {
                    $multiply: [{ $divide: ["$coinRevenue", "$totalRevenue"] }, 100],
                  },
                  1,
                ],
              },
              0,
            ],
          },

          vipRevenuePercentage: {
            $cond: [
              { $gt: ["$totalRevenue", 0] },
              {
                $round: [
                  {
                    $multiply: [{ $divide: ["$vipRevenue", "$totalRevenue"] }, 100],
                  },
                  1,
                ],
              },
              0,
            ],
          },

          revenueGrowthPercentage: {
            $cond: [
              { $gt: ["$previousTotalRevenue", 0] },
              {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: [{ $subtract: ["$totalRevenue", "$previousTotalRevenue"] }, "$previousTotalRevenue"],
                      },
                      100,
                    ],
                  },
                  1,
                ],
              },
              0,
            ],
          }, // Growth % = Current − Previous / Previous * 100
        },
      },

      {
        $project: {
          _id: 0,
          totalRevenue: 1,
          coinRevenue: 1,
          vipRevenue: 1,
          coinRevenuePercentage: 1,
          vipRevenuePercentage: 1,
          revenueGrowthPercentage: 1,
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "Revenue analytics fetched",
      data: result || {
        totalRevenue: 0,
        coinRevenue: 0,
        vipRevenue: 0,
        coinRevenuePercentage: 0,
        vipRevenuePercentage: 0,
        revenueGrowthPercentage: 0,
      },
    });
  } catch (error) {
    console.error("Revenue analytics error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch revenue analytics",
    });
  }
};

// get Revenue by Series and Episodes by purchased coins chart (Paid Coin Revenue) (Revenue and Monetization)
exports.getPaidRevenue = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;
    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let start, end;

    const historyDateMatch = {};
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
          message: "Invalid startDate or endDate",
        });
      }

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      historyDateMatch.createdAt = { $gte: start, $lte: end };
    }

    const [coinStats] = await History.aggregate([
      {
        $match: {
          type: 5, // coin purchase
          ...historyDateMatch,
        },
      },
      {
        $group: {
          _id: null,
          totalCoins: { $sum: "$coin" },
          totalMoney: {
            $sum: {
              $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
            },
          },
        },
      },
    ]); // coinRate = totalMoneyFromCoinPurchases / totalCoinsPurchased

    const coinRate = coinStats && coinStats.totalCoins > 0 ? coinStats.totalMoney / coinStats.totalCoins : 0;

    const matchQuery = {
      type: 6, // unlock with coins
      purchasedCoinUsed: { $gt: 0 },
      movieSeries: { $ne: null },
      videoId: { $ne: null },
      ...historyDateMatch,
    };

    const topLimit = 10;

    const [result] = await History.aggregate([
      { $match: matchQuery },

      {
        $addFields: {
          amountRevenue: {
            $multiply: ["$purchasedCoinUsed", coinRate],
          },
        }, // amountRevenue = purchasedCoinUsed × coinRate
      },

      {
        $facet: {
          allSeriesTotal: [
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$amountRevenue" },
              },
            },
          ],

          topSeries: [
            {
              $group: {
                _id: "$movieSeries",
                revenue: { $sum: "$amountRevenue" },
              },
            },
            { $sort: { revenue: -1 } },
            { $limit: topLimit },
            {
              $lookup: {
                from: "movieseries",
                localField: "_id",
                foreignField: "_id",
                as: "seriesInfo",
              },
            },
            { $unwind: "$seriesInfo" },

            {
              $project: {
                _id: 0,
                seriesId: "$_id",
                seriesName: "$seriesInfo.name",
                revenue: { $round: ["$revenue", 2] },
              },
            },
          ],

          topPaidEpisodes: [
            {
              $group: {
                _id: "$videoId",
                revenue: { $sum: "$amountRevenue" },
                movieSeries: { $first: "$movieSeries" },
              },
            },
            { $sort: { revenue: -1 } },
            { $limit: topLimit },
            {
              $lookup: {
                from: "shortvideos",
                localField: "_id",
                foreignField: "_id",
                as: "episode",
              },
            },
            { $unwind: "$episode" },
            {
              $lookup: {
                from: "movieseries",
                localField: "movieSeries",
                foreignField: "_id",
                as: "series",
              },
            },
            { $unwind: "$series" },
            {
              $project: {
                _id: 0,
                episodeId: "$_id",
                seriesId: "$movieSeries",
                seriesName: "$series.name",
                episodeNumber: "$episode.episodeNumber",
                revenue: { $round: ["$revenue", 2] },
              },
            },
          ],
        },
      },

      {
        $project: {
          revenueBySeries: {
            $map: {
              input: "$topSeries",
              as: "s",
              in: {
                seriesId: "$$s.seriesId",
                seriesName: "$$s.seriesName",
                revenue: "$$s.revenue",
                percentage: {
                  $cond: [
                    { $gt: [{ $arrayElemAt: ["$allSeriesTotal.totalRevenue", 0] }, 0] },
                    {
                      $round: [
                        {
                          $multiply: [
                            {
                              $divide: ["$$s.revenue", { $arrayElemAt: ["$allSeriesTotal.totalRevenue", 0] }],
                            },
                            100,
                          ],
                        },
                        0,
                      ],
                    },
                    0,
                  ],
                },
              },
            },
          },
          topPaidEpisodes: 1,
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "Paid revenue dashboard analytics fetched",
      data: {
        revenueBySeries: result?.revenueBySeries || [],
        topPaidEpisodes: result?.topPaidEpisodes || [],
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch analytics",
    });
  }
};

// Top 10 Revenue Episodes (Revenue and Monetization)
exports.getTopRevenueEpisodes = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;
    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    const historyDateMatch = {};
    const uniqueViewDateMatch = {};

    if (!isAll) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      historyDateMatch.createdAt = { $gte: start, $lte: end };
      uniqueViewDateMatch.createdAt = { $gte: start, $lte: end };
    }

    const [coinStats, vipStats, totalVipUsers] = await Promise.all([
      History.aggregate([
        { $match: { type: 5, ...historyDateMatch } },
        {
          $group: {
            _id: null,
            totalCoins: { $sum: "$coin" },
            totalMoney: {
              $sum: {
                $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
              },
            },
          },
        },
      ]),
      History.aggregate([
        { $match: { type: 8, ...historyDateMatch } },
        {
          $group: {
            _id: null,
            vipPool: {
              $sum: {
                $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
              },
            },
          },
        },
      ]),
      VideoUniqueView.distinct("videoId", {
        accessMode: "VIP",
        ...uniqueViewDateMatch,
      }),
    ]);

    const vipPool = vipStats[0]?.vipPool || 0;
    const vipViewValue = vipPool > 0 && totalVipUsers.length > 0 ? vipPool / totalVipUsers.length : 0;

    const coinRate = coinStats.length > 0 && coinStats[0]?.totalCoins > 0 ? coinStats[0].totalMoney / coinStats[0].totalCoins : 0;

    const data = await History.aggregate([
      {
        $match: {
          type: 6,
          videoId: { $ne: null },
          ...historyDateMatch,
        },
      },
      {
        $group: {
          _id: "$videoId",
          paidCoins: { $sum: "$purchasedCoinUsed" },
        },
      },
      {
        $lookup: {
          from: "videouniqueviews",
          let: { vid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$videoId", "$$vid"] },
                accessMode: "VIP",
                ...uniqueViewDateMatch,
              },
            },
            { $count: "vipUsers" },
          ],
          as: "vip",
        },
      },
      {
        $addFields: {
          vipUsers: { $ifNull: [{ $arrayElemAt: ["$vip.vipUsers", 0] }, 0] },
        },
      },

      {
        $addFields: {
          paidCoinRevenue: {
            $round: [{ $multiply: ["$paidCoins", coinRate] }, 2],
          }, // Coin Revenue (episode-wise) paidCoinRevenue = SUM(purchasedCoinUsed) × coinRate
          vipRevenue: {
            $round: [{ $multiply: ["$vipUsers", vipViewValue] }, 2],
          }, // VIP Revenue (episode-wise) vipRevenue = uniqueVIPUsers for episode × vipViewValue (where vipViewValue = totalVIPPool / totalVIPUsers)
        },
      },

      {
        $addFields: {
          totalRevenue: { $add: ["$paidCoinRevenue", "$vipRevenue"] },
        },
      },

      { $match: { totalRevenue: { $gt: 0 } } },
      { $sort: { totalRevenue: -1 } },

      {
        $lookup: {
          from: "shortvideos",
          let: { vid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$vid"] },
              },
            },
            {
              $project: {
                _id: 1,
                episodeNumber: 1,
                isLocked: 1,
                movieSeries: 1,
              },
            },
          ],
          as: "video",
        },
      },
      { $unwind: "$video" },

      {
        $lookup: {
          from: "movieseries",
          let: { sid: "$video.movieSeries" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$sid"] },
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
              },
            },
          ],
          as: "series",
        },
      },
      { $unwind: "$series" },

      {
        $project: {
          _id: 0,
          // vipUsers: 1,
          episodeId: "$_id",
          // rank: 1,
          episode: {
            $concat: ["$series.name", " - Ep", { $toString: "$video.episodeNumber" }],
          },
          type: {
            $cond: [{ $eq: ["$video.isLocked", false] }, "FREE", "PAID"],
          },
          paidCoinRevenue: 1,
          vipRevenue: 1,
          totalRevenue: 1,
          split: {
            $cond: [
              { $gt: ["$totalRevenue", 0] },
              {
                $round: [
                  {
                    $multiply: [{ $divide: ["$paidCoinRevenue", "$totalRevenue"] }, 100],
                  },
                  0,
                ],
              },
              0,
            ],
          }, // Split (% coin contribution) split = (paidCoinRevenue / totalRevenue) × 100
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "Top revenue episodes fetched",
      data,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch top revenue episodes",
    });
  }
};

// Series Revenue Breakdown (Revenue and Monetization)
exports.getSeriesRevenueBreakdown = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let startD, endD;
    const historyDateMatch = {};
    const uniqueDateMatch = {};

    if (!isAll) {
      startD = new Date(startDate);
      endD = new Date(endDate);

      startD.setHours(0, 0, 0, 0);
      endD.setHours(23, 59, 59, 999);

      historyDateMatch.createdAt = { $gte: startD, $lte: endD };
      uniqueDateMatch.createdAt = { $gte: startD, $lte: endD };
    }

    const topLimit = 10;

    const [[coinStats], [vipStats], totalVipViews] = await Promise.all([
      History.aggregate([
        { $match: { type: 5, ...historyDateMatch } },
        {
          $group: {
            _id: null,
            totalCoins: { $sum: "$coin" },
            totalMoney: {
              $sum: {
                $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
              },
            },
          },
        },
      ]),
      History.aggregate([
        { $match: { type: 8, ...historyDateMatch } },
        {
          $group: {
            _id: null,
            vipPool: {
              $sum: {
                $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
              },
            },
          },
        },
      ]),
      VideoUniqueView.countDocuments({
        accessMode: "VIP",
        ...uniqueDateMatch,
      }),
    ]);

    const coinRate = coinStats?.totalCoins > 0 ? coinStats.totalMoney / coinStats.totalCoins : 0;

    const vipViewValue = vipStats?.vipPool > 0 && totalVipViews > 0 ? vipStats.vipPool / totalVipViews : 0;

    const data = await MovieSeries.aggregate([
      { $project: { name: 1 } },
      {
        $lookup: {
          from: "videouniqueviews",
          let: { sid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$movieSeriesId", "$$sid"] },
                ...uniqueDateMatch,
              },
            },
          ],
          as: "uniqueViews",
        },
      },
      {
        $addFields: {
          totalViews: { $size: "$uniqueViews" },

          vipUsers: {
            $size: {
              $filter: {
                input: "$uniqueViews",
                as: "u",
                cond: { $eq: ["$$u.accessMode", "VIP"] },
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "histories",
          let: { sid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$movieSeries", "$$sid"] },
                type: 6,
                ...historyDateMatch,
              },
            },
            {
              $group: {
                _id: null,
                paidCoins: { $sum: "$purchasedCoinUsed" },
              },
            },
          ],
          as: "coinStats",
        },
      },
      {
        $lookup: {
          from: "shortvideos",
          let: { sid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$movieSeries", "$$sid"] },
                isLocked: true,
                episodeNumber: { $gt: 0 },
              },
            },
            { $count: "episodes" },
          ],
          as: "episodeCount",
        },
      },
      {
        $addFields: {
          episodes: {
            $ifNull: [{ $arrayElemAt: ["$episodeCount.episodes", 0] }, 0],
          },
        },
      },
      {
        $lookup: {
          from: "watchhistories",
          let: { sid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$movieSeries", "$$sid"] },
                ...(isAll ? {} : { watchedAt: { $gte: startD, $lte: endD } }),
              },
            },
            {
              $group: {
                _id: null,
                watchTime: { $sum: "$totalWatchTime" },
                totalPossibleWatchTime: { $sum: "$videoDuration" },
              },
            },
          ],
          as: "engagementStats",
        },
      },
      {
        $addFields: {
          watchTime: {
            $ifNull: [{ $arrayElemAt: ["$engagementStats.watchTime", 0] }, 0],
          },
          totalPossibleWatchTime: {
            $ifNull: [{ $arrayElemAt: ["$engagementStats.totalPossibleWatchTime", 0] }, 0],
          },
        },
      },
      {
        $addFields: {
          engagementRate: {
            $cond: [
              { $gt: ["$totalPossibleWatchTime", 0] },
              {
                $round: [
                  {
                    $multiply: [{ $divide: ["$watchTime", "$totalPossibleWatchTime"] }, 100],
                  },
                  1,
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          paidCoinRevenue: {
            $round: [
              {
                $multiply: [{ $ifNull: [{ $arrayElemAt: ["$coinStats.paidCoins", 0] }, 0] }, coinRate],
              },
              2,
            ],
          },
          vipRevenue: {
            $round: [{ $multiply: ["$vipUsers", vipViewValue] }, 2],
          },
        },
      },
      {
        $addFields: {
          totalRevenue: {
            $add: ["$paidCoinRevenue", "$vipRevenue"],
          },
        },
      },

      { $match: { totalRevenue: { $gt: 0 } } },
      {
        $addFields: {
          revenuePerEpisode: {
            $cond: [{ $gt: ["$episodes", 0] }, { $round: [{ $divide: ["$totalRevenue", "$episodes"] }, 0] }, 0],
          },
        },
      },
      { $sort: { totalRevenue: -1, name: 1 } },
      { $limit: topLimit },
      {
        $project: {
          _id: 0,
          seriesId: "$_id",
          series: "$name",
          episodes: 1,
          totalViews: 1,
          paidCoinRevenue: 1,
          vipRevenue: 1,
          totalRevenue: 1,
          revenuePerEpisode: 1,
          share: 1,
          vipUsers: 1,
          engagementRate: 1,
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "Series revenue fetched",
      data,
    });
  } catch (error) {
    console.error("Series revenue breakdown error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch series revenue breakdown",
    });
  }
};

// revenue breakdown by coin and vip plan purchase (Revenue and Monetization)
exports.getRevenueBreakdown = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const matchFilter = {};

    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    if (startDate && endDate && !isAll) {
      matchFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const [coinStats, vipStats] = await Promise.all([
      CoinPlanHistory.aggregate([
        { $match: matchFilter },
        {
          $addFields: {
            actualAmount: {
              $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
            },
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$actualAmount" },
            totalTransactions: { $sum: 1 },
          },
        },
      ]),
      VipPlanHistory.aggregate([
        { $match: matchFilter },
        {
          $addFields: {
            actualAmount: {
              $cond: [{ $gt: ["$offerPrice", 0] }, "$offerPrice", "$price"],
            },
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$actualAmount" },
            totalTransactions: { $sum: 1 },
          },
        },
      ]),
    ]);

    const coinRevenue = coinStats[0]?.totalRevenue || 0;
    const coinTransactions = coinStats[0]?.totalTransactions || 0;

    const vipRevenue = vipStats[0]?.totalRevenue || 0;
    const vipTransactions = vipStats[0]?.totalTransactions || 0;

    const totalRevenue = coinRevenue + vipRevenue;

    const coinPercentage = totalRevenue > 0 ? ((coinRevenue / totalRevenue) * 100).toFixed(0) : 0;

    const vipPercentage = totalRevenue > 0 ? ((vipRevenue / totalRevenue) * 100).toFixed(0) : 0;

    return res.status(200).json({
      status: true,
      revenue: [
        {
          category: "Coin Purchases",
          amount: coinRevenue,
          percentage: coinPercentage,
          transactions: coinTransactions,
        },
        {
          category: "VIP Subscriptions",
          amount: vipRevenue,
          percentage: vipPercentage,
          transactions: vipTransactions,
        },
        {
          category: "Ad Revenue",
          amount: 0,
          percentage: 0,
          transactions: 0,
        },
      ],
      totalRevenue,
    });
  } catch (error) {
    console.error("Revenue Breakdown Error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch revenue breakdown",
    });
  }
};
