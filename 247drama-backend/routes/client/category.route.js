const express = require("express");
const route = express.Router();

//Controller
const categoryController = require("../../controllers/client/category.controller");

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//get category
route.get("/listCategory", checkAccessWithSecretKey(), categoryController.listCategory);

//get category wise movies or series
route.get("/fetchGenreBasedMediaContent", checkAccessWithSecretKey(), categoryController.fetchGenreBasedMediaContent);

module.exports = route;
