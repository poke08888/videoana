const mongoose = require("mongoose");

const currencySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "", unique: true },
    symbol: { type: String, trim: true, default: "", unique: true },
    countryCode: { type: String, trim: true, default: "" },
    currencyCode: { type: String, trim: true, default: "" },
    isDefault: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("Currency", currencySchema);
