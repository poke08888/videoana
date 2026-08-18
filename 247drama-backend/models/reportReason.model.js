const mongoose = require("mongoose");

const reportReasonSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: "" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("ReportReason", reportReasonSchema);
