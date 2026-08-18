const User = require("../models/user.model");
const VipPlan = require("../models/vipPlan.model");

const moment = require("moment");

const checkVipPlan = async (userId) => {
  console.log("Checking VIP Plan for User ID:", userId);

  const user = await User.findById(userId);
  if (!user || !user.isVip || !user.vipPlanStartDate) {
    console.log("No VIP plan found or already expired.");
    return user;
  }

  const vipPlan = user?.currentPlan;

  if (user.isVip && user.vipPlanStartDate !== null) {
    if (vipPlan.validityType.toLowerCase() === "day") {
      const currentTime = moment().toISOString(); // Get current time in ISO 8601 format
      const diffTime = moment(currentTime).diff(moment(user.vipPlanStartDate), "day");

      console.log("Current Time:           ", currentTime);
      console.log("Start Time of Plan:     ", user.vipPlanStartDate);
      console.log("Difference in day:      ", diffTime);

      if (diffTime > vipPlan.validity) {
        console.log("Plan has expired!");

        user.isVip = false;
        user.vipPlanStartDate = null;
        user.vipPlanEndDate = null;
        user.currentPlan = {
          validity: 1,
          validityType: "",
          price: 0,
          offerPrice: 0,
          tags: "",
        };
      } else {
        console.log("Plan is still active.");
      }
    }

    if (vipPlan.validityType.toLowerCase() === "month") {
      const currentTime = moment().toISOString(); // Get current time in ISO 8601 format
      const diffTime = moment(currentTime).diff(moment(user.vipPlanStartDate), "month");

      console.log("Current Time:           ", currentTime);
      console.log("Start Time of Plan:     ", user.vipPlanStartDate);
      console.log("Difference in day:      ", diffTime);

      if (diffTime > vipPlan.validity) {
        console.log("Plan has expired!");

        user.isVip = false;
        user.vipPlanStartDate = null;
        user.vipPlanEndDate = null;
        user.currentPlan = {
          validity: 1,
          validityType: "",
          price: 0,
          offerPrice: 0,
          tags: "",
        };
      } else {
        console.log("Plan is still active.");
      }
    }

    if (vipPlan.validityType.toLowerCase() === "year") {
      const currentTime = moment().toISOString(); // Get current time in ISO 8601 format
      const diffTime = moment(currentTime).diff(moment(user.vipPlanStartDate), "year");

      console.log("Current Time:           ", currentTime);
      console.log("Start Time of Plan:     ", user.vipPlanStartDate);
      console.log("Difference in day:      ", diffTime);

      if (diffTime > vipPlan.validity) {
        console.log("Plan has expired!");

        user.isVip = false;
        user.vipPlanStartDate = null;
        user.vipPlanEndDate = null;
        user.currentPlan = {
          validity: 1,
          validityType: "",
          price: 0,
          offerPrice: 0,
          tags: "",
        };
      } else {
        console.log("Plan is still active.");
      }
    }
  }

  await user.save();
  return user;
};

module.exports = { checkVipPlan };
