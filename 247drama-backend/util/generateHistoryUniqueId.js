const History = require("../models/history.model");

async function generateHistoryUniqueId(prefix = "HIST") {
  const min = 100000;
  const max = 999999;
  let uniqueId;
  let exists = true;

  while (exists) {
    uniqueId = Math.floor(Math.random() * (max - min + 1)) + min;

    const existingHistory = await History.findOne({ uniqueId });
    exists = !!existingHistory;
  }

  return uniqueId;
}

module.exports = { generateHistoryUniqueId };
