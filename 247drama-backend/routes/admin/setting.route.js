//express
const express = require("express");
const route = express.Router();

//controller
const settingController = require("../../controllers/admin/setting.controller");

const AdminMiddleware = require("../../middleware/admin.middleware");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//get setting
route.get("/fetchSettingByAdmin", checkAccessWithSecretKey(), AdminMiddleware, settingController.fetchSettingByAdmin);

//update setting
route.put("/updateSetting", checkAccessWithSecretKey(), AdminMiddleware, settingController.updateSetting);

//handle activation of the switch
route.put("/handleSwitch", checkAccessWithSecretKey(), AdminMiddleware, settingController.handleSwitch);

//handle update storage
route.put("/handleStorageSwitch", checkAccessWithSecretKey(), AdminMiddleware, settingController.handleStorageSwitch);

//fetch selected fields of setting
route.get("/fetchSelectedFieldsOfSetting", settingController.fetchSelectedFieldsOfSetting);


module.exports = route;
