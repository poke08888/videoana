const Category = require("../../models/category.model");

//mongoose
const mongoose = require("mongoose");

//import model
const MovieSeries = require("../../models/movieSeries.model");
const ShortVideo = require("../../models/shortVideo.model");
const History = require("../../models/history.model");
const UserVideoList = require("../../models/userVideoList.model");
const WatchHistory = require("../../models/watchHistory.model");

//generateCategoryUniqueId
const { generateCategoryUniqueId } = require("../../util/generateCategoryUniqueId");

//deleteFromStorage
const { deleteFromStorage } = require("../../util/storageHelper");

//create category
exports.createCategory = async (req, res) => {
  try {
    if (!req.body.name || !req.body.image) {
      if (req.body.image) {
        deleteFromStorage(req.body.image);
      }
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    const [existingCategory, uniqueId] = await Promise.all([Category.findOne({ name: req.body.name.trim() }).select("_id").lean(), generateCategoryUniqueId()]);

    if (!existingCategory) {
      const category = new Category({
        uniqueId: uniqueId,
        name: req.body.name.trim(),
        image: req.body.image.trim() || "",
      });
      await category.save();

      return res.status(200).json({
        status: true,
        message: "Category created successfully.",
        data: category,
      });
    } else {
      if (req.body.image) {
        deleteFromStorage(req.body.image);
      }
      return res.status(200).json({ status: false, message: "Category already exists." });
    }
  } catch (error) {
    if (req.body.image) {
      deleteFromStorage(req.body.image);
    }
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//update category
exports.updateCategory = async (req, res) => {
  try {
    if (!req.query.categoryId) {
      if (req.body.image) {
        deleteFromStorage(req.body.image);
      }
      return res.status(200).json({ status: false, message: "categoryId is required!" });
    }

    console.log("req.body: ", req?.body);

    const categoryId = new mongoose.Types.ObjectId(req.query.categoryId);

    const [category, alreadyExist] = await Promise.all([Category.findById(categoryId), req?.body?.name ? Category.findOne({ name: req?.body?.name.trim() }).select("_id").lean() : Promise.resolve()]);

    if (!category) {
      if (req.body.image) {
        deleteFromStorage(req.body.image);
      }
      return res.status(200).json({ status: false, message: "Category does not found!" });
    }

    if (!alreadyExist) {
      if (req.body.image && category.image) {
        deleteFromStorage(category.image);
      }

      category.name = req?.body?.name ? req?.body?.name?.trim() : category.name;
      category.image = req?.body?.image ? req?.body?.image?.trim() : category.image;
      await category.save();

      return res.status(200).json({
        status: true,
        message: "Success",
        data: category,
      });
    } else {
      if (req.body.image) {
        deleteFromStorage(req.body.image);
      }
      return res.status(200).json({ status: false, message: "Category already exists." });
    }
  } catch (error) {
    if (req.body.image) {
      deleteFromStorage(req.body.image);
    }
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//toggle active Status
exports.modifyActiveState = async (req, res) => {
  try {
    const { categoryId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(200).json({ status: false, message: "Invalid category ID." });
    }

    const category = await Category.findById(categoryId);

    if (!category) {
      return res.status(200).json({ status: false, message: "Category not found." });
    }

    category.isActive = !category.isActive;
    await category.save();

    return res.status(200).json({
      status: true,
      message: `Active status has been ${category.isActive ? "enabled" : "disabled"} successfully.`,
      data: category,
    });
  } catch (error) {
    console.error("Error toggling active status:", error);
    return res.status(500).json({ status: false, error: "Internal Server Error" });
  }
};

//get category
exports.fetchCategory = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const [totalCategory, categories] = await Promise.all([
      Category.countDocuments(),
      Category.aggregate([
        {
          $lookup: {
            from: "movieseries",
            localField: "_id",
            foreignField: "category",
            as: "movies",
          },
        },
        {
          $lookup: {
            from: "shortvideos",
            localField: "_id",
            foreignField: "category",
            as: "shortVideos",
          },
        },
        {
          $addFields: {
            totalMovies: { $size: "$movies" },
          },
        },
        {
          $project: {
            _id: 1,
            uniqueId: 1,
            name: 1,
            image: 1,
            isActive: 1,
            totalMovies: 1,
            createdAt: 1,
          },
        },
        {
          $sort: { totalMovies: -1 },
        },
        {
          $skip: (start - 1) * limit,
        },
        {
          $limit: limit,
        },
      ]),
    ]);

    return res.status(200).json({
      status: true,
      message: "Success",
      total: totalCategory,
      data: categories,
    });
  } catch (error) {
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//get category ( dropdown )
exports.getFilmCategoryOptions = async (req, res) => {
  try {
    let { search = "" } = req.query;
    search = search.trim();

    const filter = {
      isActive: true,
      ...(search && {
        name: { $regex: search, $options: "i" }, // case-insensitive search
      }),
    };

    const categories = await Category.find(filter).sort({ createdAt: -1 }).limit(10).lean();

    return res.status(200).json({
      status: true,
      message: "Success",
      data: categories,
    });
  } catch (error) {
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//delete category
exports.deleteCategory = async (req, res) => {
  try {
    if (!req.query.categoryId) {
      return res.status(200).json({ status: false, message: "categoryId must be required." });
    }

    const categoryId = new mongoose.Types.ObjectId(req.query.categoryId);

    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(200).json({ status: false, message: "Category does not found." });
    }

    res.status(200).json({
      status: true,
      message: "Category, associated movies/web series, and short videos deleted successfully.",
    });

    if (category.image) {
      deleteFromStorage(category.image);
    }

    const movieWebseries = await MovieSeries.find({ category: categoryId }).lean().select("_id thumbnail banner");

    if (movieWebseries) {
      const movieSeriesIds = movieWebseries.map((movie) => movie._id);
      const shortVideos = await ShortVideo.find({ movieSeries: { $in: movieSeriesIds } })
        .lean()
        .select("_id videoImage videoUrl");

      await Promise.all(
        shortVideos.map(async (shortVideo) => {
          await Promise.all([
            shortVideo.videoImage ? deleteFromStorage(shortVideo.videoImage) : null,
            shortVideo.videoUrl ? deleteFromStorage(shortVideo.videoUrl) : null,
            ShortVideo.deleteOne({ _id: shortVideo._id }),
          ]);
        }),
      );

      await Promise.all([
        ShortVideo.deleteMany({ movieSeries: { $in: movieSeriesIds } }),
        History.deleteMany({ movieSeries: { $in: movieSeriesIds } }),
        UserVideoList.deleteMany({ "videos.movieSeries": { $in: movieSeriesIds } }),
        WatchHistory.deleteMany({ movieSeries: { $in: movieSeriesIds } }),
      ]);

      await Promise.all(
        movieWebseries.map(async (movie) => {
          await Promise.all([movie.thumbnail ? deleteFromStorage(movie.thumbnail) : null, movie.banner ? deleteFromStorage(movie.banner) : null, MovieSeries.deleteOne({ _id: movie._id })]);
        }),
      );

      await MovieSeries.deleteMany({ _id: { $in: movieSeriesIds } });
    }

    await Category.deleteOne({ _id: categoryId });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};
