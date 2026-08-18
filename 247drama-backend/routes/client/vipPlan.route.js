const express = require("express");
const route = express.Router();

//Controller
const vipPlanController = require("../../controllers/client/vipPlan.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//get vipPlan for user (isActive)
route.get("/fetchVipPlanByUser", checkAccessWithSecretKey(), vipPlanController.fetchVipPlanByUser);

//when user purchase the vipPlan create vipPlan history by user
route.post("/recordVipPlanHistory", checkAccessWithSecretKey(), vipPlanController.recordVipPlanHistory);

module.exports = route;
