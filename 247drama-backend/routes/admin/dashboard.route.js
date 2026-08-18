const express = require("express");
const route = express.Router();

//Controller
const dashboardController = require("../../controllers/admin/dashboard.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//get dashboard count
route.get("/dashboardCount", checkAccessWithSecretKey(), dashboardController.dashboardCount);

//get date wise chartAnalytic for users, revenue
route.get("/chartAnalytic", checkAccessWithSecretKey(), dashboardController.chartAnalytic);

// Dashboard Overview card data (overview)
route.get("/dashboardOverview", checkAccessWithSecretKey(), dashboardController.dashboardOverview);

// Paid Revenue Trend chart (overview)
route.get("/getPaidRevenueTrend", checkAccessWithSecretKey(), dashboardController.getPaidRevenueTrend);

// get paid revenue card (Revenue and Monetization)
route.get("/getRevenueAnalytics", checkAccessWithSecretKey(), dashboardController.getRevenueAnalytics);

// get Revenue by Series and Episodes by purchased coins: chart (Revenue and Monetization)
route.get("/getPaidRevenue", checkAccessWithSecretKey(), dashboardController.getPaidRevenue);

// Top 10 Revenue Episodes (Revenue and Monetization)
route.get("/getTopRevenueEpisodes", checkAccessWithSecretKey(), dashboardController.getTopRevenueEpisodes);

// Series Revenue Breakdown (Revenue and Monetization)
route.get("/getSeriesRevenueBreakdown", checkAccessWithSecretKey(), dashboardController.getSeriesRevenueBreakdown);

//  revenue breakdown by coin and vip plan purchase (Revenue and Monetization)
route.get("/getRevenueBreakdown", checkAccessWithSecretKey(), dashboardController.getRevenueBreakdown);

module.exports = route;
