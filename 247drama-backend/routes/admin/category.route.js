const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const categoryController = require("../../controllers/admin/category.controller");

//create category
route.post("/createCategory", checkAccessWithSecretKey(), categoryController.createCategory);

//update category
route.put("/updateCategory", checkAccessWithSecretKey(), categoryController.updateCategory);

//toggle active Status
route.put("/modifyActiveState", checkAccessWithSecretKey(), categoryController.modifyActiveState);

//get category
route.get("/fetchCategory", checkAccessWithSecretKey(), categoryController.fetchCategory);

//get category ( dropdown )
route.get("/getFilmCategoryOptions", checkAccessWithSecretKey(), categoryController.getFilmCategoryOptions);

//delete category
route.delete("/deleteCategory", checkAccessWithSecretKey(), categoryController.deleteCategory);

module.exports = route;
