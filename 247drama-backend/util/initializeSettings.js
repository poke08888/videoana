//import model
const Setting = require("../models/setting.model");

/**
 * Khởi tạo settings từ cơ sở dữ liệu MongoDB.
 * Nếu không tìm thấy document nào, server sẽ chạy với object rỗng
 * và cần admin tạo setting qua trang quản trị.
 */
async function initializeSettings() {
  try {
    const setting = await Setting.findOne().sort({ createdAt: -1 });
    if (setting) {
      global.settingJSON = setting.toObject();
    } else {
      global.settingJSON = {};
      console.warn("⚠️  Không tìm thấy Setting trong DB. Global settingJSON trống. Vui lòng khởi tạo setting từ trang Admin.");
    }
  } catch (error) {
    console.error("❌ Failed to initialize settings:", error);
    if (!global.settingJSON) global.settingJSON = {};
  }
}

// Chạy background job để đồng bộ settingJSON mỗi 30 giây
// Giúp PM2 Cluster Mode (nhiều workers) luôn đồng bộ khi Admin update setting
setInterval(initializeSettings, 30 * 1000);

module.exports = initializeSettings; // Export the function, not the call
