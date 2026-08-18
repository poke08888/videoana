const express = require("express");
const route = express.Router();

//Controller
const coinplanController = require("../../controllers/client/coinplan.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//validate AuthToken
const validateAuthToken = require("../../middleware/validateAuthToken.middleware");

//get coinplan
route.get("/fetchCoinplanByUser", checkAccessWithSecretKey(), coinplanController.fetchCoinplanByUser);

//when user purchase the coinPlan create coinPlan history by user
route.post("/recordCoinPlanHistory", checkAccessWithSecretKey(), coinplanController.recordCoinPlanHistory);

module.exports = route;
