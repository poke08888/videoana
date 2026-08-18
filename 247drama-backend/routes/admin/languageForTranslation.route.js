//express
const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const languageController = require("../../controllers/admin/languageForTranslation.controller");

route.use(checkAccessWithSecretKey());

// create Language
route.post("/spawnLanguage", languageController.spawnLanguage);

// get all languages
route.get("/findAll", languageController.findAll);

// get single Lnaguage
route.get("/find", languageController.find);

// update Language
route.patch("/upgrade", languageController.upgrade);

// toggle isActive and isDefault switch
route.patch("/switchTheSwitch", languageController.switchTheSwitch);

// delete Language and its Translations
route.delete("/demolish", languageController.demolish);

module.exports = route;
