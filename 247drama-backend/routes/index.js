//express
const express = require("express");
const route = express.Router();

//admin index.js
const admin = require("./admin/route");

//client index.js
const client = require("./client/route");

//ops index.js
const ops = require("./ops/route");

route.use("/admin", admin);
route.use("/client", client);
route.use("/ops", ops);

module.exports = route;
