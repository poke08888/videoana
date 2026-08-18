//express
const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const LanguageController = require("../../controllers/client/language.ontroller");

// List languages
route.get("/getLanguageList", checkAccessWithSecretKey(), LanguageController.getLanguageList);

module.exports = route;
