const express = require("express");
const route = express.Router();

const userVideoListController = require("../../controllers/client/userVideoList.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//video added to own list by user
route.post("/videoAddedToMyListByUser", checkAccessWithSecretKey(), userVideoListController.videoAddedToMyListByUser);

//fetch videos which added own list
route.get("/getAllVideosAddedToMyListByUser", checkAccessWithSecretKey(), userVideoListController.getAllVideosAddedToMyListByUser);

module.exports = route;
