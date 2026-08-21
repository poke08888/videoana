const ShortVideo = require("../../models/shortVideo.model");

//mongoose
const mongoose = require("mongoose");

//import model
const User = require("../../models/user.model");
const LikeHistoryOfVideo = require("../../models/likeHistoryOfVideo.model");
const MovieSeries = require("../../models/movieSeries.model");
const { publishedMatch } = require("../../util/publishGate");
const History = require("../../models/history.model");
const UserVideoStatus = require("../../models/userVideoStatus.model");
const UserAutoUnlockStatus = require("../../models/userAutoUnlockStatus.model");

//generate History UniqueId
const { generateHistoryUniqueId } = require("../../util/generateHistoryUniqueId");

//resolve phụ đề mặc định theo IP (VN -> vi, còn lại -> en)
const { resolveSubLang } = require("../../util/geoLang");

//retrieves all videos from a specific movie series for a user
exports.retrieveMovieSeriesVideosForUser = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    if (!req.query.userId || !req.query.movieSeriesId) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details." });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const movieSeriesId = new mongoose.Types.ObjectId(req.query.movieSeriesId);

    const [user, totalVideosCount, videos, autoUnlockStatus] = await Promise.all([
      User.findOne({ _id: userId }).select("_id isBlock coin episodeUnlockAds").lean(),
      ShortVideo.countDocuments({ movieSeries: movieSeriesId }),
      ShortVideo.aggregate([
        {
          $match: {
            movieSeries: new mongoose.Types.ObjectId(movieSeriesId),
          },
        },
        // BẮT BUỘC: $group phía dưới đẩy tập vào mảng theo đúng thứ tự tài liệu đi vào, mà
        // thứ tự tự nhiên của Mongo là thứ tự GHI — worker render 4 tập song song nên tập
        // ghi xong trước nằm trước. Thiếu dòng này thì app hiện tập 3 trước tập 1.
        // Hai endpoint bản web đã sắp xếp sẵn, chỉ đường của app bị sót.
        { $sort: { episodeNumber: 1 } },
        {
          $lookup: {
            from: "movieseries",
            localField: "movieSeries",
            foreignField: "_id",
            as: "movieSeriesDetails",
          },
        },
        {
          $unwind: "$movieSeriesDetails",
        },
        {
          $match: {
            ...publishedMatch("movieSeriesDetails."),
          },
        },
        {
          $lookup: {
            from: "likehistoryofvideos",
            localField: "_id",
            foreignField: "videoId",
            as: "likes",
          },
        },
        {
          $lookup: {
            from: "uservideostatuses",
            let: { videoId: "$_id", userId: userId },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$shortVideoId", "$$videoId"] }, { $eq: ["$userId", "$$userId"] }],
                  },
                },
              },
            ],
            as: "userVideoStatus",
          },
        },
        {
          $lookup: {
            from: "uservideolists",
            let: { movieSeriesId: movieSeriesId },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: "$videos",
                            as: "video",
                            cond: {
                              $eq: ["$$video.movieSeries", "$$movieSeriesId"],
                            },
                          },
                        },
                      },
                      0,
                    ],
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  userId: 1,
                },
              },
            ],
            as: "allAddedUsers",
          },
        },
        {
          $lookup: {
            from: "uservideolists",
            let: { userId, movieSeriesId },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$userId", "$$userId"] }, { $in: ["$$movieSeriesId", "$videos.movieSeries"] }],
                  },
                },
              },
            ],
            as: "isAddedList",
          },
        },
        {
          $project: {
            _id: 1,
            episodeNumber: 1,
            videoImage: 1,
            videoUrl: 1,
            coin: 1,
            subTracks: 1,
            burnedLang: 1,
            isLocked: {
              $cond: {
                if: { $gt: [{ $size: "$userVideoStatus" }, 0] },
                then: { $arrayElemAt: ["$userVideoStatus.isLocked", 0] },
                else: "$isLocked",
              },
            },
            "movieSeriesDetails._id": 1,
            "movieSeriesDetails.name": 1,
            "movieSeriesDetails.description": 1,
            "movieSeriesDetails.thumbnail": 1,
            "movieSeriesDetails.maxAdsForFreeView": 1,
            isLike: { $in: [userId, "$likes.userId"] },
            totalLikes: { $size: "$likes" },
            isAddedList: {
              $cond: [{ $eq: [{ $size: "$isAddedList" }, 0] }, false, true],
            },
            totalAddedToList: {
              $size: "$allAddedUsers",
            },
          },
        },
        {
          $group: {
            _id: "$movieSeriesDetails._id",
            movieSeriesName: { $first: "$movieSeriesDetails.name" },
            movieSeriesDescription: { $first: "$movieSeriesDetails.description" },
            movieSeriesThumbnail: { $first: "$movieSeriesDetails.thumbnail" },
            movieSeriesMaxAdsForFreeView: { $first: "$movieSeriesDetails.maxAdsForFreeView" },
            isAddedList: { $first: "$isAddedList" },
            totalAddedToList: { $first: "$totalAddedToList" },
            videos: {
              $push: {
                _id: "$_id",
                episodeNumber: "$episodeNumber",
                videoImage: "$videoImage",
                videoUrl: "$videoUrl",
                isLocked: "$isLocked",
                coin: "$coin",
                subTracks: "$subTracks",
                burnedLang: "$burnedLang",
                isLike: "$isLike",
                totalLikes: "$totalLikes",
              },
            },
          },
        },
        { $sort: { _id: 1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
      ]),
      UserAutoUnlockStatus.findOne({ userId, movieSeries: movieSeriesId }).lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by admin." });
    }

    const episodeUnlockAds = user.episodeUnlockAds.find((ads) => ads?.movieWebseriesId?.toString() === movieSeriesId?.toString());

    const userInfo = {
      coin: user.coin || 0,
      episodeUnlockAds: episodeUnlockAds ? episodeUnlockAds.count : 0,
    };

    // Check if the auto-unlock is enabled for this user and movie series
    const isAutoUnlockEnabled = autoUnlockStatus ? autoUnlockStatus.isAutoUnlockEpisodes : false;

    const subDefault = resolveSubLang(req);

    return res.status(200).json({
      status: true,
      message: "Retrieved videos from a specific movie series for the user.",
      userInfo: userInfo,
      totalVideosCount: totalVideosCount,
      isAutoUnlockEnabled,
      subDefault,
      data: videos[0] || null,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//retrieve only trailer with total counts short videos grouped by their associated movie series (for you)
exports.getVideosGroupedByMovieSeries = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details." });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);

    const [user, groupedVideos] = await Promise.all([
      User.findOne({ _id: userId }).select("_id isBlock").lean(),
      ShortVideo.aggregate([
        {
          $lookup: {
            from: "movieseries",
            localField: "movieSeries",
            foreignField: "_id",
            as: "movieSeriesDetails",
          },
        },
        {
          $unwind: "$movieSeriesDetails",
        },
        {
          $match: {
            ...publishedMatch("movieSeriesDetails."),
          },
        },
        {
          $lookup: {
            from: "languages",
            localField: "movieSeriesDetails.language",
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
            from: "uservideostatuses",
            let: { videoId: "$_id", userId: userId },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$shortVideoId", "$$videoId"] }, { $eq: ["$userId", "$$userId"] }],
                  },
                },
              },
            ],
            as: "userVideoStatus",
          },
        },
        {
          $lookup: {
            from: "uservideolists",
            let: { movieSeriesId: "$movieSeriesDetails._id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: "$videos",
                            as: "video",
                            cond: {
                              $eq: ["$$video.movieSeries", "$$movieSeriesId"],
                            },
                          },
                        },
                      },
                      0,
                    ],
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  userId: 1,
                },
              },
            ],
            as: "allAddedUsers",
          },
        },
        {
          $lookup: {
            from: "uservideolists",
            let: { userId, movieSeriesId: "$movieSeriesDetails._id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$userId", "$$userId"] }, { $in: ["$$movieSeriesId", "$videos.movieSeries"] }],
                  },
                },
              },
            ],
            as: "isAddedList",
          },
        },
        {
          $lookup: {
            from: "likehistoryofvideos",
            localField: "_id",
            foreignField: "videoId",
            as: "likes",
          },
        },
        {
          $project: {
            _id: 1,
            episodeNumber: 1,
            videoImage: 1,
            videoUrl: 1,
            subTracks: 1,
            burnedLang: 1,
            isLocked: {
              $cond: {
                if: { $gt: [{ $size: "$userVideoStatus" }, 0] },
                then: { $arrayElemAt: ["$userVideoStatus.isLocked", 0] },
                else: "$isLocked",
              },
            },
            "movieSeriesDetails._id": 1,
            "movieSeriesDetails.name": 1,
            "movieSeriesDetails.description": 1,
            "movieSeriesDetails.thumbnail": 1,
            languageName: { $ifNull: ["$languageObj.name", ""] },
            isLike: { $in: [userId, "$likes.userId"] },
            totalLikes: { $size: "$likes" },
            isAddedList: {
              $cond: [{ $eq: [{ $size: "$isAddedList" }, 0] }, false, true],
            },
            totalAddedToList: {
              $size: "$allAddedUsers",
            },
          },
        },
        {
          $match: { episodeNumber: 0 },
        },
        {
          $group: {
            _id: "$movieSeriesDetails._id",
            movieSeriesName: { $first: "$movieSeriesDetails.name" },
            movieSeriesDescription: { $first: "$movieSeriesDetails.description" },
            movieSeriesThumbnail: { $first: "$movieSeriesDetails.thumbnail" },
            languageName: { $first: "$languageName" },
            isAddedList: { $first: "$isAddedList" },
            totalAddedToList: { $first: "$totalAddedToList" },
            videos: {
              $first: {
                _id: "$_id",
                episodeNumber: "$episodeNumber",
                videoImage: "$videoImage",
                videoUrl: "$videoUrl",
                isLocked: "$isLocked",
                subTracks: "$subTracks",
                burnedLang: "$burnedLang",
                isLike: "$isLike",
                totalLikes: "$totalLikes", // Include total likes in the videos field
              },
            },
            totalLockedVideos: {
              $sum: { $cond: [{ $eq: ["$isLocked", true] }, 1, 0] },
            },
          },
        },
        {
          $lookup: {
            from: "shortvideos",
            let: { movieSeriesId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$movieSeries", "$$movieSeriesId"],
                  },
                },
              },
              {
                $count: "totalCount",
              },
            ],
            as: "totalVideosInfo",
          },
        },
        {
          $project: {
            _id: 1,
            movieSeriesName: 1,
            movieSeriesDescription: 1,
            movieSeriesThumbnail: 1,
            languageName: 1,
            isAddedList: 1,
            totalAddedToList: 1,
            videos: 1,
            totalLockedVideos: 1,
            totalVideos: {
              $ifNull: [{ $arrayElemAt: ["$totalVideosInfo.totalCount", 0] }, 0],
            },
          },
        },
        { $sort: { _id: 1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
      ]),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by admin." });
    }

    const subDefault = resolveSubLang(req);

    return res.status(200).json({ status: true, message: "Retrieved grouped videos by movie series.", subDefault, data: groupedVideos });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//create like or dislike for video
exports.likeOrDislikeOfVideo = async (req, res) => {
  try {
    if (!req.query.userId || !req.query.videoId) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const videoId = new mongoose.Types.ObjectId(req.query.videoId);

    const [user, video, alreadylikedVideo] = await Promise.all([
      User.findOne({ _id: userId }).select("_id isBlock").lean(),
      ShortVideo.findById(videoId).select("_id").lean(),
      LikeHistoryOfVideo.findOne({
        userId: userId,
        videoId: videoId,
      }).lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "user does not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by the admin." });
    }

    if (!video) {
      return res.status(200).json({ status: false, message: "video does not found." });
    }

    if (alreadylikedVideo) {
      await LikeHistoryOfVideo.deleteOne({
        userId: user._id,
        videoId: video._id,
      });

      return res.status(200).json({
        status: true,
        message: "The Video was marked with a dislike by the user.",
        isLike: false,
      });
    } else {
      console.log("else");

      const likeHistory = new LikeHistoryOfVideo();
      likeHistory.userId = user._id;
      likeHistory.videoId = video._id;
      await likeHistory.save();

      return res.status(200).json({
        status: true,
        message: "The Video was marked with a like by the user.",
        isLike: true,
      });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//watch Ad for unlock video
exports.viewAdToUnlockVideo = async (req, res) => {
  try {
    const { userId, movieWebseriesId, shortVideoId } = req.query;

    if (!userId || !movieWebseriesId || !shortVideoId) {
      return res.status(200).json({ status: false, message: "Invalid request parameters. Please provide all required details." });
    }

    const [user, movieWebseries, shortVideo, userVideoStatus] = await Promise.all([
      User.findOne({ _id: userId }).select("_id isBlock episodeUnlockAds").lean(),
      MovieSeries.findById(movieWebseriesId).select("_id maxAdsForFreeView").lean(),
      ShortVideo.findById(shortVideoId).select("_id").lean(),
      UserVideoStatus.findOne({ userId, shortVideoId }).select("_id isLocked").lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found!" });
    }

    if (user.isBlock) {
      return res.status(403).json({ status: false, message: "Access denied. Your account has been blocked by the administrator." });
    }

    if (!movieWebseries) {
      return res.status(200).json({ status: false, message: "MovieSeries not found." });
    }

    if (!shortVideo) {
      return res.status(200).json({ status: false, message: "ShortVideo not found." });
    }

    if (userVideoStatus && !userVideoStatus.isLocked) {
      return res.status(200).json({ status: true, message: "Video is already unlocked for this user." });
    }

    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' format
    console.log("Today's date for viewAd To UnlockVideo: ", today);

    const movieAdData = user?.episodeUnlockAds?.find((ad) => ad?.movieWebseriesId?.toString() === movieWebseriesId.toString());

    if (movieAdData) {
      console.log("If today's date matches and ad limit reached");

      if (movieAdData.date !== null && new Date(movieAdData.date).toISOString().slice(0, 10) === today && movieAdData.count >= movieWebseries.maxAdsForFreeView) {
        return res.status(200).json({ status: false, message: "Daily ad viewing limit reached for this movie. Please try again tomorrow." });
      }
    }

    res.status(200).json({
      status: true,
      message: "Ad successfully watched. The content has been unlocked.",
    });

    await Promise.all([
      User.findOneAndUpdate(
        { _id: user._id, "episodeUnlockAds.movieWebseriesId": movieWebseriesId },
        {
          $inc: { "episodeUnlockAds.$.count": 1 },
          $set: { "episodeUnlockAds.$.date": today },
        },
        {
          upsert: false,
          new: true,
        },
      ).then(async (result) => {
        console.log("If no matching entry found, add a new one", result);

        if (!result) {
          await User.updateOne(
            { _id: user._id },
            {
              $push: {
                episodeUnlockAds: {
                  movieWebseriesId,
                  count: 1,
                  date: today,
                },
              },
            },
          );
        }
      }),
      userVideoStatus ? UserVideoStatus.updateOne({ _id: userVideoStatus._id }, { $set: { isLocked: false } }) : UserVideoStatus.create({ userId, shortVideoId, isLocked: false }),
    ]);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//deducting coins when a video is viewed
exports.deductCoinForVideoView = async (req, res) => {
  try {
    const { userId, shortVideoId } = req.query;

    if (!userId || !shortVideoId) {
      return res.status(200).json({
        status: false,
        message: "Invalid request parameters. Please provide all required details.",
      });
    }

    const [uniqueId, user, shortVideo, userVideoStatus] = await Promise.all([
      generateHistoryUniqueId(),
      User.findOne({ _id: userId }).select("_id isBlock coin purchasedCoin loginRewardCoin dailyRewardCoin adRewardCoin isVip").lean(),
      ShortVideo.findById(shortVideoId).select("_id coin movieSeries").lean(),
      UserVideoStatus.findOne({ userId, shortVideoId }).select("_id isLocked").lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found!" });
    }

    if (user.isBlock) {
      return res.status(403).json({ status: false, message: "Access denied. You are blocked by the admin." });
    }

    if (!shortVideo) {
      return res.status(200).json({ status: false, message: "ShortVideo not found." });
    }

    if (userVideoStatus && userVideoStatus.isLocked === false) {
      return res.status(200).json({ status: false, message: "Already unlocked" });
    }

    if (user.isVip) {
      return res.status(200).json({ status: false, message: "No coin deduction for VIP users" });
    }

    const videoCost = shortVideo.coin;

    if (videoCost <= 0) {
      await UserVideoStatus.updateOne({ userId, shortVideoId }, { $set: { isLocked: false } }, { upsert: true });
      return res.status(200).json({ status: true, message: "Free video unlocked" });
    }

    if (user.coin < videoCost) {
      return res.status(200).json({ status: false, message: "Insufficient coins" });
    }

    let remaining = videoCost;

    const adCoinUsed = Math.min(user.adRewardCoin || 0, remaining);
    remaining -= adCoinUsed;

    const dailyCoinUsed = Math.min(user.dailyRewardCoin || 0, remaining);
    remaining -= dailyCoinUsed;

    const loginCoinUsed = Math.min(user.loginRewardCoin || 0, remaining);
    remaining -= loginCoinUsed;

    const trackedRewardCoins = (user.adRewardCoin || 0) + (user.dailyRewardCoin || 0) + (user.loginRewardCoin || 0);
    const otherRewardCoin = Math.max(0, (user.rewardCoin || 0) - trackedRewardCoins);
    const otherRewardCoinUsed = Math.min(otherRewardCoin, remaining);
    remaining -= otherRewardCoinUsed;

    // Remaining will be deducted from purchasedCoin. 
    // However, admin may have added coins directly to `user.coin`.
    // So we just deduct from purchasedCoin, but don't fail if purchasedCoin goes negative,
    // as long as the user's total coin is sufficient (already checked).
    let purchasedCoinUsed = remaining;
    
    // To avoid negative purchasedCoin in DB (if we don't want negatives), we can just cap it:
    purchasedCoinUsed = Math.min(purchasedCoinUsed, user.purchasedCoin || 0);
    remaining -= purchasedCoinUsed;

    // If there's STILL remaining, it means the coins came from admin directly adding to `user.coin`.
    // We just subtract it from total coin, and don't track it in sub-buckets.
    const rewardCoinUsed = adCoinUsed + dailyCoinUsed + loginCoinUsed + otherRewardCoinUsed;

    const updatedUser = await User.findOneAndUpdate(
      {
        _id: userId,
        coin: { $gte: videoCost },
      },
      {
        $inc: {
          coin: -videoCost,
          rewardCoin: -rewardCoinUsed,
          purchasedCoin: -purchasedCoinUsed,

          adRewardCoin: -adCoinUsed,
          dailyRewardCoin: -dailyCoinUsed,
          loginRewardCoin: -loginCoinUsed,
        },
      },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(200).json({ status: false, message: "Deduction failed" });
    }

    await Promise.all([
      UserVideoStatus.updateOne({ userId, shortVideoId }, { $set: { isLocked: false } }, { upsert: true }),
      History.create({
        userId,
        videoId: shortVideoId,
        movieSeries: shortVideo.movieSeries,
        uniqueId,
        coin: videoCost,
        rewardCoinUsed,
        purchasedCoinUsed,
        adCoinUsed,
        dailyCoinUsed,
        loginCoinUsed,
        // referralCoinUsed,
        type: 6,
        date: new Date(),
      }),
    ]);

    return res.status(200).json({
      status: true,
      message: "Coins deducted & video unlocked",
      userCoin: updatedUser.coin,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal Server Error" });
  }
};

//episodes auto-unlock (particular movieSeries wise)
exports.unlockEpisodesAutomatically = async (req, res) => {
  try {
    const { userId, movieWebseriesId, shortVideoId, type } = req.query;

    if (!userId || !movieWebseriesId || !type || !shortVideoId) {
      return res.status(200).json({ status: false, message: "Invalid request parameters. Please provide all required details." });
    }

    const [uniqueId, user, movieWebseries, shortVideo] = await Promise.all([
      generateHistoryUniqueId(),
      User.findOne({ _id: userId }),
      MovieSeries.findById(movieWebseriesId),
      ShortVideo.findById(shortVideoId).select("_id coin movieSeries").lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found!" });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by the admin." });
    }

    if (!shortVideo) {
      return res.status(200).json({ status: false, message: "ShortVideo not found." });
    }

    if (user.coin < shortVideo.coin) {
      return res.status(200).json({ status: false, message: "Insufficient coins to unlock this video." });
    }

    if (!movieWebseries) {
      return res.status(200).json({ status: false, message: "MovieSeries does not found." });
    }

    // Check if the user already has an auto-unlock record for this movie series
    let userAutoUnlockStatus = await UserAutoUnlockStatus.findOne({ userId, movieSeries: movieWebseriesId });

    if (type === "true") {
      // Create or update the user auto-unlock status
      if (!userAutoUnlockStatus) {
        userAutoUnlockStatus = new UserAutoUnlockStatus({
          userId,
          movieSeries: movieWebseriesId,
          isAutoUnlockEpisodes: true,
        });
      } else {
        userAutoUnlockStatus.isAutoUnlockEpisodes = true;
      }

      await userAutoUnlockStatus.save();

      res.status(200).json({ status: true, message: "Episodes successfully auto-unlocked, and history recorded." });

      await History({
        userId: user._id,
        movieSeries: movieWebseries,
        uniqueId: uniqueId,
        type: 7,
        coin: shortVideo.coin,
        date: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
      }).save();
    } else if (type === "false") {
      // Remove or update the user auto-unlock status to false
      if (userAutoUnlockStatus) {
        UserAutoUnlockStatus.deleteOne({
          _id: userAutoUnlockStatus._id,
        });
      }

      res.status(200).json({ status: true, message: "Episodes successfully auto-unlocked." });

      await History.deleteOne({
        userId: user._id,
        movieSeries: movieWebseries,
        type: 7,
      });
    } else {
      return res.status(200).json({ status: false, message: "Type must be passed valid for auto unlock." });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//retrieves all videos from a specific movie series for a user (web)
exports.loadMovieSeriesVideosForUser = async (req, res) => {
  try {
    if (!req.query.movieSeriesId) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details." });
    }

    if (!mongoose.Types.ObjectId.isValid(req.query.movieSeriesId)) {
      return res.status(200).json({
        status: false,
        message: "Invalid movieSeriesId format. It must be a valid ObjectId.",
      });
    }

    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    const movieSeriesId = new mongoose.Types.ObjectId(req.query.movieSeriesId);
    const subDefault = resolveSubLang(req);

    if (req.query.userId) {
      const userId = new mongoose.Types.ObjectId(req.query.userId);

      const [user, totalVideosCount, videos] = await Promise.all([
        User.findOne({ _id: userId }).select("_id isBlock coin episodeUnlockAds").lean(),
        ShortVideo.countDocuments({ movieSeries: movieSeriesId }),
        ShortVideo.aggregate([
          {
            $match: {
              movieSeries: new mongoose.Types.ObjectId(movieSeriesId),
            },
          },
          { $sort: { episodeNumber: 1 } },
          {
            $lookup: {
              from: "movieseries",
              localField: "movieSeries",
              foreignField: "_id",
              as: "movieSeriesDetails",
            },
          },
          {
            $unwind: "$movieSeriesDetails",
          },
          {
            $lookup: {
              from: "languages",
              localField: "movieSeriesDetails.language",
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
            $match: {
              ...publishedMatch("movieSeriesDetails."),
            },
          },
          {
            $lookup: {
              from: "likehistoryofvideos",
              localField: "_id",
              foreignField: "videoId",
              as: "likes",
            },
          },
          {
            $lookup: {
              from: "uservideostatuses",
              let: { videoId: "$_id", userId: userId },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [{ $eq: ["$shortVideoId", "$$videoId"] }, { $eq: ["$userId", "$$userId"] }],
                    },
                  },
                },
              ],
              as: "userVideoStatus",
            },
          },
          {
            $lookup: {
              from: "uservideolists",
              let: { userId, movieSeriesId },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [{ $eq: ["$userId", "$$userId"] }, { $in: ["$$movieSeriesId", "$videos.movieSeries"] }],
                    },
                  },
                },
              ],
              as: "isAddedList",
            },
          },
          {
            $project: {
              _id: 1,
              title: 1,
              description: 1,
              episodeNumber: 1,
              videoImage: 1,
              videoUrl: 1,
              subTracks: 1,
              burnedLang: 1,
              isLocked: {
                $cond: {
                  if: { $gt: [{ $size: "$userVideoStatus" }, 0] },
                  then: { $arrayElemAt: ["$userVideoStatus.isLocked", 0] },
                  else: "$isLocked",
                },
              },
              coin: 1,
              "movieSeriesDetails._id": 1,
              "movieSeriesDetails.name": 1,
              "movieSeriesDetails.description": 1,
              "movieSeriesDetails.thumbnail": 1,
              "movieSeriesDetails.maxAdsForFreeView": 1,
              languageName: { $ifNull: ["$languageObj.name", ""] },
              isLike: { $in: [userId, "$likes.userId"] },
              totalLikes: { $size: "$likes" },
              isAddedList: {
                $cond: [{ $eq: [{ $size: "$isAddedList" }, 0] }, false, true],
              },
              totalAddedToList: {
                $size: {
                  $filter: {
                    input: "$isAddedList",
                    as: "addedList",
                    cond: { $eq: ["$$addedList.userId", userId] },
                  },
                },
              },
            },
          },
          {
            $group: {
              _id: "$movieSeriesDetails._id",
              movieSeriesName: { $first: "$movieSeriesDetails.name" },
              movieSeriesDescription: { $first: "$movieSeriesDetails.description" },
              movieSeriesThumbnail: { $first: "$movieSeriesDetails.thumbnail" },
              movieSeriesMaxAdsForFreeView: { $first: "$movieSeriesDetails.maxAdsForFreeView" },
              languageName: { $first: "$languageName" },
              isAddedList: { $first: "$isAddedList" },
              totalAddedToList: { $first: "$totalAddedToList" },
              videos: {
                $push: {
                  _id: "$_id",
                  episodeNumber: "$episodeNumber",
                  videoImage: "$videoImage",
                  videoUrl: "$videoUrl",
                  isLocked: "$isLocked",
                  coin: "$coin",
                  subTracks: "$subTracks",
                  burnedLang: "$burnedLang",
                  isLike: "$isLike",
                  totalLikes: "$totalLikes",
                },
              },
            },
          },
          { $sort: { _id: 1 } },
          { $skip: (start - 1) * limit },
          { $limit: limit },
        ]),
      ]);

      if (!user) {
        return res.status(200).json({ status: false, message: "User not found." });
      }

      if (user.isBlock) {
        return res.status(200).json({ status: false, message: "You are blocked by admin." });
      }

      const episodeUnlockAds = user.episodeUnlockAds.find((ads) => ads?.movieWebseriesId?.toString() === movieSeriesId?.toString());

      const userInfo = {
        coin: user.coin || 0,
        episodeUnlockAds: episodeUnlockAds ? episodeUnlockAds.count : 0,
      };

      return res.status(200).json({
        status: true,
        message: "Retrieved videos from a specific movie series for the user.",
        userInfo: userInfo,
        totalVideosCount: totalVideosCount || 0,
        subDefault,
        data: videos[0] || null,
      });
    } else {
      const [totalVideosCount, videos] = await Promise.all([
        ShortVideo.countDocuments({ movieSeries: movieSeriesId }),
        ShortVideo.aggregate([
          {
            $match: {
              movieSeries: new mongoose.Types.ObjectId(movieSeriesId),
            },
          },
          { $sort: { episodeNumber: 1 } },
          {
            $lookup: {
              from: "movieseries",
              localField: "movieSeries",
              foreignField: "_id",
              as: "movieSeriesDetails",
            },
          },
          {
            $unwind: "$movieSeriesDetails",
          },
          {
            $match: {
              ...publishedMatch("movieSeriesDetails."),
            },
          },
          {
            $lookup: {
              from: "languages",
              localField: "movieSeriesDetails.language",
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
              from: "likehistoryofvideos",
              localField: "_id",
              foreignField: "videoId",
              as: "likes",
            },
          },
          {
            $project: {
              _id: 1,
              title: 1,
              description: 1,
              episodeNumber: 1,
              videoImage: 1,
              videoUrl: 1,
              subTracks: 1,
              burnedLang: 1,
              isLocked: 1,
              coin: 1,
              "movieSeriesDetails._id": 1,
              "movieSeriesDetails.name": 1,
              "movieSeriesDetails.description": 1,
              "movieSeriesDetails.thumbnail": 1,
              "movieSeriesDetails.maxAdsForFreeView": 1,
              languageName: { $ifNull: ["$languageObj.name", ""] },
              totalLikes: { $size: "$likes" },
            },
          },
          {
            $group: {
              _id: "$movieSeriesDetails._id",
              movieSeriesName: { $first: "$movieSeriesDetails.name" },
              movieSeriesDescription: { $first: "$movieSeriesDetails.description" },
              movieSeriesThumbnail: { $first: "$movieSeriesDetails.thumbnail" },
              movieSeriesMaxAdsForFreeView: { $first: "$movieSeriesDetails.maxAdsForFreeView" },
              languageName: { $first: "$languageName" },
              videos: {
                $push: {
                  _id: "$_id",
                  episodeNumber: "$episodeNumber",
                  videoImage: "$videoImage",
                  videoUrl: "$videoUrl",
                  isLocked: "$isLocked",
                  coin: "$coin",
                  subTracks: "$subTracks",
                  burnedLang: "$burnedLang",
                  isLike: "$isLike",
                  totalLikes: "$totalLikes",
                },
              },
            },
          },
          { $sort: { _id: 1 } },
          { $skip: (start - 1) * limit },
          { $limit: limit },
        ]),
      ]);

      return res.status(200).json({
        status: true,
        message: "Retrieved videos from a specific movie series for the user.",
        subDefault,
        totalVideosCount: totalVideosCount || 0,
        data: videos[0] || null,
      });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};
