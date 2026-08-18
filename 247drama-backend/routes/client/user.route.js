//express
const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const UserController = require("../../controllers/client/user.controller");

//validate AuthToken
const validateAuthToken = require("../../middleware/validateAuthToken.middleware");

//check the user is exists or not with loginType 1
route.post("/checkUser", checkAccessWithSecretKey(), UserController.checkUser);

//user login or sign up
route.post("/loginOrSignUp", checkAccessWithSecretKey(), UserController.loginOrSignUp);

//update profile of the user
route.patch("/updateProfile", checkAccessWithSecretKey(), UserController.updateProfile);

//link phone number
route.post("/linkPhone", checkAccessWithSecretKey(), UserController.linkPhone);

//get user profile who login
route.get("/fetchProfile", checkAccessWithSecretKey(), UserController.fetchProfile);

//check referral code is valid and apply referral code by user
route.patch("/validateAndApplyReferralCode", checkAccessWithSecretKey(), UserController.validateAndApplyReferralCode);

//earn coin from watching ad
route.patch("/handleAdWatchReward", checkAccessWithSecretKey(), UserController.handleAdWatchReward);

//delete user account
route.delete("/deleteUserAccount", checkAccessWithSecretKey(), UserController.deleteUserAccount);

//user login or sign up ( web )
route.post("/authenticateOrRegister", validateAuthToken, checkAccessWithSecretKey(), UserController.authenticateOrRegister);

//claim extra task
route.patch("/claimExtraTask", checkAccessWithSecretKey(), UserController.claimExtraTask);

//increment watch time
route.patch("/incrementWatchTime", checkAccessWithSecretKey(), UserController.incrementWatchTime);

module.exports = route;
