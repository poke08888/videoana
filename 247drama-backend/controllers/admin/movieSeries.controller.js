const MovieSeries = require("../../models/movieSeries.model");

//import model
const Category = require("../../models/category.model");
const ShortVideo = require("../../models/shortVideo.model");
const History = require("../../models/history.model");
const UserVideoList = require("../../models/userVideoList.model");
const WatchHistory = require("../../models/watchHistory.model");
const Language = require("../../models/language.model");
const VideoUniqueView = require("../../models/videoUniqueView.model");

const pLimit = require("p-limit");

const { getVideoDuration } = require("../../util/videoDuration");

//mongoose
const mongoose = require("mongoose");

//deleteFromStorage
const { deleteFromStorage } = require("../../util/storageHelper");
const { default: axios } = require("axios");

const https = require("https");
const agent = new https.Agent({
  family: 4, // force IPv4
});

//create movie or webseries
exports.createContent = async (req, res) => {
  try {
    const { name, type, description, category, releaseDate, thumbnail, banner, maxAdsForFreeView, language } = req.body;

    if (!name || !type || !description || !category || !thumbnail || !banner || !maxAdsForFreeView || !language) {
      await Promise.all([req.body.thumbnail && deleteFromStorage(req.body.thumbnail), req.body.banner && deleteFromStorage(req.body.banner)]);
      return res.status(200).json({ status: false, message: "Missing required fields." });
    }

    if (type !== 1 && type !== 2) {
      await Promise.all([req.body.thumbnail && deleteFromStorage(req.body.thumbnail), req.body.banner && deleteFromStorage(req.body.banner)]);
      return res.status(200).json({ status: false, message: "Invalid content type." });
    }

    const categoryId = new mongoose.Types.ObjectId(category);
    const languageId = new mongoose.Types.ObjectId(language);

    const [validCategory, validLanguage] = await Promise.all([Category.findById(categoryId).select("_id").lean(), Language.findById(languageId).select("_id").lean()]);

    if (!validCategory) {
      await Promise.all([req.body.thumbnail && deleteFromStorage(req.body.thumbnail), req.body.banner && deleteFromStorage(req.body.banner)]);
      return res.status(200).json({ status: false, message: "Category does not found." });
    }

    if (!validLanguage) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(200).json({ status: false, message: "Language not found." });
    }

    const newContent = new MovieSeries({
      language: languageId,
      name,
      description,
      thumbnail,
      banner,
      type,
      category,
      maxAdsForFreeView: maxAdsForFreeView || 0,
      releaseDate: releaseDate || Date.now(),
    });

    await newContent.save();

    return res.status(200).json({
      status: true,
      message: "Content created successfully",
      data: newContent,
    });
  } catch (error) {
    await Promise.all([req.body.thumbnail && deleteFromStorage(req.body.thumbnail), req.body.banner && deleteFromStorage(req.body.banner)]);

    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//update movie or webseries
exports.updateContent = async (req, res) => {
  try {
    const { movieWebseriesId, name, description, maxAdsForFreeView, thumbnail, banner, category, language } = req.body;

    if (!movieWebseriesId) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(200).json({ status: false, message: "movieWebseriesId is required." });
    }

    const movieId = new mongoose.Types.ObjectId(movieWebseriesId);
    const movie = await MovieSeries.findById(movieId);

    if (!movie) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(200).json({ status: false, message: "MovieSeries not found." });
    }

    movie.name = name || movie.name;
    movie.description = description || movie.description;
    movie.maxAdsForFreeView = maxAdsForFreeView || movie.maxAdsForFreeView;

    await Promise.all([thumbnail && movie.thumbnail && deleteFromStorage(movie.thumbnail), banner && movie.banner && deleteFromStorage(movie.banner)]);

    if (thumbnail) movie.thumbnail = thumbnail;
    if (banner) movie.banner = banner;

    let [validCategory, validLanguage] = [null, null];

    if (category || language) {
      const validations = [];

      if (category) {
        const categoryId = new mongoose.Types.ObjectId(category);
        validations.push(Category.findById(categoryId).select("_id").lean());
      } else {
        validations.push(Promise.resolve(null));
      }

      if (language) {
        const languageId = new mongoose.Types.ObjectId(language);
        validations.push(Language.findById(languageId).select("_id").lean());
      } else {
        validations.push(Promise.resolve(null));
      }

      [validCategory, validLanguage] = await Promise.all(validations);
    }

    if (category && !validCategory) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(200).json({ status: false, message: "Category not found." });
    }

    if (language && !validLanguage) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(200).json({ status: false, message: "Language not found." });
    }

    if (validCategory) movie.category = validCategory._id;
    if (validLanguage) movie.language = validLanguage._id;

    await movie.save();

    return res.status(200).json({
      status: true,
      message: "Content updated successfully",
      data: movie,
    });
  } catch (error) {
    await Promise.all([req.body.thumbnail && deleteFromStorage(req.body.thumbnail), req.body.banner && deleteFromStorage(req.body.banner)]);
    console.error(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//toggle trending Status for Movie or Web Series
exports.toggleTrendingStatus = async (req, res) => {
  try {
    const { movieWebseriesId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(movieWebseriesId)) {
      return res.status(200).json({ status: false, message: "Invalid movieWebseries ID." });
    }

    const movieWebseries = await MovieSeries.findById(movieWebseriesId);
    if (!movieWebseries) {
      return res.status(200).json({ status: false, message: "Movie or web series not found." });
    }

    movieWebseries.isTrending = !movieWebseries.isTrending;
    await movieWebseries.save();

    return res.status(200).json({
      status: true,
      message: `Trending status has been ${movieWebseries.isTrending ? "enabled" : "disabled"} successfully.`,
      data: movieWebseries,
    });
  } catch (error) {
    console.error("Error toggling trending status:", error);
    return res.status(500).json({ status: false, error: "Internal Server Error" });
  }
};

//handle banner is auto-animated
exports.toggleAutoAnimateBanner = async (req, res) => {
  try {
    if (!req.query.movieWebseriesId) {
      return res.status(200).json({ status: false, message: "The 'movieWebseriesId' field is required." });
    }

    const movieWebseriesId = new mongoose.Types.ObjectId(req.query.movieWebseriesId);

    const movieWebseries = await MovieSeries.findById(movieWebseriesId);
    if (!movieWebseries) {
      return res.status(200).json({ status: false, message: "Movie or web series not found.." });
    }

    movieWebseries.isAutoAnimateBanner = !movieWebseries.isAutoAnimateBanner;
    await movieWebseries.save();

    return res.status(200).json({ status: true, message: `The Movie or web series has been updated successfully.`, data: movieWebseries });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//toggle active Status for Movie or Web Series
exports.toggleActiveStatus = async (req, res) => {
  try {
    const { movieWebseriesId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(movieWebseriesId)) {
      return res.status(200).json({ status: false, message: "Invalid movieWebseries ID." });
    }

    const movieWebseries = await MovieSeries.findById(movieWebseriesId);
    if (!movieWebseries) {
      return res.status(200).json({ status: false, message: "Movie or web series not found." });
    }

    movieWebseries.isActive = !movieWebseries.isActive;
    await movieWebseries.save();

    return res.status(200).json({
      status: true,
      message: `Active status has been ${movieWebseries.isActive ? "enabled" : "disabled"} successfully.`,
      data: movieWebseries,
    });
  } catch (error) {
    console.error("Error toggling active status:", error);
    return res.status(500).json({ status: false, error: "Internal Server Error" });
  }
};

//fetch movie or webseries
exports.fetchAllMediaContent = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const search = req.query.search ? req.query.search.trim() : "";

    const pipeline = [
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $unwind: {
          path: "$category",
          preserveNullAndEmptyArrays: true,
        },
      },
      ...(search
        ? [
            {
              $match: {
                $or: [
                  {
                    name: { $regex: search, $options: "i" },
                  },
                  {
                    description: { $regex: search, $options: "i" },
                  },
                  {
                    "category.name": { $regex: search, $options: "i" },
                  },
                ],
              },
            },
          ]
        : []),
      {
        $facet: {
          totalCount: [{ $count: "count" }],
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: (start - 1) * limit },
            { $limit: limit },
            {
              $lookup: {
                from: "languages",
                localField: "language",
                foreignField: "_id",
                as: "languageObj",
              },
            },
            {
              $unwind: {
                path: "$languageObj",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "shortvideos",
                localField: "_id",
                foreignField: "movieSeries",
                as: "shortVideos",
              },
            },
            {
              $addFields: {
                totalShortVideos: { $size: "$shortVideos" },
              },
            },
            {
              $project: {
                shortVideos: 0,
              },
            },
            {
              $project: {
                type: 1,
                name: 1,
                description: 1,
                thumbnail: 1,
                banner: 1,
                isTrending: 1,
                isAutoAnimateBanner: 1,
                isActive: 1,
                releaseDate: 1,
                totalShortVideos: 1,
                maxAdsForFreeView: 1,
                categoryId: "$category._id",
                category: "$category.name",
                languageId: "$languageObj._id",
                languageName: { $ifNull: ["$languageObj.name", ""] },
              },
            },
          ],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
          data: 1,
        },
      },
    ];

    const result = await MovieSeries.aggregate(pipeline);

    return res.status(200).json({
      status: true,
      message: "Success",
      total: result[0]?.total || 0,
      data: result[0]?.data || [],
    });
  } catch (error) {
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//delete movie or webseries
exports.removeMovieSeries = async (req, res) => {
  try {
    const { movieWebseriesId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(movieWebseriesId)) {
      return res.status(200).json({ status: false, message: "Invalid movieWebseries ID." });
    }

    const [movieWebseries, shortVideos] = await Promise.all([
      MovieSeries.findById(movieWebseriesId).lean().select("_id thumbnail banner"),
      ShortVideo.find({ movieSeries: movieWebseriesId }).lean().select("_id videoImage videoUrl"),
    ]);

    if (!movieWebseries) {
      return res.status(200).json({ status: false, message: "Movie or web series not found." });
    }

    res.status(200).json({
      status: true,
      message: "Movie/Web series and associated short videos deleted successfully.",
    });

    for (const shortVideo of shortVideos) {
      await Promise.all([
        shortVideo.videoImage ? deleteFromStorage(shortVideo.videoImage) : null,
        shortVideo.videoUrl ? deleteFromStorage(shortVideo.videoUrl) : null,
        ShortVideo.deleteOne({ _id: shortVideo._id }),
      ]);
    }

    await Promise.all([
      ShortVideo.deleteMany({ movieSeries: movieWebseries._id }),
      History.deleteMany({ movieSeries: movieWebseries._id }),
      UserVideoList.deleteMany({ "videos.movieSeries": movieWebseries._id }),
      WatchHistory.deleteMany({ movieSeries: movieWebseries._id }),
    ]);

    await Promise.all([
      movieWebseries.thumbnail ? deleteFromStorage(movieWebseries.thumbnail) : null,
      movieWebseries.banner ? deleteFromStorage(movieWebseries.banner) : null,
      MovieSeries.deleteOne({ _id: movieWebseries._id }),
    ]);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//series Overview Analytics (Series Analytics)
exports.getSeriesAnalytics = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let startD, endD;

    const historyDateMatch = {};
    const watchDateMatch = {};
    const uniqueDateMatch = {};

    if (!isAll) {
      if (!startDate || !endDate) {
        return res.status(400).json({ status: false, message: "startDate and endDate are required" });
      }

      startD = new Date(startDate);
      endD = new Date(endDate);

      if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || startD > endD) {
        return res.status(400).json({ status: false, message: "Invalid date range" });
      }

      startD.setHours(0, 0, 0, 0);
      endD.setHours(23, 59, 59, 999);

      historyDateMatch.createdAt = { $gte: startD, $lte: endD };
      watchDateMatch.watchedAt = { $gte: startD, $lte: endD };
      uniqueDateMatch.createdAt = { $gte: startD, $lte: endD };
    }

    const totalSeriesCount = await MovieSeries.countDocuments();

    if (totalSeriesCount === 0) {
      return res.status(200).json({
        status: true,
        message: "No series found",
        data: {
          top: {
            highestRevenue: null,
            bestEngagement: null,
            mostViewed: null,
          },
          averages: {
            avgEpisodesPerSeries: 0,
            avgFreeEpisodes: 0,
            avgCompletionRate: 0,
            avgRevenuePerSeries: 0,
          },
        },
      });
    }

    const [coinStatsArr, vipStatsArr, totalVipViews] = await Promise.all([
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

    const coinRate = coinStatsArr[0]?.totalCoins > 0 ? coinStatsArr[0].totalMoney / coinStatsArr[0].totalCoins : 0;
    const vipViewValue = vipStatsArr[0]?.vipPool > 0 && totalVipViews > 0 ? vipStatsArr[0].vipPool / totalVipViews : 0;

    const [result] = await MovieSeries.aggregate([
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
            {
              $group: {
                _id: null,
                views: { $sum: 1 },
                vipViews: {
                  $sum: { $cond: [{ $eq: ["$accessMode", "VIP"] }, 1, 0] },
                },
              },
            },
          ],
          as: "unique",
        },
      },
      {
        $addFields: {
          views: { $ifNull: [{ $arrayElemAt: ["$unique.views", 0] }, 0] },
          vipViews: { $ifNull: [{ $arrayElemAt: ["$unique.vipViews", 0] }, 0] },
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
                totalWatchTime: { $gt: 0 },
                ...watchDateMatch,
              },
            },
            {
              $lookup: {
                from: "shortvideos",
                localField: "videoId",
                foreignField: "_id",
                pipeline: [{ $project: { duration: 1 } }],
                as: "video",
              },
            },
            {
              $addFields: {
                videoDuration: {
                  $ifNull: [{ $arrayElemAt: ["$video.duration", 0] }, 0],
                },
              },
            },
            {
              $group: {
                _id: null,
                totalWatchTime: { $sum: "$totalWatchTime" },
                totalPossibleWatchTime: { $sum: "$videoDuration" },
              },
            },
          ],
          as: "engagement",
        },
      },
      {
        $addFields: {
          avgCompletion: {
            $cond: [
              { $gt: [{ $arrayElemAt: ["$engagement.totalPossibleWatchTime", 0] }, 0] },
              {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: [{ $arrayElemAt: ["$engagement.totalWatchTime", 0] }, { $arrayElemAt: ["$engagement.totalPossibleWatchTime", 0] }],
                      },
                      100,
                    ],
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
          as: "coin",
        },
      },
      {
        $addFields: {
          coinRevenue: {
            $round: [
              {
                $multiply: [{ $ifNull: [{ $arrayElemAt: ["$coin.paidCoins", 0] }, 0] }, coinRate],
              },
              2,
            ],
          },
          vipRevenue: {
            $round: [{ $multiply: ["$vipViews", vipViewValue] }, 2],
          },
        },
      },
      {
        $addFields: {
          totalRevenue: {
            $add: ["$coinRevenue", "$vipRevenue"],
          },
        },
      },
      {
        $lookup: {
          from: "shortvideos",
          let: { sid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$movieSeries", "$$sid"] } } },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                free: { $sum: { $cond: [{ $eq: ["$isLocked", false] }, 1, 0] } },
              },
            },
          ],
          as: "eps",
        },
      },
      {
        $addFields: {
          episodes: { $ifNull: [{ $arrayElemAt: ["$eps.total", 0] }, 0] },
          freeEpisodes: { $ifNull: [{ $arrayElemAt: ["$eps.free", 0] }, 0] },
        },
      },

      {
        $facet: {
          all: [
            {
              $project: {
                _id: 0,
                series: "$name",
                episodes: 1,
                freeEpisodes: 1,
                views: 1,
                avgCompletion: 1,
                totalRevenue: 1,
              },
            },
          ],
          highestRevenue: [{ $sort: { totalRevenue: -1 } }, { $limit: 1 }],
          bestEngagement: [{ $sort: { avgCompletion: -1 } }, { $limit: 1 }],
          mostViewed: [{ $sort: { views: -1 } }, { $limit: 1 }],
        },
      },
    ]);

    if (!result || !result.all?.length) {
      return res.status(200).json({
        status: true,
        message: "No analytics data found",
        data: {
          top: {
            highestRevenue: null,
            bestEngagement: null,
            mostViewed: null,
          },
          averages: {
            avgEpisodesPerSeries: 0,
            avgFreeEpisodes: 0,
            avgCompletionRate: 0,
            avgRevenuePerSeries: 0,
          },
        },
      });
    }

    const all = result.all || [];
    const totalSeries = all.length;

    const totalRevenue = all.reduce((s, x) => s + x.totalRevenue, 0);
    const totalEpisodes = all.reduce((s, x) => s + x.episodes, 0);
    const totalFreeEpisodes = all.reduce((s, x) => s + x.freeEpisodes, 0);
    const avgCompletion = totalSeries > 0 ? all.reduce((s, x) => s + x.avgCompletion, 0) / totalSeries : 0;

    const highestRevenue = {
      name: result.highestRevenue[0].name,
      totalRevenue: result.highestRevenue[0].totalRevenue,
    };

    const bestEngagement = {
      name: result.bestEngagement[0].name,
      avgCompletion: result.bestEngagement[0].avgCompletion,
    };

    const mostViewed = {
      name: result.mostViewed[0].name,
      views: result.mostViewed[0].views,
    };

    return res.status(200).json({
      status: true,
      message: "Series overview analytics fetched successfully",
      data: {
        top: {
          highestRevenue: highestRevenue || null,
          bestEngagement: bestEngagement || null,
          mostViewed: mostViewed || null,
        },
        averages: {
          avgEpisodesPerSeries: totalSeries > 0 ? (totalEpisodes / totalSeries).toFixed(1) : 0,
          avgFreeEpisodes: totalSeries > 0 ? (totalFreeEpisodes / totalSeries).toFixed(1) : 0,
          avgCompletionRate: Number(avgCompletion.toFixed(1)),
          avgRevenuePerSeries: totalSeries > 0 ? (totalRevenue / totalSeries).toFixed(2) : 0,
        },
      },
    });
  } catch (error) {
    console.error("Series analytics error:", error);
    return res.status(500).json({ status: false, message: "Failed to fetch series analytics" });
  }
};

//series Analytics Table (Series Analytics)
exports.getSeriesAnalyticsTable = async (req, res) => {
  try {
    let { startDate, endDate, start = 1, limit = 10 } = req.query;

    start = Math.max(1, Number(start));
    limit = Math.min(100, Math.max(1, Number(limit)));
    const skip = (start - 1) * limit;

    const isAll = startDate?.toLowerCase() === "all" && endDate?.toLowerCase() === "all";

    let startD, endD;

    const historyDateMatch = {};
    const watchDateMatch = {};
    const uniqueDateMatch = {};

    if (!isAll) {
      startD = new Date(startDate);
      endD = new Date(endDate);

      startD.setHours(0, 0, 0, 0);
      endD.setHours(23, 59, 59, 999);

      historyDateMatch.createdAt = { $gte: startD, $lte: endD };
      watchDateMatch.watchedAt = { $gte: startD, $lte: endD };
      uniqueDateMatch.createdAt = { $gte: startD, $lte: endD };
    }

    const [[coinStats], [vipStats], totalUniqueVipUsers] = await Promise.all([
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
        ...uniqueDateMatch,
      }).then((arr) => arr.length),
    ]);

    const coinRate = coinStats?.totalCoins > 0 ? coinStats.totalMoney / coinStats.totalCoins : 0;
    const vipViewValue = vipStats?.vipPool > 0 && totalUniqueVipUsers > 0 ? vipStats.vipPool / totalUniqueVipUsers : 0;

    const data = await MovieSeries.aggregate([
      {
        $project: {
          name: 1,
          thumbnail: 1,
          createdAt: 1,
        },
      },
      {
        $lookup: {
          from: "shortvideos",
          let: { sid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$movieSeries", "$$sid"] } } },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                free: { $sum: { $cond: [{ $eq: ["$isLocked", false] }, 1, 0] } },
              },
            },
          ],
          as: "episodeStats",
        },
      },
      {
        $addFields: {
          episodes: { $ifNull: [{ $arrayElemAt: ["$episodeStats.total", 0] }, 0] },
          freeEpisodes: { $ifNull: [{ $arrayElemAt: ["$episodeStats.free", 0] }, 0] },
          paidEpisodes: {
            $subtract: [{ $ifNull: [{ $arrayElemAt: ["$episodeStats.total", 0] }, 0] }, { $ifNull: [{ $arrayElemAt: ["$episodeStats.free", 0] }, 0] }],
          },
        },
      },
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
          views: { $size: "$uniqueViews" },
          vipViews: {
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
          from: "watchhistories",
          let: { sid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$movieSeries", "$$sid"] },
                totalWatchTime: { $gt: 0 },
                ...watchDateMatch,
              },
            },
            {
              $lookup: {
                from: "shortvideos",
                localField: "videoId",
                foreignField: "_id",
                pipeline: [{ $project: { duration: 1 } }],
                as: "video",
              },
            },
            {
              $addFields: {
                videoDuration: {
                  $ifNull: [{ $arrayElemAt: ["$video.duration", 0] }, 0],
                },
              },
            },
            {
              $group: {
                _id: null,
                totalWatchTime: { $sum: "$totalWatchTime" },
                totalPossibleWatchTime: { $sum: "$videoDuration" },
              },
            },
          ],
          as: "watchStats",
        },
      },

      {
        $addFields: {
          avgCompletion: {
            $let: {
              vars: {
                w: { $arrayElemAt: ["$watchStats", 0] },
              },
              in: {
                $cond: [
                  { $gt: ["$$w.totalPossibleWatchTime", 0] },
                  {
                    $round: [
                      {
                        $multiply: [
                          {
                            $divide: ["$$w.totalWatchTime", "$$w.totalPossibleWatchTime"],
                          },
                          100,
                        ],
                      },
                      2,
                    ],
                  },
                  0,
                ],
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
            { $group: { _id: null, paidCoins: { $sum: "$purchasedCoinUsed" } } },
          ],
          as: "coinStats",
        },
      },
      {
        $addFields: {
          coinRevenue: {
            $round: [
              {
                $multiply: [{ $ifNull: [{ $arrayElemAt: ["$coinStats.paidCoins", 0] }, 0] }, coinRate],
              },
              2,
            ],
          },
        },
      },

      {
        $addFields: {
          vipRevenue: {
            $round: [{ $multiply: ["$vipViews", vipViewValue] }, 2],
          },
        },
      },

      {
        $addFields: {
          totalRevenue: {
            $round: [{ $add: ["$coinRevenue", "$vipRevenue"] }, 2],
          },
        },
      },
      {
        $project: {
          name: 1,
          thumbnail: 1,
          createdAt: 1,
          episodes: 1,
          freeEpisodes: 1,
          paidEpisodes: 1,
          views: 1,
          avgCompletion: 1,
          coinRevenue: 1,
          vipRevenue: 1,
          totalRevenue: 1,
        },
      },

      { $sort: { totalRevenue: -1 } },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const rows = data[0]?.data || [];
    const totalCount = data[0]?.totalCount[0]?.count || 0;

    return res.status(200).json({
      status: true,
      message: "Series monetization fetched",
      data: rows,
      pagination: {
        start,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Series monetization table error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch series monetization",
    });
  }
};

//get initial search suggestion
exports.getInitialSearchSuggestion = async (req, res) => {
  try {
    const { start = 1 } = req.query;
    const page = Number(start);

    if (page > 100) {
      return res.status(200).json({
        status: true,
        message: "No more data available.",
        data: [],
        hasMore: false,
      });
    }

    // You’re allowed 15 requests per 60 seconds
    const { data } = await axios.get(`https://api.sansekai.my.id/api/dramabox/foryou?page=${page}`, {
      httpsAgent: agent,
      timeout: 10000,
    });

    if (!data) {
      return res.status(200).json({
        status: false,
        message: "Initial search not found",
      });
    }

    const suggestions = data?.map((item) => ({
      bookId: item.bookId,
      bookName: item.bookName,
      image: item.coverWap,
      description: item.introduction,
    }));

    return res.status(200).json({
      status: true,
      message: "Search suggestion fetched",
      data: suggestions,
      hasMore: page < 100,
    });
  } catch (error) {
    console.error("Initial search suggestion error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch search suggestion",
    });
  }
};

//get searched suggestion
exports.getSearchedSuggestion = async (req, res) => {
  try {
    const { search } = req.query || {};

    if (!search) {
      return res.status(200).json({
        status: false,
        message: "Search is required",
      });
    }
    // You’re allowed 15 requests per 60 seconds
    const { data } = await axios.get(`https://api.sansekai.my.id/api/dramabox/search?query=${search}`, {
      httpsAgent: agent,
      timeout: 10000,
    });

    if (!data) {
      return res.status(200).json({
        status: false,
        message: "Searched movie not found",
      });
    }

    const suggestions = data?.map((item) => ({
      bookId: item.bookId,
      bookName: item.bookName,
      image: item.cover,
      description: item.introduction,
    }));

    return res.status(200).json({
      status: true,
      message: "Search suggestion fetched",
      data: suggestions,
    });
  } catch (error) {
    console.error("Searched suggestion error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch searched suggestion",
    });
  }
};

//get movie details by book Id
exports.getMovieDetails = async (req, res) => {
  try {
    const { bookId } = req.query || {};

    if (!bookId) {
      return res.status(200).json({
        status: false,
        message: "bookId is required",
      });
    }

    if (!/^\d+$/.test(bookId)) {
      return res.status(200).json({
        status: false,
        message: "Provide valid bookId",
      });
    }
    // You’re allowed 15 requests per 60 seconds
    const { data } = await axios.get(`https://api.sansekai.my.id/api/dramabox/detail?bookId=${bookId}`, {
      httpsAgent: agent,
      timeout: 10000,
    });

    if (!data) {
      return res.status(200).json({
        status: false,
        message: "Movie not found",
      });
    }

    const details = {
      bookId: data.bookId,
      name: data.bookName,
      description: data.introduction,
      thumbnail: data.coverWap,
      releaseDate: data.shelfTime,
    };

    return res.status(200).json({
      status: true,
      message: "Search suggestion fetched",
      data: details,
    });
  } catch (error) {
    console.error("Movie details by book Id error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch movie details by book Id",
    });
  }
};

//create movie series + all episodes
exports.createSeriesWithEpisodes = async (req, res) => {
  try {
    const { bookId, name, type, description, category, releaseDate, thumbnail, banner, maxAdsForFreeView, language } = req.body;

    if (!bookId || !name || !type || !description || !category || !thumbnail || !banner || !maxAdsForFreeView || !language) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(400).json({ status: false, message: "Missing required fields." });
    }

    if (!/^\d+$/.test(bookId)) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(200).json({
        status: false,
        message: "Provide valid bookId",
      });
    }

    if (type !== 1 && type !== 2) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(400).json({ status: false, message: "Invalid content type." });
    }

    if (!mongoose.Types.ObjectId.isValid(category)) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(400).json({ status: false, message: "Invalid category ID" });
    }

    if (!mongoose.Types.ObjectId.isValid(language)) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(400).json({ status: false, message: "Invalid language ID" });
    }

    const categoryId = new mongoose.Types.ObjectId(category);
    const languageId = new mongoose.Types.ObjectId(language);

    const [validCategory, validLanguage, existingSeries] = await Promise.all([
      Category.findById(categoryId).select("_id").lean(),
      Language.findById(languageId).select("_id").lean(),
      MovieSeries.exists({ bookId }),
    ]);

    if (!validCategory) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(400).json({ status: false, message: "Category not found." });
    }

    if (!validLanguage) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(400).json({ status: false, message: "Language not found." });
    }

    if (existingSeries) {
      await Promise.all([thumbnail && deleteFromStorage(thumbnail), banner && deleteFromStorage(banner)]);
      return res.status(400).json({ status: false, message: "This movie series already exists." });
    }

    const newSeries = new MovieSeries({
      language: languageId,
      name,
      description,
      thumbnail,
      banner,
      type,
      category,
      maxAdsForFreeView: maxAdsForFreeView || 0,
      releaseDate: releaseDate || Date.now(),
      bookId,
    });

    await newSeries.save();

    res.status(200).json({
      status: true,
      message: "Series and episodes created successfully",
      seriesId: newSeries._id,
    });

    processEpisodes(newSeries._id, bookId);
  } catch (error) {
    await Promise.all([req.body.thumbnail && deleteFromStorage(req.body.thumbnail), req.body.banner && deleteFromStorage(req.body.banner)]);

    console.error("Create series with episodes error:", error.message);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
};

async function processEpisodes(seriesId, bookId) {
  try {
    // You’re allowed 15 requests per 60 seconds
    const { data: episodesData } = await axios.get(`https://api.sansekai.my.id/api/dramabox/allepisode?bookId=${bookId}`, { timeout: 10000 });

    if (!Array.isArray(episodesData) || !episodesData.length) {
      console.log("No episodes found");
      return;
    }

    const freeLimit = settingJSON?.freeEpisodesForNonVip + 1 || 0;

    const limit = pLimit(4); // max 4 ffprobe at once

    const episodesToSave = await Promise.all(
      episodesData.map((ep) =>
        limit(async () => {
          const defaultCdn = (ep.cdnList || []).find((c) => c.isDefault === 1) || (ep.cdnList || [])[0];

          const videoObj = defaultCdn?.videoPathList?.find((v) => v.quality === 1080) || defaultCdn?.videoPathList?.find((v) => v.quality === 720);

          let duration = 0;

          if (videoObj?.videoPath) {
            duration = await getVideoDuration(videoObj.videoPath);
          }

          return {
            movieSeries: seriesId,
            episodeNumber: ep.chapterIndex,
            videoImage: ep.chapterImg,
            videoUrl: videoObj?.videoPath || "",
            duration,
            coin: ep.chapterIndex < freeLimit ? 0 : 10,
            isLocked: ep.chapterIndex >= freeLimit,
          };
        }),
      ),
    );

    await ShortVideo.insertMany(episodesToSave);

    console.log(`Inserted ${episodesToSave.length} episodes`);
  } catch (err) {
    console.error("Episode processing failed:", err.message);
  }
}
