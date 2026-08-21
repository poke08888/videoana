const Category = require("../../models/category.model");

//import model
const MovieSeries = require("../../models/movieSeries.model");
const { publishedMatch } = require("../../util/publishGate");
const User = require("../../models/user.model");

//mongoose
const mongoose = require("mongoose");

//get category
exports.listCategory = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const search = req.query.search?.trim() || null;

    const query = { isActive: true };
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const [total, categories] = await Promise.all([
      Category.countDocuments(query),
      Category.find(query)
        .select("name image")
        .sort({ createdAt: -1 })
        .skip((start - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      status: true,
      message: "Success",
      total,
      data: categories,
    });
  } catch (error) {
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//get category wise movies or series
exports.fetchGenreBasedMediaContent = async (req, res) => {
  try {
    const { categoryId, userId } = req.query;

    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    const parsedPage = parseInt(start);
    const parsedLimit = parseInt(limit);

    if (isNaN(parsedPage) || parsedPage <= 0 || isNaN(parsedLimit) || parsedLimit <= 0) {
      return res.status(200).json({
        status: false,
        message: "'start' and 'limit' must be valid positive integers.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(200).json({
        status: false,
        message: "Invalid categoryId format. It must be a valid ObjectId.",
      });
    }

    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(200).json({
          status: false,
          message: "Invalid userId format. It must be a valid ObjectId.",
        });
      }

      const userObjId = new mongoose.Types.ObjectId(userId);

      const [user, category, videos] = await Promise.all([
        User.findOne({ _id: userObjId }).select("isBlock").lean(),
        Category.exists({ _id: new mongoose.Types.ObjectId(categoryId), isActive: true }).lean(),
        MovieSeries.aggregate([
          {
            $match: {
              ...publishedMatch(),
              category: new mongoose.Types.ObjectId(categoryId),
            },
          },
          {
            $lookup: {
              from: "watchhistories",
              localField: "_id",
              foreignField: "movieSeries",
              as: "watchHistories",
            },
          },
          {
            $lookup: {
              from: "languages",
              localField: "language",
              foreignField: "_id",
              as: "languageObj",
            },
          },
          { $unwind: { path: "$languageObj", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "uservideolists",
              let: { movieSeriesId: "$_id" },
              pipeline: [
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                  $project: {
                    isAddedToList: {
                      $in: ["$$movieSeriesId", "$videos.movieSeries"],
                    },
                  },
                },
              ],
              as: "userVideoList",
            },
          },
          {
            $set: {
              isAddedToList: {
                $cond: {
                  if: { $gt: [{ $size: "$userVideoList" }, 0] },
                  then: { $arrayElemAt: ["$userVideoList.isAddedToList", 0] },
                  else: false,
                },
              },
            },
          },
          { $unset: "userVideoList" },
          {
            $project: {
              _id: 1,
              releaseDate: 1,
              name: 1,
              i18n: 1,
              description: 1,
              thumbnail: 1,
              totalViews: { $size: "$watchHistories" }, // Total number of views for all videos in this movie series
              isAddedToList: 1,
              languageName: { $ifNull: ["$languageObj.name", ""] },
            },
          },
          { $sort: { releaseDate: -1 } },
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

      if (!category) {
        return res.status(200).json({ status: false, message: "Category not found." });
      }

      return res.status(200).json({ status: true, message: "Retrieved genre-based media successfully.", videos });
    } else {
      const [category, videos] = await Promise.all([
        Category.exists({ _id: new mongoose.Types.ObjectId(categoryId), isActive: true }).lean(),
        MovieSeries.aggregate([
          {
            $match: {
              ...publishedMatch(),
              category: new mongoose.Types.ObjectId(categoryId),
            },
          },
          {
            $lookup: {
              from: "languages",
              localField: "language",
              foreignField: "_id",
              as: "languageObj",
            },
          },
          { $unwind: { path: "$languageObj", preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              isAddedToList: false,
              totalViews: 0,
            },
          },
          {
            $project: {
              _id: 1,
              releaseDate: 1,
              name: 1,
              i18n: 1,
              description: 1,
              thumbnail: 1,
              isAddedToList: 1,
              totalViews: 1,
              languageName: { $ifNull: ["$languageObj.name", ""] },
            },
          },
          { $sort: { releaseDate: -1 } },
          { $skip: (start - 1) * limit },
          { $limit: limit },
        ]),
      ]);

      if (!category) {
        return res.status(200).json({ status: false, message: "Category not found." });
      }

      return res.status(200).json({ status: true, message: "Retrieved genre-based media successfully.", videos });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};
