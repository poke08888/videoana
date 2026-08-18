const moment = require("moment");
const CoinPlanHistory = require("../models/coinplanHistory.model");
const VipPlanHistory = require("../models/vipPlanHistory.model");

async function generateOrderHistoryUniqueId() {
  let uniqueId;
  let exists = true;

  while (exists) {
    const date = moment().format("YYYYMMDD");
    uniqueId = `ORDER${date}${Math.floor(1000 + Math.random() * 9000)}`; //ORDER202411076532

    const [existingCoinPlanHistory, existingVipPlanHistory] = await Promise.all([CoinPlanHistory.findOne({ uniqueId }), VipPlanHistory.findOne({ uniqueId })]);

    exists = !!existingCoinPlanHistory || !!existingVipPlanHistory;
  }

  return uniqueId;
}

module.exports = { generateOrderHistoryUniqueId };
