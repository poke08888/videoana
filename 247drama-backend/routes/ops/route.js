const express = require("express");
const route = express.Router();

const { opsAuth } = require("../../util/opsAuth");
const ops = require("../../controllers/ops/ops.controller");

route.get("/ping", opsAuth(), ops.ping);
route.get("/options", opsAuth(), ops.options);

module.exports = route;
