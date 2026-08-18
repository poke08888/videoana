const express = require("express");
const route = express.Router();

//checkAccessWithSecretKey
const checkAccessWithSecretKey = require("../../checkAccess");

//controller
const currencyController = require("../../controllers/admin/currency.controller");

//create currency
route.post("/create", checkAccessWithSecretKey(), currencyController.store);

//update currency
route.put("/update", checkAccessWithSecretKey(), currencyController.update);

//get all currencies
route.get("/fetchCurrency", checkAccessWithSecretKey(), currencyController.fetchCurrency);

//delete currency
route.delete("/delete", checkAccessWithSecretKey(), currencyController.destroy);

//set default currency
route.put("/setdefault", checkAccessWithSecretKey(), currencyController.setdefault);

//get default currency
route.get("/getDefault", checkAccessWithSecretKey(), currencyController.getDefault);

module.exports = route;
