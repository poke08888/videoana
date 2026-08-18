const express = require("express");
const route = express.Router();

//Controller
const contentPageController = require("../../controllers/client/contentpage.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

route.get("/retrieveContentPages", checkAccessWithSecretKey(), contentPageController.retrieveContentPages);

module.exports = route;
