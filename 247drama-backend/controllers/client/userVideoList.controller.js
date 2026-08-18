const UserVideoList = require("../../models/userVideoList.model");

//import model
const User = require("../../models/user.model");
const MovieSeries = require("../../models/movieSeries.model");

//mongoose
const mongoose = require("mongoose");

//video added to own list Or remove from own list by user
exports.videoAddedToMyListByUser = async (req, res) => {
  try {
    const { userId, movieSeriesId } = req.query;

    if (!userId || !movieSeriesId) {
      return res.status(200).json({ status: false, message: "Invalid details." });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const movieSeriesObjectId = new mongoose.Types.ObjectId(movieSeriesId);

    const [user, movieSeries, existingList] = await Promise.all([
      User.findOne({ _id: userObjectId }).lean().select("_id isBlock name"),
      MovieSeries.findOne({ _id: movieSeriesObjectId }).lean().select("_id"),
      UserVideoList.findOne({
        userId: userObjectId,
        "videos.movieSeries": movieSeriesObjectId,
      }),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "User is blocked by admin." });
    }

    if (!movieSeries) {
      return res.status(200).json({ status: false, message: "MovieSeries not found." });
    }

    if (existingList) {
      console.log("If the MovieSeries is already in the list, remove it");

      await UserVideoList.findOneAndUpdate({ userId: user._id }, { $pull: { videos: { movieSeries: movieSeries._id } } }, { new: true });

      return res.status(200).json({
        status: true,
        message: "MovieSeries removed from your list.",
        isAddedToList: false,
      });
    } else {
      console.log("If the MovieSeries is not in the list, add it");

      await UserVideoList.findOneAndUpdate({ userId: user._id }, { $push: { videos: { movieSeries: movieSeries._id } } }, { new: true, upsert: true });

      return res.status(200).json({
        status: true,
        message: "MovieSeries added to your list successfully.",
        isAddedToList: true,
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//fetch videos which added own list
exports.getAllVideosAddedToMyListByUser = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(200).json({ status: false, message: "Invalid details." });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const [user, userVideoList] = await Promise.all([
      User.findOne({ _id: userObjectId }).lean().select("_id isBlock name").lean(),
      UserVideoList.findOne({ userId: userObjectId })
        .populate({
          path: "videos.movieSeries",
          select: "name thumbnail",
        })
        .lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "User is blocked by admin." });
    }

    return res.status(200).json({
      status: true,
      message: "Favorite MovieSeries retrieved successfully.",
      data: userVideoList?.videos || [],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};
