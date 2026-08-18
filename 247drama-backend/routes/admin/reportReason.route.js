const express = require("express");
const route = express.Router();

const checkAccessWithSecretKey = require("../../checkAccess");

const reportReasonController = require("../../controllers/admin/reportReason.controller");

//create reportReason
route.post("/store", checkAccessWithSecretKey(), reportReasonController.store);

//update reportReason
route.put("/update", checkAccessWithSecretKey(), reportReasonController.update);

//get reportReason
route.get("/get", checkAccessWithSecretKey(), reportReasonController.get);

//delete reportReason
route.delete("/delete", checkAccessWithSecretKey(), reportReasonController.delete);

module.exports = route;
