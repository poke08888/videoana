// models/language.model.js
const mongoose = require("mongoose");

const languageForTranslation = new mongoose.Schema(
  {
    languageTitle: { type: String, unique: true, trim: true },
    languageCode: { type: String, trim: true, lowercase: true },
    localLanguageTitle: { type: String, unique: true, trim: true },
    languageIcon: { type: String, required: true },
    errorCount: { type: Number, default: 0 },
    isActive: {
      type: Boolean,
      default: true
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

languageForTranslation.index({ languageCode: 1 });

module.exports = mongoose.model("LanguageForTranslation", languageForTranslation);