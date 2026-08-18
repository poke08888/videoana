//express
const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const reportController = require("../../controllers/client/report.controller");

//report to video by user
route.post("/reportByUser", checkAccessWithSecretKey(), reportController.reportByUser);

//get reportReason (when report by the user)
route.get("/getReportReason", checkAccessWithSecretKey(), reportController.getReportReason);

module.exports = route;
