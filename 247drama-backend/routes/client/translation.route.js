const express = require("express");
const translationController = require("../../controllers/client/translation.controller");
const checkAccessWithSecretKey = require("../../checkAccess");

const router = express.Router();

router.use(checkAccessWithSecretKey());

// get single Language's translations
router.get("/find", translationController.find);

// get all Languages and their translations
router.get("/findAll", translationController.findAll);

// get latest version of global Language system
router.get("/latestVersion", translationController.latestVersion);

// get all active Languages
router.get("/findActive", translationController.findActive);

module.exports = router;
