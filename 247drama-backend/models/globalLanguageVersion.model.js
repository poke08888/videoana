const mongoose = require("mongoose");

const globalLanguageVersionSchema = new mongoose.Schema(
  {
    version: {
      major: Number,
      minor: Number,
      patch: Number
    },
    changes: [
      {
        type: { type: String }, // ADD_KEY, UPDATE_KEY, ADD_LANGUAGE
        language: String,
        key: String,
        oldValue: String,
        newValue: String
      }
    ],
    createdAt: { type: Date, default: Date.now }
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("GlobalLanguageVersion", globalLanguageVersionSchema);