const express = require("express");
const route = express.Router();

const NotificationController = require("../../controllers/admin/notification.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//send notification
route.post("/", checkAccessWithSecretKey(), NotificationController.sendNotifications);

module.exports = route;
