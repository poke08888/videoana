//get setting
exports.retrieveSettingsForUser = async (req, res) => {
  try {
    const Setting = require("../../models/setting.model.js");
    const setting = await Setting.findOne();
    if (!setting) {
      return res.status(200).json({ status: false, message: "Setting does not found." });
    }

    return res.status(200).json({
      status: true,
      message: "Setting fetch Successfully",
      setting: setting,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
