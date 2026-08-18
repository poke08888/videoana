const MarketingTracking = require("../../models/marketingTracking.model");

/**
 * Handle Webhooks from Branch.io
 * Reference: https://help.branch.io/developers-hub/docs/webhooks
 */
exports.handleBranchWebhook = async (req, res) => {
  try {
    // Branch sends data directly in req.body
    const eventName = req.body.name; // e.g. "INSTALL", "OPEN", "REINSTALL"
    const touchData = req.body.last_attributed_touch_data || {};

    console.log(`[Branch Webhook] Received Event: ${eventName}`);

    // We only track INSTALLs and OPENs
    if (eventName === "INSTALL" || eventName === "OPEN" || eventName === "REINSTALL") {
      
      const campaign = touchData["~campaign"] || "Organic";
      const channel = touchData["~channel"] || "Organic";
      const feature = touchData["~feature"] || "App Open";

      // If it's completely organic and no tracking data, we can optionally ignore it
      // But let's track it anyway to see total organics
      
      // Get current date in YYYY-MM-DD
      const dateStr = new Date().toISOString().split('T')[0];

      // Prepare increment
      const incFields = {};
      if (eventName === "INSTALL") {
        incFields.installCount = 1;
      } else {
        incFields.openCount = 1; // OPEN and REINSTALL
      }

      await MarketingTracking.findOneAndUpdate(
        {
          campaign: campaign,
          channel: channel,
          feature: feature,
          date: dateStr
        },
        { $inc: incFields },
        { upsert: true, new: true }
      );

      console.log(`[Branch Webhook] Tracked ${eventName} for Campaign: ${campaign}`);
    }

    return res.status(200).json({ status: true, message: "Webhook processed successfully" });
  } catch (error) {
    console.error("[Branch Webhook Error]:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};
