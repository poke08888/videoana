const express = require("express");
const route = express.Router();

const { opsAuth } = require("../../util/opsAuth");
const ops = require("../../controllers/ops/ops.controller");

route.get("/ping", opsAuth(), ops.ping);
route.get("/options", opsAuth(), ops.options);
route.get("/catalog", opsAuth(), ops.catalog);
route.get("/detail", opsAuth(), ops.detail);
route.post("/import", opsAuth(), ops.importSeries);
route.get("/queue", opsAuth(), ops.queue);
route.get("/health", opsAuth(), ops.health);
route.post("/sub-position", opsAuth(), ops.setSubPosition);

module.exports = route;
