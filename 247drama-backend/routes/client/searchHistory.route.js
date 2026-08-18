const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const searchHistoryController = require("../../controllers/client/searchHistory.controller");

//Entry for the SearchHistory + SearchCount
route.post("/searchMovieSeries", checkAccessWithSecretKey(), searchHistoryController.searchMovieSeries);

//Get Most Searched (Top Trending)
route.get("/getMostSearched", checkAccessWithSecretKey(), searchHistoryController.getMostSearched);

module.exports = route;
