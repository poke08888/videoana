const AdRewardCoin = require("../../models/adRewardCoin.model");

//create ad reward
exports.storeAdReward = async (req, res) => {
  try {
    if (!req.body) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    if (!settingJSON) {
      return res.status(200).json({ status: false, message: "Setting does not found." });
    }

    const totalAdReward = await AdRewardCoin.countDocuments();

    if (totalAdReward > 0 && totalAdReward >= settingJSON.maxAdPerDay) {
      return res.status(200).json({
        status: false,
        message: `You have already created the maximum ${settingJSON.maxAdPerDay} ads.`,
      });
    }

    const adReward = new AdRewardCoin();
    adReward.adLabel = req.body.adLabel.trim();
    adReward.adDisplayInterval = parseInt(req.body.adDisplayInterval);
    adReward.coinEarnedFromAd = parseInt(req.body.coinEarnedFromAd);
    await adReward.save();

    return res.status(200).json({
      status: true,
      message: "AdRewardCoin create Successfully",
      data: adReward,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//update ad reward
exports.updateAdReward = async (req, res) => {
  try {
    if (!req.body.adRewardId) {
      return res.status(200).json({ status: false, message: "adRewardId must be needed." });
    }

    const adReward = await AdRewardCoin.findOne({ _id: req.body.adRewardId });
    if (!adReward) {
      return res.status(200).json({ status: false, message: "adReward not found." });
    }

    adReward.adLabel = req.body.adLabel ? req.body.adLabel.trim() : adReward.adLabel;
    adReward.adDisplayInterval = req.body.adDisplayInterval ? parseInt(req.body.adDisplayInterval) : adReward.adDisplayInterval;
    adReward.coinEarnedFromAd = req.body.coinEarnedFromAd ? parseInt(req.body.coinEarnedFromAd) : adReward.coinEarnedFromAd;
    await adReward.save();

    return res.status(200).json({
      status: true,
      message: "AdRewardCoin update Successfully",
      data: adReward,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//get ad reward
exports.getAdReward = async (req, res) => {
  try {
    const adReward = await AdRewardCoin.find().sort({ coinEarnedFromAd: 1 }).lean();

    return res.status(200).json({
      status: true,
      message: "Retrive AdRewardCoin Successfully",
      data: adReward,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//delete ad reward
exports.deleteAdReward = async (req, res) => {
  try {
    if (!req.query.adRewardId) {
      return res.status(200).json({ status: false, message: "adRewardId must be needed." });
    }

    const adReward = await AdRewardCoin.findOne({ _id: req.query.adRewardId });
    if (!adReward) {
      return res.status(200).json({ status: false, message: "adReward not found." });
    }

    await adReward.deleteOne();

    return res.status(200).json({
      status: true,
      message: "AdRewardCoin delete Successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};
