const Language = require("../../models/languageForTranslation.model");
const Translation = require("../../models/translation.model");

const { createVersionIfNeeded } = require("../../util/versionUtils");

//deleteFromStorage
const { deleteFromStorage } = require("../../util/storageHelper");

// create Language
exports.spawnLanguage = async (req, res) => {
  try {
    const { languageTitle, languageCode, localLanguageTitle } = req.body;

    const isDefault = req.body.isDefault === "true";
    const isActive = req.body.isActive === "true";

    if (!languageTitle?.trim() || !languageCode?.trim() || !localLanguageTitle?.trim()) {
      if (req.body.languageIcon) await deleteFromStorage(req.body.languageIcon);
      return res.status(200).json({ status: false, message: "All fields are required" });
    }

    if (!req.body.languageIcon) {
      return res.status(200).json({ status: false, message: "Language icon is required" });
    }

    const existing = await Language.findOne({
      $or: [{ languageTitle }, { languageCode: languageCode?.trim()?.toLowerCase() }, { localLanguageTitle }],
    });

    if (existing) {
      if (req.body.languageIcon) await deleteFromStorage(req.body.languageIcon);
      return res.status(200).json({ status: false, message: "Language already exists" });
    }

    if (isDefault) {
      await Language.updateMany({}, { $set: { isDefault: false } });
    }

    const [newVersion, language] = await Promise.all([
      createVersionIfNeeded([
        {
          type: "ADD_LANGUAGE",
          language: languageCode,
          newLanguageTitle: languageTitle,
        },
      ]),
      Language.create({
        languageTitle: languageTitle?.trim(),
        languageCode: languageCode?.trim()?.toLowerCase(),
        localLanguageTitle: localLanguageTitle?.trim(),
        languageIcon: req.body.languageIcon || "",
        isDefault,
        isActive,
      }),
    ]);

    return res.status(200).json({
      status: true,
      message: "Language created successfully",
      data: language,
      globalVersion: newVersion,
    });
  } catch (error) {
    if (req.body.languageIcon) await deleteFromStorage(req.body.languageIcon);
    console.log("createLanguage error: ", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// get all languages
exports.findAll = async (req, res) => {
  try {
    const start = Math.max(1, parseInt(req.query?.start) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query?.limit) || 10));
    const skip = (start - 1) * limit;

    const search = req.query?.search?.trim();

    const matchStage = {};

    if (search) {
      matchStage.$or = [{ languageTitle: { $regex: search, $options: "i" } }, { localLanguageTitle: { $regex: search, $options: "i" } }, { languageCode: { $regex: search, $options: "i" } }];
    }

    const result = await Language.aggregate([
      {
        $match: matchStage,
      },
      {
        $facet: {
          data: [{ $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit }],
          total: [{ $count: "count" }],
        },
      },
    ]);

    const languages = result[0]?.data || [];
    const total = result[0]?.total[0]?.count || 0;

    return res.status(200).json({
      status: true,
      message: "Languages fetched",
      total,
      data: languages,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: error.message,
    });
  }
};

// get single Lnaguage
exports.find = async (req, res) => {
  try {
    const { languageCode } = req.query;

    if (!languageCode?.trim()) {
      return res.status(200).json({ status: false, message: "languageCode is required" });
    }

    const language = await Language.findOne({ languageCode: languageCode?.trim()?.toLowerCase() });

    if (!language) {
      return res.status(200).json({ status: false, message: "Language not found" });
    }

    return res.status(200).json({
      status: true,
      message: "Language fetched",
      data: language,
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// update Language
exports.upgrade = async (req, res) => {
  try {
    const { languageCode, languageTitle, localLanguageTitle } = req.body;

    if (!languageCode?.trim()) {
      if (req.body.languageIcon) await deleteFromStorage(req.body.languageIcon);
      return res.status(200).json({ status: false, message: "languageCode is required" });
    }

    const language = await Language.findOne({ languageCode: languageCode?.trim()?.toLowerCase() });

    if (!language) {
      if (req.body.languageIcon) await deleteFromStorage(req.body.languageIcon);
      return res.status(200).json({ status: false, message: "Language not found" });
    }

    if (languageTitle?.trim()) language.languageTitle = languageTitle?.trim();
    if (localLanguageTitle?.trim()) language.localLanguageTitle = localLanguageTitle?.trim();
    if (req.body.languageIcon) {
      // delete old icon if exists
      if (language.languageIcon) {
        await deleteFromStorage(language.languageIcon);
      }

      // store new icon path
      language.languageIcon = req.body.languageIcon || "";
    }

    await language.save();

    return res.status(200).json({
      status: true,
      message: "Language updated successfully",
      data: language,
    });
  } catch (error) {
    if (req.body.languageIcon) await deleteFromStorage(req.body.languageIcon);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// toggle isActive and isDefault switch
exports.switchTheSwitch = async (req, res) => {
  try {
    const { languageCode } = req.query;
    const toggleType = Number(req.query.toggleType);

    if (!languageCode || !toggleType) {
      return res.status(200).json({ status: false, message: "languageCode and toggleType is required" });
    }

    if (![1, 2].includes(toggleType)) {
      return res.status(200).json({ status: false, message: "Invalid toggleType. Use 1 for isActive or 2 for isDefault." });
    }

    const language = await Language.findOne({ languageCode });

    if (!language) {
      return res.status(200).json({ status: false, message: "Language not found" });
    }

    if (toggleType === 1) {
      if (language.isActive) {
        if (language.isDefault) {
          return res.json({
            status: false,
            message: "Language is set to default, cannot deactivate default language",
          });
        }
      }

      language.isActive = !language.isActive;
      await language.save();

      return res.json({
        status: true,
        message: `Language is now ${language.isActive ? "active" : "inactive"}.`,
        isActive: language.isActive,
      });
    }

    if (toggleType === 2) {
      if (language.errorCount > 0) {
        return res.json({
          status: false,
          message: `This langauge has ${language.errorCount} ${language.errorCount === 1 ? "error" : "errors"}, fix ${language.errorCount === 1 ? "it" : "them"} first before making it default`,
        });
      }

      if (!language.isActive) {
        return res.json({
          status: false,
          message: "Language is not active, please activate it first",
        });
      }

      if (language.isDefault) {
        return res.json({
          status: false,
          message: "Language is already set to default",
        });
      }

      await Language.updateMany({}, { $set: { isDefault: false } });

      language.isDefault = true;
      await language.save();

      return res.json({
        status: true,
        message: "Language set as default successfully.",
        isDefault: true,
      });
    }
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// delete Language and its Translations
exports.demolish = async (req, res) => {
  try {
    const { languageCode } = req.query;

    if (!languageCode?.trim()) {
      return res.status(200).json({ status: false, message: "languageCode is required" });
    }

    const language = await Language.findOne({ languageCode: languageCode?.trim()?.toLowerCase() });

    if (!language) {
      return res.status(200).json({ status: false, message: "Language not found" });
    }

    if (language.isDefault) {
      return res.status(200).json({ status: false, message: "Please set a new default language before deleting this one." });
    }

    if (language.languageIcon) {
      await deleteFromStorage(language.languageIcon);
    }

    await Promise.all([Translation.deleteOne({ languageCode: languageCode?.trim()?.toLowerCase() }), Language.deleteOne({ languageCode: languageCode?.trim()?.toLowerCase() })]);

    const changeLogs = [
      {
        type: "REMOVE_LANGUAGE",
        language: languageCode,
      },
    ];

    await createVersionIfNeeded(changeLogs);

    return res.status(200).json({
      status: true,
      message: "Language deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};
