const express = require("express");
const route = express.Router();

const LoginController = require("../../controllers/admin/login.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//get login or not
route.get("/fetchLoginOrNot", checkAccessWithSecretKey(), LoginController.fetchLoginOrNot);

module.exports = route;
