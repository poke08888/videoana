const express = require("express");
const route = express.Router();
const MarketingTrackingController = require("../../controllers/admin/marketingTracking.controller");

route.get("/", MarketingTrackingController.getMarketingStats);

module.exports = route;
