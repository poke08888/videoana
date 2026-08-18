const WatchHistory = require("../../models/watchHistory.model");

//import model
const User = require("../../models/user.model");
const ShortVideo = require("../../models/shortVideo.model");
const VideoUniqueView = require("../../models/videoUniqueView.model");

//creating and potentially updating watch history records of the particular video (view the shortvideo)
exports.handleWatchHistoryCreation = async (req, res) => {
  try {
    const { userId, videoId, currentWatchTime } = req.query || {};

    if (!userId || !videoId || !currentWatchTime) {
      return res.status(200).json({ status: false, message: "Invalid details provided." });
    }

    const watchTimeInSeconds = Math.max(0, Math.round(Number(currentWatchTime) || 0));
    // console.log("Watch time in seconds:", watchTimeInSeconds);

    const [user, shortVideo] = await Promise.all([User.findById(userId).select("_id isVip isBlock").lean(), ShortVideo.findById(videoId).select("_id duration movieSeries").lean()]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "You are blocked by the admin." });
    }

    if (!shortVideo) {
      return res.status(200).json({ status: false, message: "Video not found." });
    }

    const accessModeUsed = user.isVip ? "VIP" : "COIN";

    res.status(200).json({
      status: true,
      message: "Watch recorded successfully",
    });

    await WatchHistory.create({
      userId,
      videoId,
      movieSeries: shortVideo.movieSeries,
      totalWatchTime: watchTimeInSeconds,
      videoDuration: shortVideo.duration,
      accessModeUsed,
      watchedAt: Date.now(),
    });

    try {
      await VideoUniqueView.create({
        movieSeriesId: shortVideo.movieSeries,
        userId,
        videoId,
        accessMode: accessModeUsed,
      });
    } catch (e) {
      if (e.code === 11000) {
        console.log("Unique view already exists for this user and video.");
      } else {
        console.error("Error creating unique view:", e);
      }
    }
  } catch (error) {
    console.error("Error in handleWatchHistoryCreation:", error);
    return res.status(500).json({ status: false, message: "Internal Server Error" });
  }
};
