const Language = require("../../models/language.model");

// List languages
exports.getLanguageList = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const [total, list] = await Promise.all([
      Language.countDocuments(),
      Language.find()
        .sort({ createdAt: -1 })
        .skip((start - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      status: true,
      message: "Success",
      total,
      data: list,
    });
  } catch (err) {
    return res.status(500).json({ status: false, error: err.message });
  }
};
