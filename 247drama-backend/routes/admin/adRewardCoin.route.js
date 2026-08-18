const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const adRewardCoinController = require("../../controllers/admin/adRewardCoin.controoler");

//create ad reward
route.post("/storeAdReward", checkAccessWithSecretKey(), adRewardCoinController.storeAdReward);

//update ad reward
route.put("/updateAdReward", checkAccessWithSecretKey(), adRewardCoinController.updateAdReward);

//get ad reward
route.get("/getAdReward", checkAccessWithSecretKey(), adRewardCoinController.getAdReward);

//delete ad reward
route.delete("/deleteAdReward", checkAccessWithSecretKey(), adRewardCoinController.deleteAdReward);

module.exports = route;
