const SearchHistory = require("../../models/searchHistory.model");
const MovieSeries = require("../../models/movieSeries.model");
const { seriesSearchOr } = require("../../util/searchMatch");
const SearchCount = require("../../models/searchCount.model");

//Entry for the SearchHistory + SearchCount
exports.searchMovieSeries = async (req, res) => {
  try {
    const { query, userId, movieSeriesId } = req.query;
    if (!query || !userId) {
      return res.status(400).json({
        status: false,
        message: "Missing required query or userId",
      });
    }

    // Khớp theo mọi ngôn ngữ đã dịch, không chỉ tên tiếng Việt, để lịch sử tìm kiếm của
    // người xem nước ngoài cũng được ghi nhận.
    const movie = await MovieSeries.findOne({
      _id: movieSeriesId,
      $or: seriesSearchOr(query),
      isActive: true,
    }).lean();

    if (movie) {
      await Promise.all([
        SearchHistory.create({
          userId,
          movieSeriesId: movie._id,
          keyword: query,
        }),
        SearchCount.findOneAndUpdate({ movieSeriesId: movie._id }, { $inc: { count: 1 }, $set: { lastSearchedAt: new Date() } }, { upsert: true, new: true }),
      ]);
    }

    return res.status(200).json({
      status: true,
      message: "Search completed",
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};

//Get Most Searched (Top Trending)
exports.getMostSearched = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;

    const [total, list] = await Promise.all([
      SearchCount.countDocuments(),
      SearchCount.find()
        .select("movieSeriesId count lastSearchedAt")
        .populate("movieSeriesId", "name")
        .sort({ count: -1, lastSearchedAt: -1 })
        .skip((start - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      status: true,
      message: "Most searched movies/series fetched",
      total,
      data: list,
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};
