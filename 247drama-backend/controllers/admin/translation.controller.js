const fs = require("fs");
const Translation = require("../../models/translation.model");
const Language = require("../../models/languageForTranslation.model");

const { parseCSV } = require("../../util/csvParser");
const { createVersionIfNeeded } = require("../../util/versionUtils");

// create Translations for languages using CSV file
exports.fill = async (req, res) => {
  const cleanup = () => {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  };

  try {
    if (!req.file) {
      return res.status(200).json({ status: false, message: "CSV file is required" });
    }

    const rows = await parseCSV(req.file.path);

    if (!rows.length) {
      cleanup();
      return res.status(200).json({ status: false, message: "CSV is empty" });
    }

    const headers = Object.keys(rows[0]);

    // Detect KEY column safely
    const keyHeader = headers.find((h) => h.trim().toUpperCase() === "KEY");

    if (!keyHeader) {
      cleanup();
      return res.status(200).json({ status: false, message: "KEY column missing" });
    }

    // Detect MODULE column safely
    const moduleHeader = headers.find((h) => h.trim().toUpperCase() === "MODULE");

    if (!moduleHeader) {
      cleanup();
      return res.status(200).json({
        status: false,
        message: "MODULE column missing",
      });
    }

    // Normalize language headers
    const languageHeaders = headers.filter((h) => h !== keyHeader && h !== moduleHeader).map((h) => h.trim().toLowerCase());

    if (!languageHeaders.length) {
      cleanup();
      return res.status(200).json({ status: false, message: "No language columns found" });
    }

    // Fetch all languages once
    const allLanguages = await Language.find({}).select("languageCode isActive").lean();

    // Normalize everything once
    const normalizedLanguages = allLanguages.map((l) => ({
      languageCode: l.languageCode?.trim()?.toLowerCase(),
      isActive: l.isActive,
    }));

    // Build Sets
    const allLanguageCodeSet = new Set(normalizedLanguages.map((l) => l.languageCode));

    const activeLanguageCodeSet = new Set(normalizedLanguages.filter((l) => l.isActive).map((l) => l.languageCode));

    const inactiveLanguageCodeSet = new Set(normalizedLanguages.filter((l) => !l.isActive).map((l) => l.languageCode));

    // Normalize CSV headers once (safety)
    const csvLanguageSet = new Set(languageHeaders);

    // Check for unknown headers
    const invalidHeaders = languageHeaders.filter((code) => !allLanguageCodeSet.has(code));

    if (invalidHeaders.length) {
      cleanup();
      return res.status(200).json({
        status: false,
        message: "Unknown language headers found in CSV",
        invalidHeaders,
      });
    }

    // Check for inactive languages included in CSV
    const inactiveLanguages = languageHeaders.filter((code) => inactiveLanguageCodeSet.has(code));

    if (inactiveLanguages.length) {
      cleanup();
      return res.status(200).json({
        status: false,
        message: "Some languages in CSV are inactive. Please activate them or remove from CSV.",
        inactiveLanguages,
      });
    }

    // Check if any active language is missing from CSV
    const missingActiveLanguages = [...activeLanguageCodeSet].filter((code) => !csvLanguageSet.has(code));

    if (missingActiveLanguages.length) {
      cleanup();
      return res.status(200).json({
        status: false,
        message: "Some active languages are missing from CSV. Either make them inactive or include them in CSV.",
        missingLanguages: missingActiveLanguages,
      });
    }

    // Now define validCodes for later use
    const validCodes = languageHeaders;

    const seenKeys = new Set();
    const languageData = {};
    const changeLogs = [];
    const bulkOps = [];
    const affectedDocs = new Set();

    const keyRegex = /^[a-zA-Z0-9_.-]+$/;

    const VALID_MODULES = ["app", "web"];

    const headerMap = {};
    headers.forEach((h) => {
      headerMap[h.trim().toLowerCase()] = h;
    });

    let inValidKeysFormat = [];
    let inValidModule = [];
    let duplicateKeys = [];

    // Build structured CSV data
    for (const row of rows) {
      const rawKey = row[keyHeader];
      const rawModule = row[moduleHeader];

      if (!rawKey) continue;

      const cleanKey = rawKey.trim();
      const cleanModule = rawModule?.trim().toLowerCase() || "";

      if (!cleanKey || !keyRegex.test(cleanKey)) {
        inValidKeysFormat.push(rawKey);
        continue;
      }

      if (!VALID_MODULES.includes(cleanModule)) {
        inValidModule.push(rawModule);
        continue;
      }

      if (seenKeys.has(cleanKey + "_" + cleanModule)) {
        duplicateKeys.push(cleanKey);
        continue;
      }

      seenKeys.add(cleanKey + "_" + cleanModule);

      if (!languageData[cleanModule]) {
        languageData[cleanModule] = {};
      }

      for (const lang of validCodes) {
        const headerKey = headerMap[lang];
        const rawValue = row[headerKey];

        const cleanValue = rawValue ? rawValue.trim() : "";

        if (!languageData[cleanModule][lang]) {
          languageData[cleanModule][lang] = {};
        }

        languageData[cleanModule][lang][cleanKey] = cleanValue;
      }
    }

    if (inValidKeysFormat.length > 0 || inValidModule.length > 0 || duplicateKeys.length > 0) {
      cleanup();
      return res.status(200).json({
        status: false,
        message: "Invalid data found in CSV",
        inValidKeysFormat,
        inValidModule,
        duplicateKeys,
      });
    }

    // Fetch existing localization docs once
    const existingDocs = await Translation.find({
      languageCode: { $in: validCodes },
      module: { $in: VALID_MODULES },
    });

    const existingMap = {};
    for (const doc of existingDocs) {
      existingMap[`${doc.languageCode}_${doc.module}`] = doc;
    }

    // Process per language
    for (const module in languageData) {
      for (const lang of validCodes) {
        const csvTranslations = languageData[module][lang] || {};
        if (!Object.keys(csvTranslations).length) continue;

        const existingDoc = existingMap[`${lang}_${module}`];
        let existingTranslations = {};

        if (existingDoc?.translations) {
          existingTranslations = existingDoc.translations instanceof Map ? Object.fromEntries(existingDoc.translations) : existingDoc.translations;
        }

        const setObject = {};
        let hasChanges = false;

        if (!existingDoc) {
          changeLogs.push({
            type: "ADD_LANGUAGE",
            language: lang,
          });
        }

        for (const key in csvTranslations) {
          const newValue = csvTranslations[key];
          const oldValue = existingTranslations[key];

          if (!existingDoc || oldValue === undefined) {
            changeLogs.push({
              type: "ADD_KEY",
              language: lang,
              key,
              newValue,
            });
            hasChanges = true;
          } else if (oldValue !== newValue) {
            changeLogs.push({
              type: "UPDATE_KEY",
              language: lang,
              key,
              oldValue,
              newValue,
            });
            hasChanges = true;
          }

          setObject[`translations.${key}`] = newValue;
        }

        if (hasChanges) {
          affectedDocs.add(`${lang}_${module}`);

          bulkOps.push({
            updateOne: {
              filter: { languageCode: lang, module },
              update: {
                $set: setObject,
                $setOnInsert: { module },
              },
              upsert: true,
            },
          });
        }
      }
    }

    if (bulkOps.length) {
      await Translation.bulkWrite(bulkOps);
    }

    const newVersion = await createVersionIfNeeded(changeLogs);

    let versionObject = null;

    if (newVersion) {
      const [major, minor, patch] = newVersion.split(".").map(Number);

      versionObject = { major, minor, patch };
    }

    if (changeLogs.length > 0) {
      await Translation.bulkWrite(
        Array.from(affectedDocs).map((v) => {
          const [languageCode, module] = v.split("_");
          return {
            updateOne: {
              filter: { languageCode: languageCode?.trim()?.toLowerCase(), module: module?.trim()?.toLowerCase() },
              update: { $set: { version: versionObject } },
            },
          };
        }),
      );
    }

    // Recalculate errorCount based on current DB state
    const updatedTranslations = await Translation.find({
      languageCode: { $in: validCodes },
      module: { $in: VALID_MODULES },
    }).lean();

    const languageErrorMap = {};

    for (const doc of updatedTranslations) {
      const translations = doc.translations || {};
      let emptyCount = 0;

      for (const key in translations) {
        if (!translations[key] || translations[key].trim() === "") {
          emptyCount++;
        }
      }

      if (!languageErrorMap[doc.languageCode]) {
        languageErrorMap[doc.languageCode] = 0;
      }

      languageErrorMap[doc.languageCode] += emptyCount;
    }

    const errorUpdates = Object.entries(languageErrorMap).map(([languageCode, errorCount]) => ({
      updateOne: {
        filter: { languageCode: languageCode?.trim()?.toLowerCase() },
        update: { $set: { errorCount } },
      },
    }));

    if (errorUpdates.length) {
      await Language.bulkWrite(errorUpdates);
    }

    cleanup();

    return res.status(200).json({
      status: true,
      message: "Translation processed successfully",
      version: newVersion,
      changesCount: changeLogs.length,
    });
  } catch (error) {
    cleanup();
    console.log(error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// update specific key-value pairs for a language
exports.upgrade = async (req, res) => {
  try {
    const { languageCode, module, translations } = req.body || {};

    if (!languageCode?.trim() || !translations || typeof translations !== "object") {
      return res.status(400).json({
        status: false,
        message: "languageCode, module and translations object are required",
      });
    }

    if (!module || !["app", "web"].includes(module?.trim()?.toLowerCase())) {
      return res.status(400).json({
        status: false,
        message: "Valid module is required (app | web)",
      });
    }

    const language = await Language.findOne({ languageCode: languageCode?.trim()?.toLowerCase() }).lean();

    if (!language) {
      return res.status(404).json({
        status: false,
        message: "Language not found",
      });
    }

    const existingDoc = await Translation.findOne({ languageCode: languageCode?.trim()?.toLowerCase(), module: module?.trim()?.toLowerCase() });

    if (!existingDoc) {
      return res.status(404).json({
        status: false,
        message: "No translations found for this language",
      });
    }

    const changeLogs = [];
    const setObject = {};

    for (const key in translations) {
      const newValue = translations[key] ?? "";
      const oldValue = existingDoc.translations.get(key);

      if (oldValue === undefined) {
        changeLogs.push({
          type: "ADD_KEY",
          language: languageCode,
          key,
          newValue,
        });
      } else if (oldValue !== newValue) {
        changeLogs.push({
          type: "UPDATE_KEY",
          language: languageCode,
          key,
          oldValue,
          newValue,
        });
      }

      setObject[`translations.${key}`] = newValue;
    }

    if (Object.keys(setObject).length) {
      await Translation.updateOne({ languageCode, module }, { $set: setObject });
    }

    let newVersion = null;
    let versionObject = null;

    if (changeLogs.length) {
      newVersion = await createVersionIfNeeded(changeLogs);

      const [major, minor, patch] = newVersion.split(".").map(Number);

      versionObject = { major, minor, patch };

      await Translation.updateOne({ languageCode, module }, { $set: { version: versionObject } });
    }

    // Recalculate errorCount
    const docs = await Translation.find({ languageCode: languageCode?.trim()?.toLowerCase() }).lean();

    let totalErrors = 0;

    for (const doc of docs) {
      for (const key in doc.translations) {
        if (!doc.translations[key] || doc.translations[key].trim() === "") {
          totalErrors++;
        }
      }
    }

    await Language.updateOne({ languageCode: languageCode?.trim()?.toLowerCase() }, { $set: { errorCount: totalErrors } });

    return res.status(200).json({
      status: true,
      message: "Translations updated successfully",
      version: newVersion,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: error.message,
    });
  }
};

// download all translations as CSV file
exports.getCSV = async (req, res) => {
  try {
    const translationDocs = await Translation.find().lean();

    if (!translationDocs.length) {
      return res.status(404).json({
        status: false,
        message: "No translations found",
      });
    }

    // Collect all language codes
    const languageCodesSet = new Set();
    translationDocs.forEach((doc) => {
      Object.keys(doc.translations || {}).forEach(() => {});
      languageCodesSet.add(doc.languageCode);
    });
    const languageCodes = Array.from(languageCodesSet).sort();

    // Collect all unique keys across all modules and languages
    const allKeysSet = new Set();
    translationDocs.forEach((doc) => {
      Object.keys(doc.translations || {}).forEach((key) => {
        allKeysSet.add(`${doc.module}|||${key}`);
      });
    });
    const allKeys = Array.from(allKeysSet).sort();

    // Build CSV header: KEY,MODULE,en,fr,es...
    let csv = `KEY,MODULE,${languageCodes.join(",")}\n`;

    // Build rows
    for (const combinedKey of allKeys) {
      const [module, key] = combinedKey.split("|||");
      const rowValues = [key, module];

      for (const lang of languageCodes) {
        // Find translation for this key/module/lang
        const doc = translationDocs.find((d) => d.languageCode === lang && d.module === module);

        const value = doc?.translations?.[key] ?? "";
        const safeValue = `"${String(value).replace(/"/g, '""')}"`;
        rowValues.push(safeValue);
      }

      csv += rowValues.join(",") + "\n";
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=translations.csv");

    return res.send(csv);
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: error.message,
    });
  }
};

// get single Language's translations
exports.find = async (req, res) => {
  try {
    const languageCode = req.query.languageCode?.trim()?.toLowerCase() || {};

    if (!languageCode || !languageCode.trim()) {
      return res.status(200).json({ status: false, message: "Please provide desired language" });
    }

    let filter = { languageCode: languageCode?.trim()?.toLowerCase() };

    if (req.query.module?.trim() && ["app", "web"].includes(req.query.module?.trim()?.toLowerCase())) {
      filter.module = req.query.module?.trim()?.toLowerCase();
    }

    const doc = await Translation.find(filter).lean();

    if (!doc || doc.length === 0) {
      return res.status(200).json({
        status: false,
        message: "No translation found for this language",
      });
    }

    let result = doc[0];

    if (req.query.search?.trim()) {
      const search = req.query.search.toLowerCase();

      const filteredTranslations = Object.fromEntries(Object.entries(result.translations).filter(([key, value]) => key.toLowerCase().includes(search) || value.toLowerCase().includes(search)));

      result = {
        ...result,
        translations: filteredTranslations,
      };
    }

    return res.status(200).json({
      status: true,
      message: "Language fetched",
      doc: result,
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};
