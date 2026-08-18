const VipPlan = require("../../models/vipPlan.model");

//import model
const VipPlanHistory = require("../../models/vipPlanHistory.model");

//mongoose
const mongoose = require("mongoose");

//create vipPlan
exports.storeVipPlan = async (req, res) => {
  try {
    const { validity, validityType, price, offerPrice, tags, productKey } = req.body;

    if (!validity || !validityType || !price || !offerPrice || !tags || !productKey) {
      return res.status(200).json({ status: false, message: "All required fields must be provided." });
    }

    const vipPlan = new VipPlan({
      validity,
      validityType,
      price,
      offerPrice,
      tags,
      productKey,
      isActive: true,
    });

    await vipPlan.save();

    return res.status(201).json({
      status: true,
      message: "VIP plan created successfully.",
      data: vipPlan,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//update vipPlan
exports.updateVipPlan = async (req, res) => {
  try {
    if (!req.body.vipPlanId) {
      return res.status(200).json({ status: false, message: "vipPlanId must be needed." });
    }

    const vipplan = await VipPlan.findById(req.body.vipPlanId);
    if (!vipplan) {
      return res.status(200).json({ status: false, message: "VIP plan does not found." });
    }

    vipplan.validity = req.body.validity ? Number(req.body.validity) : vipplan.validity;
    vipplan.validityType = req.body.validityType ? req.body.validityType : vipplan.validityType;
    vipplan.tags = req.body.tags ? req.body.tags : vipplan.tags;
    vipplan.price = req.body.price ? Number(req.body.price) : vipplan.price;
    vipplan.offerPrice = req.body.offerPrice ? Number(req.body.offerPrice) : vipplan.offerPrice;
    vipplan.productKey = req.body.productKey ? req.body.productKey : vipplan.productKey;

    await vipplan.save();

    return res.status(200).json({
      status: true,
      message: "VIP plan updated Successfully",
      data: vipplan,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//handle isActive switch
exports.isActiveOrNot = async (req, res) => {
  try {
    if (!req.query.vipPlanId) {
      return res.status(200).json({ status: false, message: "vipPlanId must be needed." });
    }

    const vipplan = await VipPlan.findById(req.query.vipPlanId);
    if (!vipplan) {
      return res.status(200).json({ status: false, message: "VIP plan does not found." });
    }

    vipplan.isActive = !vipplan.isActive;
    await vipplan.save();

    return res.status(200).json({
      status: true,
      message: "VIP plan updated Successfully",
      data: vipplan,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//get vipPlan
exports.retriveVipPlan = async (req, res) => {
  try {
    const vipPlan = await VipPlan.find().sort({ price: 1, offerPrice: 1 }).lean();

    return res.status(200).json({
      status: true,
      message: "Retrive VIP plan Successfully",
      data: vipPlan,
    });
  } catch {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};

//get user's vipPlan order histories
exports.fetchVipPlanHistory = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate) {
      return res.status(200).json({ status: false, message: "Oops! Invalid details!" });
    }

    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const search = req.query.search ? req.query.search.trim() : null;
    const paymentGateway = req.query.paymentGateway?.trim() ? req.query.paymentGateway?.trim() : "";

    let dateFilterQuery = {};
    if (req?.query?.startDate !== "All" && req?.query?.endDate !== "All") {
      const startDate = new Date(req?.query?.startDate);
      const endDate = new Date(req?.query?.endDate);
      endDate.setHours(23, 59, 59, 999);

      dateFilterQuery.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    //Add userId filter if provided
    if (req.query.userId) {
      dateFilterQuery.userId = new mongoose.Types.ObjectId(req.query.userId);
    }

    let searchMatch = {};

    if (search) {
      searchMatch = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { userUniqueId: { $regex: search, $options: "i" } },
          { uniqueId: { $regex: search, $options: "i" } },
          { paymentGateway: { $regex: search, $options: "i" } },
        ],
      };
    }

    const matchQuery = {
      ...dateFilterQuery,
    };

    if (paymentGateway && paymentGateway?.toLowerCase() !== "all") {
      matchQuery.paymentGateway = paymentGateway;
    }

    const [totalHistory, history] = await Promise.all([
      VipPlanHistory.countDocuments(matchQuery),
      VipPlanHistory.aggregate([
        {
          $match: matchQuery,
        },
        {
          $lookup: {
            from: "users",
            let: { userId: "$userId" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$userId"] },
                },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  username: 1,
                  isVerified: 1,
                  uniqueId: 1,
                  profilePic: 1,
                },
              },
            ],
            as: "user",
          },
        },
        {
          $unwind: { path: "$user", preserveNullAndEmptyArrays: false },
        },
        {
          $project: {
            _id: 1,
            userId: "$user._id",
            name: "$user.name",
            username: "$user.username",
            isVerified: "$user.isVerified",
            userUniqueId: "$user.uniqueId",
            profilePic: "$user.profilePic",
            paymentGateway: 1,
            price: 1,
            offerPrice: 1,
            uniqueId: 1,
            date: 1,
            createdAt: 1,
          },
        },
        ...(search ? [{ $match: searchMatch }] : []),
        { $sort: { createdAt: -1 } },
        { $skip: (start - 1) * limit },
        { $limit: limit },
      ]),
    ]);

    return res.status(200).json({
      status: true,
      message: "Success",
      totalHistory,
      history,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
