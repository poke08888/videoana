const express = require("express");
const route = express.Router();

const AdminMiddleware = require("../../middleware/admin.middleware");
const AdminController = require("../../controllers/admin/admin.controller");

route.post("/create", AdminController.store);
route.post("/login", AdminController.login);
route.get("/getProfile", AdminMiddleware, AdminController.getProfile);
route.put("/updateProfile", AdminMiddleware, AdminController.updateProfile);
route.post("/forgotPassword", AdminController.forgotPassword);
route.put("/updatePassword", AdminMiddleware, AdminController.updatePassword);
route.post("/setPassword", AdminMiddleware, AdminController.setPassword);

module.exports = route;
