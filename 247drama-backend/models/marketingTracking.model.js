const mongoose = require("mongoose");

const marketingTrackingSchema = new mongoose.Schema(
  {
    campaign: { type: String, trim: true, default: "Unknown" },
    channel: { type: String, trim: true, default: "Unknown" },
    feature: { type: String, trim: true, default: "" },
    installCount: { type: Number, default: 0 },
    openCount: { type: Number, default: 0 },
    date: { type: String, trim: true, default: "" }, // YYYY-MM-DD
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound index to quickly find and increment the stats for a specific day and campaign
marketingTrackingSchema.index(
  { campaign: 1, channel: 1, feature: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model("MarketingTracking", marketingTrackingSchema);
