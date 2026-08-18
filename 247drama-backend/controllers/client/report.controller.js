const Report = require("../../models/report.model");

//import model
const User = require("../../models/user.model");
const ShortVideo = require("../../models/shortVideo.model");
const ReportReason = require("../../models/reportReason.model");

//mongoose
const mongoose = require("mongoose");

//private key
const admin = require("../../util/privateKey");

//report to video by user
exports.reportByUser = async (req, res) => {
  try {
    if (!req.query.userId || !req.query.reportReason || !req.query.type) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    const userId = new mongoose.Types.ObjectId(req.query.userId);
    const videoId = new mongoose.Types.ObjectId(req?.query?.videoId);
    const reportReason = req.query.reportReason?.trim();
    const type = req.query.type?.trim().toLowerCase();

    let existingReport;
    const [user, video] = await Promise.all([User.findOne({ _id: userId }), ShortVideo.findOne({ _id: videoId })]);

    if (type === "video" && !req.query.videoId) {
      return res.status(200).json({ status: false, message: "videoId must be requried report to the video." });
    }

    if (req.query.videoId) {
      if (!video) {
        return res.status(200).json({ status: false, message: "video does not found!" });
      }

      if (!user) {
        return res.status(200).json({ status: false, message: "user does not found!" });
      }

      if (user.isBlock) {
        return res.status(200).json({ status: false, message: "you are blocked by admin!" });
      }

      existingReport = await Report.findOne({
        videoId: video._id,
        userId: user._id,
        type: 1,
      });
    }

    if (existingReport) {
      return res.status(200).json({
        status: false,
        message: `A report has been already submitted.`,
      });
    } else {
      const report = new Report();

      if (req.query.videoId) {
        report.videoId = video._id;
        report.type = 1;
      }

      report.reportReason = reportReason;
      report.userId = user._id;
      await report.save();

      res.status(200).json({
        status: true,
        message: `A report has been submitted by ${user?.name}.`,
      });

      if (!user.isBlock && user.fcmToken && user.fcmToken !== null) {
        const adminPromise = await admin;

        const payload = {
          token: user.fcmToken,
          notification: {
            title: "📝 Report Submitted Successfully! ✅",
            body: "🎯 Thank you for your report! Our team is reviewing the issue 🔍 and will update you soon. Stay awesome! 🚀✨",
          },
          data: {
            type: "REPORT_SUBMITTED",
          },
        };

        adminPromise
          .messaging()
          .send(payload)
          .then((response) => {
            console.log("Successfully sent with response: ", response);
          })
          .catch((error) => {
            console.log("Error sending message: ", error);
          });
      }
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//get reportReason (when report by the user)
exports.getReportReason = async (req, res) => {
  try {
    const reportReason = await ReportReason.find().sort({ createdAt: -1 });

    return res.status(200).json({
      status: true,
      message: "Retrive reportReason Successfully",
      data: reportReason,
    });
  } catch {
    console.error(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server error" });
  }
};
