const Translation = require("../../models/translation.model");
const Language = require("../../models/languageForTranslation.model");

const { getLatestVersion } = require("../../util/versionUtils");

// get single Language's translations
exports.find = async (req, res) => {
  try {
    const languageCode = req.query.languageCode?.trim()?.toLowerCase();
    const module = req.query.module?.trim()?.toLowerCase();

    if (!languageCode || !languageCode.trim()) {
      return res.status(200).json({ status: false, message: "Please provide desired language" });
    }

    if (!module || !module.trim() || !["app", "web"].includes(module)) {
      return res.status(200).json({ status: false, message: "Invalid module, please provide valid module(app/web)" });
    }

    const doc = await Translation.findOne({ languageCode, module }).lean();

    if (!doc) {
      return res.status(200).json({ status: false, message: "Language not found or in-active" });
    }

    return res.status(200).json({ status: true, message: "Language fetched", doc, version: `${doc.version.major}.${doc.version.minor}.${doc.version.patch}` });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// get all Languages and their translations
exports.findAll = async (req, res) => {
  try {
    const start = Math.max(1, parseInt(req.query?.start) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query?.limit) || 10));
    const module = req.query.module?.trim()?.toLowerCase();

    if (!module || !module.trim() || !["app", "web"].includes(module)) {
      return res.status(200).json({ status: false, message: "Invalid module, please provide valid module(app/web)" });
    }

    const skip = (start - 1) * limit;
    const [docs, total] = await Promise.all([Translation.find({ module }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Translation.countDocuments({ module })]);

    if (!docs) {
      return res.status(200).json({ status: false, message: "No languages found" });
    }

    return res.status(200).json({ status: true, message: "Languages fetched", docs, total });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// get latest version of global Language system
exports.latestVersion = async (req, res) => {
  try {
    const version = await getLatestVersion();
    return res.status(200).json({ status: true, message: "Version fetched", data: version });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// get all active Languages
exports.findActive = async (req, res) => {
  try {
    const start = Math.max(1, parseInt(req.query?.start) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query?.limit) || 10));
    const skip = (start - 1) * limit;

    const [result] = await Language.aggregate([
      { $match: { isActive: true } },

      {
        $facet: {
          docs: [{ $sort: { isDefault: -1, createdAt: -1 } }, { $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const docs = result?.docs || [];
    const total = result?.totalCount?.[0]?.count || 0;

    if (!docs.length) {
      return res.status(200).json({
        status: false,
        message: "No languages found",
      });
    }

    return res.status(200).json({
      status: true,
      message: "All active languages fetched",
      docs,
      total,
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};
