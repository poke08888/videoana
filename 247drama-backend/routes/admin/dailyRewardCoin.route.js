const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const dailyRewardCoinController = require("../../controllers/admin/dailyRewardCoin.controller");

//create daily reward
route.post("/storeDailyReward", checkAccessWithSecretKey(), dailyRewardCoinController.storeDailyReward);

//update daily reward
route.put("/updateDailyReward", checkAccessWithSecretKey(), dailyRewardCoinController.updateDailyReward);

//get daily reward
route.get("/getDailyReward", checkAccessWithSecretKey(), dailyRewardCoinController.getDailyReward);

//delete daily reward
route.delete("/deleteDailyReward", checkAccessWithSecretKey(), dailyRewardCoinController.deleteDailyReward);

module.exports = route;
