const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const LanguageController = require("../../controllers/admin/language.controller");

// Create language
route.post("/addLanguage", checkAccessWithSecretKey(), LanguageController.addLanguage);

// Update language
route.patch("/editLanguage", checkAccessWithSecretKey(), LanguageController.editLanguage);

// Toggle isActive language
route.patch("/toggleLanguageStatus", checkAccessWithSecretKey(), LanguageController.toggleLanguageStatus);

// List languages
route.get("/listLanguages", checkAccessWithSecretKey(), LanguageController.listLanguages);

// Get language (dropdown)
route.get("/getLanguageOptions", checkAccessWithSecretKey(), LanguageController.getLanguageOptions);

// Delete language
route.delete("/removeLanguage", checkAccessWithSecretKey(), LanguageController.removeLanguage);

module.exports = route;
