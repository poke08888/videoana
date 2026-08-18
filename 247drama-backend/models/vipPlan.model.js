const mongoose = require("mongoose");

const VipPlanSchema = new mongoose.Schema(
  {
    validity: { type: Number, default: 1 },
    validityType: { type: String, default: "" },
    price: { type: Number, default: 0 },
    offerPrice: { type: Number, default: 0 },
    tags: { type: String, default: "" },
    productKey: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

VipPlanSchema.index({ createdAt: -1 });

module.exports = mongoose.model("VipPlan", VipPlanSchema);
