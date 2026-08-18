const mongoose = require("mongoose");
const Language = require("../../models/language.model");

// Create language
exports.addLanguage = async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(200).json({ status: false, message: "Name is required." });
    }

    const exists = await Language.findOne({ name: name.trim() }).lean();
    if (exists) {
      return res.status(200).json({ status: false, message: "Already exists." });
    }

    const created = await Language.create({ name: name.trim() });

    return res.status(200).json({
      status: true,
      message: "Created successfully.",
      data: created,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ status: false, error: err.message });
  }
};

// Update language
exports.editLanguage = async (req, res) => {
  try {
    const { languageId, name } = req.query;

    if (!languageId) {
      return res.status(200).json({ status: false, message: "languageId is required." });
    }

    if (!name) {
      return res.status(200).json({ status: false, message: "Name is required." });
    }

    const [lang, exists] = await Promise.all([Language.findById(languageId), Language.findOne({ name: name.trim() }).lean()]);

    if (!lang) {
      return res.status(200).json({ status: false, message: "Not found." });
    }

    if (exists && String(exists._id) !== String(languageId)) {
      return res.status(200).json({ status: false, message: "Already exists." });
    }

    lang.name = name.trim();
    await lang.save();

    return res.status(200).json({
      status: true,
      message: "Updated successfully.",
      data: lang,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ status: false, error: err.message });
  }
};

// Toggle isActive language
exports.toggleLanguageStatus = async (req, res) => {
  try {
    const { languageId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(languageId)) {
      return res.status(200).json({ status: false, message: "Invalid ID." });
    }

    const lang = await Language.findById(languageId);
    if (!lang) {
      return res.status(200).json({ status: false, message: "Not found." });
    }

    lang.isActive = !lang.isActive;
    await lang.save();

    return res.status(200).json({
      status: true,
      message: `Status changed successfully.`,
      data: lang,
    });
  } catch (err) {
    return res.status(500).json({ status: false, error: err.message });
  }
};

// List languages
exports.listLanguages = async (req, res) => {
  try {
    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const search = req.query.search?.trim() || null;

    const query = {};
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const [total, list] = await Promise.all([
      Language.countDocuments(query),
      Language.find(query)
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

// Delete language
exports.removeLanguage = async (req, res) => {
  try {
    const { languageId } = req.query;

    if (!languageId) {
      return res.status(200).json({ status: false, message: "languageId is required." });
    }

    const lang = await Language.findById(languageId);
    if (!lang) {
      return res.status(200).json({ status: false, message: "Not found." });
    }

    await Language.deleteOne({ _id: languageId });

    return res.status(200).json({
      status: true,
      message: "Deleted successfully.",
    });
  } catch (err) {
    return res.status(500).json({ status: false, error: err.message });
  }
};

// Get language (dropdown)
exports.getLanguageOptions = async (req, res) => {
  try {
    let { search = "" } = req.query;
    search = search.trim();

    const filter = {
      ...(search && {
        name: { $regex: search, $options: "i" },
      }),
    };

    const languages = await Language.find(filter).sort({ createdAt: -1 }).limit(10).lean();

    return res.status(200).json({
      status: true,
      message: "Success",
      data: languages,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      error: error.message || "Internal Server error",
    });
  }
};
