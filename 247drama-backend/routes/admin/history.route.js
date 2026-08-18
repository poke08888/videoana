//express
const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const historyController = require("../../controllers/admin/history.controller");

//get coin history of particular user
route.get("/retrieveUserCoinTransactions", checkAccessWithSecretKey(), historyController.retrieveUserCoinTransactions);

//get referral history of particular user
route.get("/retrieveUserReferralRecords", checkAccessWithSecretKey(), historyController.retrieveUserReferralRecords);

module.exports = route;
