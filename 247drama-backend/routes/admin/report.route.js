const express = require("express");
const route = express.Router();

const ReportController = require("../../controllers/admin/report.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//fetch reports
route.get("/getReports", checkAccessWithSecretKey(), ReportController.getReports);

//report solved
route.put("/solveReport", checkAccessWithSecretKey(), ReportController.solveReport);

//delete report
route.delete("/deleteReport", checkAccessWithSecretKey(), ReportController.deleteReport);

module.exports = route;
