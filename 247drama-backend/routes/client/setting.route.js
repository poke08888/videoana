//express
const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const settingController = require("../../controllers/client/setting.controller");

//get setting
route.get("/retrieveSettingsForUser", checkAccessWithSecretKey(), settingController.retrieveSettingsForUser);

module.exports = route;
