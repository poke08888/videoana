const MarketingTracking = require("../../models/marketingTracking.model");

exports.getMarketingStats = async (req, res) => {
  try {
    const { start, limit, startDate, endDate } = req.query;
    
    let query = {};
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    }

    const total = await MarketingTracking.countDocuments(query);
    const data = await MarketingTracking.find(query)
      .sort({ date: -1 })
      .skip(start ? parseInt(start) : 0)
      .limit(limit ? parseInt(limit) : 20);

    return res.status(200).json({
      status: true,
      message: "Data fetched successfully",
      total,
      data
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: error.message });
  }
};
