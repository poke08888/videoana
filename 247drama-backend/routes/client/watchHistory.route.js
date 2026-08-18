const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const watchHistoryController = require("../../controllers/client/watchHistory.controller");

//creating and potentially updating watch history records of the particular video (view the shortvideo)
route.post("/handleWatchHistoryCreation", checkAccessWithSecretKey(), watchHistoryController.handleWatchHistoryCreation);

module.exports = route;
