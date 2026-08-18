const CoinPlan = require("../../models/coinplan.model");

//import models
const User = require("../../models/user.model");
const History = require("../../models/history.model");
const CoinPlanHistory = require("../../models/coinplanHistory.model");

//mongoose
const mongoose = require("mongoose");

//moment
const moment = require("moment");

//generate OrderHistory UniqueId
const { generateOrderHistoryUniqueId } = require("../../util/generateOrderHistoryUniqueId");
const { verifyGooglePlayPurchase } = require("../../util/googlePlayVerification");



//get coinPlan
exports.fetchCoinplanByUser = async (req, res) => {
  try {
    const coinPlan = await CoinPlan.find({ isActive: true }).sort({ coin: 1, amount: 1 }).lean();

    return res.status(200).json({
      status: true,
      message: "Retrive CoinPlan Successfully",
      data: coinPlan,
    });
  } catch {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//when user purchase the coinPlan create coinPlan history by user
exports.recordCoinPlanHistory = async (req, res) => {
  try {
    if (!req.query.userId || !req.query.coinPlanId || !req.query.paymentGateway) {
      return res.json({ status: false, message: "Oops ! Invalid details." });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const coinPlanObjectId = new mongoose.Types.ObjectId(req.query.coinPlanId);
    const paymentGateWay = req.query.paymentGateway.trim();
    const purchaseToken = req.query.purchaseToken ? req.query.purchaseToken.trim() : "";
    const productId = req.query.productId ? req.query.productId.trim() : "";

    // Verify Google Play Receipt if paymentGateway is in_app_purchase
    if (paymentGateWay === "in_app_purchase") {
      if (!purchaseToken || !productId) {
         return res.json({ status: false, message: "Missing purchase token or product id for IAP validation." });
      }

      // Check if token already used
      const existingHistory = await CoinPlanHistory.findOne({ purchaseToken: purchaseToken });
      if (existingHistory) {
         return res.json({ status: false, message: "Purchase token already used. Potential replay attack." });
      }

      // Verify with Google Play
      const packageName = "com.incodes.storybox"; // Replace with your actual app package name if different
      const isValid = await verifyGooglePlayPurchase(packageName, productId, purchaseToken);
      
      if (!isValid) {
         return res.json({ status: false, message: "Invalid purchase receipt from Google Play." });
      }
    }

    const [orderHistoryUniqueId, user, coinPlan] = await Promise.all([
      generateOrderHistoryUniqueId(),
      User.findOne({ _id: userId }).select("_id isBlock").lean(),
      CoinPlan.findOne({ _id: coinPlanObjectId }).lean(),
    ]);

    if (!user) {
      return res.status(200).json({ status: false, message: "User does not found." });
    }

    if (user.isBlock) {
      return res.status(200).json({ status: false, message: "you are blocked by admin!" });
    }

    if (!coinPlan) {
      return res.status(200).json({ status: false, message: "CoinPlan does not found." });
    }

    const newCoinPlan = {
      coin: coinPlan.coin,
      bonusCoin: coinPlan?.bonusCoin || 0,
      price: coinPlan.price,
      offerPrice: coinPlan?.offerPrice || 0,
      purchasedAt: new Date(),
    };

    const totalCoins = coinPlan?.coin + coinPlan?.bonusCoin || 0;

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      {
        $inc: {
          coin: totalCoins,
          purchasedCoin: totalCoins,
        },
        $push: {
          coinplan: newCoinPlan,
        },
      },
      { new: true },
    );

    if (updatedUser) {
      console.log("User successfully purchased new coin plan");
    } else {
      console.error("User not found or update failed");
    }

    res.status(200).json({
      status: true,
      message: "When user purchase the coinPlan created coinPlan history!",
      userCoin: updatedUser?.coin || 0,
    });

    const coinplanPurHistory = new CoinPlanHistory();
    coinplanPurHistory.uniqueId = orderHistoryUniqueId;
    coinplanPurHistory.userId = user._id;
    coinplanPurHistory.coinplanId = coinPlan._id;
    coinplanPurHistory.coin = coinPlan?.coin || 0;
    coinplanPurHistory.bonusCoin = coinPlan?.bonusCoin || 0;
    coinplanPurHistory.price = coinPlan.price;
    coinplanPurHistory.offerPrice = coinPlan.offerPrice;
    coinplanPurHistory.paymentGateway = paymentGateWay;
    if (purchaseToken) coinplanPurHistory.purchaseToken = purchaseToken;
    if (productId) coinplanPurHistory.productId = productId;
    coinplanPurHistory.date = moment(moment().toISOString()).local().format("YYYY-MM-DD hh:mm:ss A"); //2024-11-11 04:45:30 PM;

    await Promise.all([
      coinplanPurHistory.save(),
      History.create({
        userId: user._id,
        coin: totalCoins,
        price: coinPlan?.price,
        offerPrice: coinPlan?.offerPrice,
        paymentGateway: paymentGateWay,
        purchaseToken: purchaseToken || undefined,
        productId: productId || undefined,
        uniqueId: orderHistoryUniqueId,
        type: 5,
        date: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
      }),
    ]);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};


