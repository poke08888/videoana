const express = require("express");
const route = express.Router();

//Controller
const contentPageController = require("../../controllers/admin/contentPage.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

route.post("/createContentPage", checkAccessWithSecretKey(), contentPageController.createContentPage);

route.patch("/updateContentPage", checkAccessWithSecretKey(), contentPageController.updateContentPage);

route.get("/getContentPageByName", checkAccessWithSecretKey(), contentPageController.getContentPageByName);

route.get("/getAllContentPages", checkAccessWithSecretKey(), contentPageController.getAllContentPages);

route.delete("/deleteContentPage", checkAccessWithSecretKey(), contentPageController.deleteContentPage);

module.exports = route;
