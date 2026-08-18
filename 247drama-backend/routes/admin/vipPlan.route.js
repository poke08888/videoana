const express = require("express");
const route = express.Router();

//Controller
const vipPlanController = require("../../controllers/admin/vipPlan.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//create vipplan
route.post("/storeVipPlan", checkAccessWithSecretKey(), vipPlanController.storeVipPlan);

//update vipplan
route.put("/updateVipPlan", checkAccessWithSecretKey(), vipPlanController.updateVipPlan);

//handle isActive switch
route.put("/isActiveOrNot", checkAccessWithSecretKey(), vipPlanController.isActiveOrNot);

//get vipplan
route.get("/retriveVipPlan", checkAccessWithSecretKey(), vipPlanController.retriveVipPlan);

//get user's vipPlan order histories
route.get("/fetchVipPlanHistory", checkAccessWithSecretKey(), vipPlanController.fetchVipPlanHistory);

module.exports = route;
