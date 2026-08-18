// models/translation.model.js
const mongoose = require("mongoose");

const translationSchema = new mongoose.Schema(
  {
    languageCode: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    module: {
      type: String,
      required: true,
      enum: ["app", "web"],
      trim: true,
      lowercase: true
    },
    translations: {
      type: Map,
      of: String,
      default: {}
    },
    version: {
      major: { type: Number, required: true },
      minor: { type: Number, required: true },
      patch: { type: Number, required: true }
    }
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

translationSchema.index({ languageCode: 1, module: 1 }, { unique: true });

module.exports = mongoose.model("Translation", translationSchema);