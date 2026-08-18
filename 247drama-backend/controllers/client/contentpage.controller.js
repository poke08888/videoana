const ContentPage = require("../../models/contentPage.model");

exports.retrieveContentPages = async (req, res) => {
  try {
    const contentPages = await ContentPage.find().sort({ createdAt: -1 }).lean();

    return res.status(200).json({ status: true, data: contentPages });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};
