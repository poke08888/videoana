//express
const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const historyController = require("../../controllers/client/history.controller");

//get referral history of particular user
route.get("/loadReferralHistoryByUser", checkAccessWithSecretKey(), historyController.loadReferralHistoryByUser);

//get coin history of particular user
route.get("/fetchCoinHistoryByUser", checkAccessWithSecretKey(), historyController.fetchCoinHistoryByUser);

//get transaction history
route.get("/retrieveUserSubscriptionHistory", checkAccessWithSecretKey(), historyController.retrieveUserSubscriptionHistory);

//get coin plan history
route.get("/fetchCoinplanHistoryOfUser", checkAccessWithSecretKey(), historyController.fetchCoinplanHistoryOfUser);

//get episodes unlocked history of particular user
route.get("/getEpisodeUnlockHistory", checkAccessWithSecretKey(), historyController.getEpisodeUnlockHistory);

//get episodes auto-unlocked history of particular user
route.get("/fetchEpisodeAutoUnlockHistory", checkAccessWithSecretKey(), historyController.fetchEpisodeAutoUnlockHistory);

module.exports = route;
