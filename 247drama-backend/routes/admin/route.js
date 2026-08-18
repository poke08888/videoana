//express
const express = require("express");
const route = express.Router();

//admin middleware
const AdminMiddleware = require("../../middleware/admin.middleware");

//require admin's route.js
const admin = require("./admin.route");
const login = require("./login.route");
const dashboard = require("./dashboard.route");
const currency = require("./currency.route");
const user = require("./user.route");
const file = require("./file.route");
const adRewardCoin = require("./adRewardCoin.route");
const dailyRewardCoin = require("./dailyRewardCoin.route");
const category = require("./category.route");
const movieSeries = require("./movieSeries.route");
const shortVideo = require("./shortVideo.route");
const report = require("./report.route");
const reportReason = require("./reportReason.route");
const coinplan = require("./coinplan.route");
const vipPlan = require("./vipPlan.route");
const history = require("./history.route");
const setting = require("./setting.route");
const notification = require("./notification.route");
const contentPage = require("./contentPage.route");
const language = require("./language.route");
const role = require("./role.route");
const subAdmin = require("./subAdmin.route");
const languageForTranslation = require("./languageForTranslation.route");
const translation = require("./translation.route");
const marketingTracking = require("./marketingTracking.route");

//exports admin's route.js
route.use("/admin", admin);
route.use("/login", login);
route.use("/dashboard", AdminMiddleware, dashboard);
route.use("/currency", AdminMiddleware, currency);
route.use("/user", AdminMiddleware, user);
route.use("/file", AdminMiddleware, file);
route.use("/adRewardCoin", AdminMiddleware, adRewardCoin);
route.use("/dailyRewardCoin", AdminMiddleware, dailyRewardCoin);
route.use("/category", AdminMiddleware, category);
route.use("/movieSeries", AdminMiddleware, movieSeries);
route.use("/shortVideo", AdminMiddleware, shortVideo);
route.use("/report", AdminMiddleware, report);
route.use("/reportReason", AdminMiddleware, reportReason);
route.use("/coinPlan", AdminMiddleware, coinplan);
route.use("/vipPlan", AdminMiddleware, vipPlan);
route.use("/history", AdminMiddleware, history);
route.use("/setting", setting);
route.use("/notification", AdminMiddleware, notification);
route.use("/contentPage", AdminMiddleware, contentPage);
route.use("/language", AdminMiddleware, language);
route.use("/role", AdminMiddleware, role);
route.use("/subAdmin", AdminMiddleware, subAdmin);
route.use("/languageForTranslation", AdminMiddleware, languageForTranslation);
route.use("/translation", AdminMiddleware, translation);
route.use("/marketingTracking", AdminMiddleware, marketingTracking);

module.exports = route;
