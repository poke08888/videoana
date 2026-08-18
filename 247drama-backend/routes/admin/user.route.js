//express
const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const UserController = require("../../controllers/admin/user.controller");

//update userInfo
route.put("/modifyUserInfo", checkAccessWithSecretKey(), UserController.modifyUserInfo);

//handle block of the user
route.put("/isBlock", checkAccessWithSecretKey(), UserController.isBlock);

//get user profile
route.get("/retriveUserProfile", checkAccessWithSecretKey(), UserController.retriveUserProfile);

//get all users
route.get("/getUsersByAdmin", checkAccessWithSecretKey(), UserController.getUsersByAdmin);

//delete user
route.delete("/deactivateUser", checkAccessWithSecretKey(), UserController.deactivateUser);

// get user analytics (users)
route.get("/getUserAnalytics", checkAccessWithSecretKey(), UserController.getUserAnalytics);

// user analytics cards (User Analytics)
route.get("/getUserCards", checkAccessWithSecretKey(), UserController.getUserCards);

// user growth chart (User Analytics)
route.get("/getUserGrowthChart", checkAccessWithSecretKey(), UserController.getUserGrowthChart);

// user retention and engagement chart (User Analytics)
route.get("/getUserRetentionAndEngagement", checkAccessWithSecretKey(), UserController.getUserRetentionAndEngagement);

// update user wallet balance (add / deduct coins)
route.patch("/updateUserWalletBalance", checkAccessWithSecretKey(), UserController.updateUserWalletBalance);

module.exports = route;
