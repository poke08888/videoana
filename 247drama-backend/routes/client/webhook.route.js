const express = require("express");
const route = express.Router();
const WebhookController = require("../../controllers/client/webhook.controller");

route.post("/branch", WebhookController.handleBranchWebhook);

module.exports = route;
