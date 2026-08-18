const express = require("express");
const route = express.Router();

//Controller
const coinplanController = require("../../controllers/admin/coinplan.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//create coinplan
route.post("/store", checkAccessWithSecretKey(), coinplanController.store);

//update coinplan
route.put("/update", checkAccessWithSecretKey(), coinplanController.update);

//handle isActive switch
route.put("/handleSwitch", checkAccessWithSecretKey(), coinplanController.handleSwitch);

//delete coinplan
route.delete("/delete", checkAccessWithSecretKey(), coinplanController.delete);

//get coinplan
route.get("/get", checkAccessWithSecretKey(), coinplanController.get);

//get user's coinplan order histories
route.get("/fetchCoinplanHistory", checkAccessWithSecretKey(), coinplanController.fetchCoinplanHistory);

// coin analytics cards (Coins Economy)
route.get("/getAdminCoinAnalytics", checkAccessWithSecretKey(), coinplanController.getAdminCoinAnalytics);

// Coin Sources Over Time + Distribution Charts (Coins Economy)
route.get("/getAdminCoinCharts", checkAccessWithSecretKey(), coinplanController.getAdminCoinCharts);

// Top Episodes by Coin Usage (Coins Economy)
route.get("/getTopEpisodesByCoinUsage", checkAccessWithSecretKey(), coinplanController.getTopEpisodesByCoinUsage);

// get coin + vip history (all users)
route.get("/fetchCoinAndVipHistory", checkAccessWithSecretKey(), coinplanController.fetchCoinAndVipHistory);

module.exports = route;
