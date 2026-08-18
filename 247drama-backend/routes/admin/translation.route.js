const express = require("express");
const multer = require("multer");

const localizationController = require("../../controllers/admin/translation.controller");
const checkAccessWithSecretKey = require("../../checkAccess");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.use(checkAccessWithSecretKey());

// create Translations for languages using CSV file
router.post("/fill", upload.single("file"), localizationController.fill);

// update specific key-value pairs for a language
router.patch("/upgrade", localizationController.upgrade);

// download all translations as CSV file
router.get("/getCSV", localizationController.getCSV);

// get single Language's translations
router.get("/find", localizationController.find);

module.exports = router;
