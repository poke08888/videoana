const MovieSeries = require("../../models/movieSeries.model");
const { seriesSearchOr } = require("../../util/searchMatch");
const { publishedMatch } = require("../../util/publishGate");

//import model
const Category = require("../../models/category.model");
const User = require("../../models/user.model");
const Language = require("../../models/language.model");
const WatchHistory = require("../../models/watchHistory.model");

//mongoose
const mongoose = require("mongoose");

//get movies or series (New Release) (home)
exports.fetchNewReleasesForUser = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details." });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);

    const [user, videos] = await Promise.all([
      User.findOne({ _id: userId }).select("isBlock").lean(),
      MovieSeries.aggregate([
        {
          $match: publishedMatch(),
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
          $project: {
            _id: 1,
            name: 1,
            i18n: 1,
            thumbnail: 1,
            languageName: { $ifNull: ["$languageObj.name", ""] },
            totalViews: {
              $size: "$watchHistories", // Total number of views for all videos in this movie series
            },
          },
        },
        { $sort: { releaseDate: -1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
      ]),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by the admin." });
    }

    return res.status(200).json({ status: true, message: "Retrieved new release data for the user.", videos: videos });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//contain categories with their respective movies or series (home)
exports.getMoviesGroupedByCategory = async (req, res) => {
  try {
    if (!req.query.userId) {
      return res.status(200).json({ status: false, message: "userId must be requried!" });
    }

    // const start = req.query.start ? parseInt(req.query.start) : 1;
    // const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const moviesStart = req.query.moviesStart ? parseInt(req.query.moviesStart) : 1;
    const moviesLimit = req.query.moviesLimit ? parseInt(req.query.moviesLimit) : 10;
    const userId = new mongoose.Types.ObjectId(req.query.userId);

    const [user, categoryIds] = await Promise.all([
      User.findOne({ _id: userId }).select("isBlock").lean(), //
      Category.find().limit(5).distinct("_id").lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by the admin." });
    }

    const groupedMovies = await MovieSeries.aggregate([
      {
        $match: { ...publishedMatch(), category: { $in: categoryIds } },
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
        $group: {
          _id: "$category",
          movies: {
            $push: {
              _id: "$_id",
              name: "$name",
              thumbnail: "$thumbnail",
              totalViews: { $size: "$watchHistories" }, // Count views for each movie
              languageName: { $ifNull: ["$languageObj.name", ""] },
            },
          },
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0, // Exclude ID
          categoryName: "$category.name",
          movies: {
            $slice: ["$movies", (moviesStart - 1) * moviesLimit, moviesLimit],
          },
        },
      },
      // { $skip: (start - 1) * limit },
      // { $limit: limit },
    ]);

    return res.status(200).json({
      status: true,
      message: "Movies grouped by category fetched successfully.",
      groupedMovies: groupedMovies,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//fetch all movies or web series that are trending (home)
exports.getTrendingMoviesSeries = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const [total, trendingItems] = await Promise.all([
      MovieSeries.countDocuments({ ...publishedMatch(), isTrending: true }),
      MovieSeries.find({ ...publishedMatch(), isTrending: true })
        .select("name thumbnail description language")
        .populate("category", "name")
        .populate("language", "name")
        .skip((start - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      status: true,
      message: "Trending movies or web series retrieved successfully.",
      total,
      data: trendingItems,
    });
  } catch (error) {
    console.error("Error fetching trending movies or web series:", error);
    return res.status(500).json({ status: false, error: "Internal Server Error" });
  }
};

//fetch movies or web series (home - banner is auto-animated) (client / web )
exports.fetchMoviesSeries = async (req, res) => {
  try {
    const movieSeries = await MovieSeries.find({ ...publishedMatch(), isAutoAnimateBanner: true }).select("thumbnail banner name language").populate("language", "name").lean();

    return res.status(200).json({
      status: true,
      message: "Movies or web series retrieved successfully.",
      data: movieSeries,
    });
  } catch (error) {
    console.error("Error fetching Movies or web series:", error);
    return res.status(500).json({ status: false, error: "Internal Server Error" });
  }
};

//search media content
exports.findContentBySearch = async (req, res) => {
  try {
    const { searchString, userId } = req.query;

    if (!searchString) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const searchQuery = searchString.trim() || "All";
    const matchStage = publishedMatch();

    if (searchQuery !== "All") {
      // Tìm theo mọi ngôn ngữ đã dịch, không chỉ tên tiếng Việt.
      matchStage.$or = seriesSearchOr(searchQuery);
    }

    const userQuery = userId ? User.findOne({ _id: userId }).select("isBlock") : Promise.resolve(null);

    const moviesQuery = MovieSeries.aggregate([
      {
        $match: matchStage,
      },
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
        $project: {
          name: 1,
          i18n: 1,
          description: 1,
          thumbnail: 1,
          isActive: 1,
          releaseDate: 1,
          categoryId: "$category._id",
          category: "$category.name",
          languageName: { $ifNull: ["$languageObj.name", ""] },
        },
      },
    ]);

    const [user, response] = await Promise.all([userQuery, moviesQuery]);

    if (userId) {
      if (!user) {
        return res.status(200).json({ status: false, message: "User does not found." });
      }

      if (user.isBlock) {
        return res.status(200).json({ status: false, message: "You are blocked by admin." });
      }
    }

    return res.status(200).json({ status: true, message: "Success", searchData: response });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get most trending movies or series (Ranking) (based on most viewd)
exports.fetchTrendingMoviesSeries = async (req, res) => {
  try {
    const { start = 1, limit = 10 } = req.query;

    const matchStage = {
      movieSeries: { $ne: null },
      // Bảng xếp hạng đi từ lịch sử xem nên vẫn lôi lên được cả phim đã tắt lẫn phim đang
      // render dở — phải lọc như mọi danh sách khác.
      ...publishedMatch("movie."),
    };

    const data = await WatchHistory.aggregate([
      {
        $lookup: {
          from: "movieseries",
          localField: "movieSeries",
          foreignField: "_id",
          as: "movie",
        },
      },
      { $unwind: "$movie" },
      {
        $lookup: {
          from: "categories",
          localField: "movie.category",
          foreignField: "_id",
          as: "categoryObj",
        },
      },
      { $unwind: { path: "$categoryObj", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "languages",
          localField: "movie.language",
          foreignField: "_id",
          as: "languageObj",
        },
      },
      { $unwind: { path: "$languageObj", preserveNullAndEmptyArrays: true } },

      { $match: matchStage },

      {
        $group: {
          _id: "$movieSeries",
          views: { $sum: 1 },
          // totalWatchTime: { $sum: "$totalWatchTime" },

          movie: { $first: "$movie" },
          category: { $first: "$categoryObj" },
          language: { $first: "$languageObj" },
        },
      },

      {
        $sort: {
          views: -1,
          // totalWatchTime: -1,
        },
      },
      {
        $project: {
          _id: 1,
          views: 1,
          totalWatchTime: 1,

          movie: {
            _id: "$movie._id",
            name: "$movie.name",
            i18n: "$movie.i18n",
            description: "$movie.description",
            thumbnail: "$movie.thumbnail",
            category: { $ifNull: ["$category.name", ""] },
            languageName: { $ifNull: ["$language.name", ""] },
          },
        },
      },
      {
        $facet: {
          pagination: [{ $skip: (start - 1) * Number(limit) }, { $limit: Number(limit) }],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "Trending movies & series fetched successfully.",
      total: data[0]?.totalCount[0]?.count || 0,
      trending: data[0]?.pagination || [],
    });
  } catch (error) {
    console.error("Trending API error:", error);
    return res.status(500).json({
      status: false,
      message: "Something went wrong while fetching trending data.",
      error: error.message,
    });
  }
};

//get filter wise movies or series
exports.getFilterContent = async (req, res) => {
  try {
    const { categories, languages, sortBy, userId, start = 1, limit = 20 } = req.query;

    const pageNumber = Number(start) || 1;
    const limitNumber = Number(limit) || 20;
    const skip = (pageNumber - 1) * limitNumber;

    let categoryIds = categories ? categories.split(",").map((id) => new mongoose.Types.ObjectId(id.trim())) : [];
    let languageIds = languages ? languages.split(",").map((id) => new mongoose.Types.ObjectId(id.trim())) : [];

    const tasks = [];

    const userValidation = userId ? User.findOne({ _id: userId }).select("isBlock") : Promise.resolve(null);
    tasks.push(userValidation);

    const categoryValidation = categories ? Category.find({ _id: { $in: categoryIds }, isActive: true }).select("_id") : Promise.resolve([]);
    tasks.push(categoryValidation);

    const languageValidation = languages ? Language.find({ _id: { $in: languageIds }, isActive: true }).select("_id") : Promise.resolve([]);
    tasks.push(languageValidation);

    const [user, validCategories, validLanguages] = await Promise.all(tasks);

    if (userId) {
      if (!user) {
        return res.status(200).json({ status: false, message: "User does not found." });
      }
      if (user.isBlock) {
        return res.status(200).json({ status: false, message: "You are blocked by admin." });
      }
    }

    if (categories && validCategories.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Invalid category selection.",
      });
    }

    if (languages && validLanguages.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Invalid language selection.",
      });
    }

    categoryIds = validCategories.map((c) => c._id);
    languageIds = validLanguages.map((l) => l._id);

    const matchStage = publishedMatch();
    if (categoryIds.length > 0) matchStage.category = { $in: categoryIds };
    if (languageIds.length > 0) matchStage.language = { $in: languageIds };

    let sortStage = { releaseDate: -1 };
    if (sortBy === "popular") sortStage = { isTrending: -1, releaseDate: -1 };

    const moviesQuery = MovieSeries.aggregate([
      { $match: matchStage },
      { $sort: sortStage },

      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limitNumber },

            {
              $lookup: {
                from: "categories",
                localField: "category",
                foreignField: "_id",
                as: "category",
              },
            },
            { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },

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
              $project: {
                name: 1,
                i18n: 1,
                description: 1,
                thumbnail: 1,
                banner: 1,
                type: 1,
                releaseDate: 1,
                isTrending: 1,
                categoryId: "$category._id",
                category: "$category.name",
                languageId: "$languageObj._id",
                languageName: { $ifNull: ["$languageObj.name", ""] },
              },
            },
          ],

          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const result = await moviesQuery;

    const items = result[0].data;
    const totalCount = result[0].totalCount[0]?.count || 0;

    return res.status(200).json({
      status: true,
      message: "Success",
      totalCount,
      filterData: items,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get movies or series (New Release) (home) (web)
exports.fetchLatestContentForUser = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    if (req.query.userId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.userId)) {
        return res.status(200).json({
          status: false,
          message: "Invalid userId format. It must be a valid ObjectId.",
        });
      }

      const userId = new mongoose.Types.ObjectId(req.query.userId);

      const [user, videos] = await Promise.all([
        User.findOne({ _id: userId }).select("_id isBlock").lean(),
        MovieSeries.aggregate([
          {
            $match: publishedMatch(),
          },
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
              from: "uservideolists",
              let: { movieSeriesId: "$_id" },
              pipeline: [
                {
                  $match: {
                    userId: userId,
                    $expr: {
                      $in: ["$$movieSeriesId", "$videos.movieSeries"],
                    },
                  },
                },
                {
                  $project: {
                    _id: 1,
                  },
                },
              ],
              as: "userVideoList",
            },
          },
          {
            $addFields: {
              isAddedToList: { $gt: [{ $size: "$userVideoList" }, 0] },
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

      return res.status(200).json({ status: true, message: "Retrieved the latest new releases.", videos });
    } else {
      const videos = await MovieSeries.aggregate([
        {
          $match: publishedMatch(),
        },
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
          $addFields: {
            isAddedToList: false,
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
            languageName: { $ifNull: ["$languageObj.name", ""] },
          },
        },
        { $sort: { releaseDate: -1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
      ]);

      return res.status(200).json({ status: true, message: "Retrieved the latest new releases.", videos });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//contain categories with their respective movies or series (home) (web)
exports.fetchMoviesGroupedByGenre = async (req, res) => {
  try {
    const moviesStart = req.query.moviesStart ? parseInt(req.query.moviesStart) : 1;
    const moviesLimit = req.query.moviesLimit ? parseInt(req.query.moviesLimit) : 10;
    const userId = req.query.userId ? new mongoose.Types.ObjectId(req.query.userId) : null;

    const [categoryIds, user] = await Promise.all([Category.find().limit(8).distinct("_id").lean(), userId ? User.findOne({ _id: userId }).select("isBlock").lean() : null]);

    if (userId) {
      if (!user) {
        return res.status(200).json({ status: false, message: "User not found." });
      }

      if (user.isBlock) {
        return res.status(200).json({ status: false, message: "You are blocked by the admin." });
      }
    }

    const groupedMovies = await MovieSeries.aggregate([
      { $match: { ...publishedMatch(), category: { $in: categoryIds } } },
      {
        $lookup: {
          from: "languages",
          localField: "language",
          foreignField: "_id",
          as: "languageObj",
        },
      },
      {
        $unwind: { path: "$languageObj", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "uservideolists",
          let: { movieId: "$_id" },
          pipeline: [{ $match: { userId: userId } }, { $unwind: "$videos" }, { $match: { $expr: { $eq: ["$videos.movieSeries", "$$movieId"] } } }, { $project: { _id: 1 } }],
          as: "userVideo",
        },
      },
      {
        $group: {
          _id: "$category",
          movies: {
            $push: {
              _id: "$_id",
              name: "$name",
              i18n: "$i18n",
              description: "$description",
              thumbnail: "$thumbnail",
              isAddedToList: { $gt: [{ $size: "$userVideo" }, 0] }, // true if movie exists in UserVideoList
              languageName: { $ifNull: ["$languageObj.name", ""] },
            },
          },
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: "$category" },
      {
        $project: {
          _id: 0,
          categoryName: "$category.name",
          movies: { $slice: ["$movies", (moviesStart - 1) * moviesLimit, moviesLimit] },
        },
      },
    ]);

    return res.status(200).json({
      status: true,
      message: "Movies grouped by category fetched successfully.",
      groupedMovies,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//fetch movies or web series (more recommended) (web)
exports.fetchMediaCollection = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const userId = req.query.userId ? new mongoose.Types.ObjectId(req.query.userId) : null;

    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(200).json({
        status: false,
        message: "Invalid userId format. It must be a valid ObjectId.",
      });
    }

    const userQuery = userId ? User.findOne({ _id: userId }).select("isBlock") : Promise.resolve(null);

    const moviesQuery = MovieSeries.aggregate([
      { $match: publishedMatch() },
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "languages",
          localField: "language",
          foreignField: "_id",
          as: "languageObj",
        },
      },
      {
        $unwind: { path: "$languageObj", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "watchhistories",
          localField: "_id",
          foreignField: "movieSeries",
          as: "watchData",
        },
      },
      {
        $addFields: {
          views: { $size: "$watchData" },
        },
      },
      ...(userId
        ? [
            {
              $lookup: {
                from: "uservideolists",
                let: { movieSeriesId: "$_id" },
                pipeline: [
                  { $match: { userId: userId } },
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
          ]
        : [
            {
              $set: {
                isAddedToList: false,
              },
            },
          ]),
      {
        $project: {
          _id: 1,
          releaseDate: 1,
          name: 1,
          i18n: 1,
          description: 1,
          thumbnail: 1,
          isAddedToList: 1,
          category: "$category.name",
          languageName: { $ifNull: ["$languageObj.name", ""] },
          views: 1,
        },
      },
      { $sort: { views: -1, isTrending: -1, releaseDate: -1 } }, // Sort first by views, then by isTrending, then by releaseDate
      { $skip: (start - 1) * limit },
      { $limit: limit },
    ]);

    const [user, videos] = await Promise.all([userQuery, moviesQuery]);

    if (userId) {
      if (!user) {
        return res.status(200).json({ status: false, message: "User not found." });
      }

      if (user.isBlock) {
        return res.status(200).json({ status: false, message: "You are blocked by the admin." });
      }
    }

    return res.status(200).json({
      status: true,
      message: "Here are some recommended videos for you!",
      videos,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal Server Error" });
  }
};

//search media content (web)
exports.getContentBySearch = async (req, res) => {
  try {
    const { searchString, userId } = req.query;

    if (!searchString) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details!" });
    }

    const searchQuery = searchString.trim() || "All";
    const matchStage = publishedMatch();

    if (searchQuery !== "All") {
      // Tìm theo mọi ngôn ngữ đã dịch, không chỉ tên tiếng Việt.
      matchStage.$or = seriesSearchOr(searchQuery);
    }

    if (userId) {
      if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(200).json({
          status: false,
          message: "Invalid userId format. It must be a valid ObjectId.",
        });
      }
    }

    const userQuery = userId ? User.findOne({ _id: userId }).select("isBlock") : Promise.resolve(null);

    const moviesQuery = MovieSeries.aggregate([
      {
        $match: matchStage,
      },
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
          from: "watchhistories",
          localField: "_id",
          foreignField: "movieSeries",
          as: "watchData",
        },
      },
      {
        $addFields: {
          views: { $size: "$watchData" },
        },
      },
      ...(userId
        ? [
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
          ]
        : [
            {
              $set: {
                isAddedToList: false,
              },
            },
          ]),
      {
        $project: {
          _id: 1,
          name: 1,
          i18n: 1,
          description: 1,
          thumbnail: 1,
          releaseDate: 1,
          category: "$category.name",
          languageName: { $ifNull: ["$languageObj.name", ""] },
          isAddedToList: 1,
          views: 1,
        },
      },
      { $sort: { views: -1, releaseDate: -1 } },
    ]);

    const [user, videos] = await Promise.all([userQuery, moviesQuery]);

    if (userId) {
      if (!user) {
        return res.status(200).json({ status: false, message: "User not found." });
      }

      if (user.isBlock) {
        return res.status(200).json({ status: false, message: "You are blocked by the admin." });
      }
    }

    return res.status(200).json({
      status: true,
      message: "Success",
      searchData: videos,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal Server Error" });
  }
};
