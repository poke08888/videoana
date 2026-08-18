const Report = require("../../models/report.model");

//import model
const ShortVideo = require("../../models/shortVideo.model");
const UserVideoList = require("../../models/userVideoList.model");
const User = require("../../models/user.model");

//deleteFromStorage
const { deleteFromStorage } = require("../../util/storageHelper");

//private key
const admin = require("../../util/privateKey");

//fetch reports
exports.getReports = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate || !req.query.type || !req.query.status) {
      return res.status(200).json({ status: false, message: "Oops ! Invalid details." });
    }

    const start = req.query.start ? parseInt(req.query.start) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const type = parseInt(req.query.type);

    let dateFilterQuery = {};
    if (req?.query?.startDate !== "All" && req?.query?.endDate !== "All") {
      const startDate = new Date(req.query.startDate);
      const endDate = new Date(req.query.endDate);
      endDate.setHours(23, 59, 59, 999);

      dateFilterQuery = {
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      };
    }

    let statusQuery = {};
    if (req.query.status !== "All") {
      statusQuery.status = parseInt(req.query.status);
    }

    if (type == 1) {
      const [totalReports, report] = await Promise.all([
        Report.countDocuments({ ...statusQuery, ...dateFilterQuery, type: 1 }),
        Report.aggregate([
          {
            $match: { ...statusQuery, ...dateFilterQuery, type: 1 },
          },
          {
            $lookup: {
              from: "users",
              localField: "userId",
              foreignField: "_id",
              as: "user",
            },
          },
          {
            $unwind: {
              path: "$user",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $match: {
              "user.isBlock": false,
            },
          },
          {
            $lookup: {
              from: "shortvideos",
              localField: "videoId",
              foreignField: "_id",
              as: "video",
            },
          },
          {
            $unwind: {
              path: "$video",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              type: 1,
              status: 1,
              reportReason: 1,
              createdAt: 1,
              name: "$user.name",
              username: "$user.username",
              uniqueId: "$user.uniqueId",
              videoImage: "$video.videoImage",
              videoUrl: "$video.videoUrl",
              uniqueVideoId: "$video.uniqueVideoId",
              videoId: "$video._id",
            },
          },
          { $sort: { createdAt: -1 } },
          { $skip: (start - 1) * limit },
          { $limit: limit },
        ]),
      ]);

      return res.status(200).json({
        status: true,
        message: "Retrive short videos's reports.",
        total: totalReports || 0,
        data: report.length > 0 ? report : [],
      });
    } else {
      return res.status(200).json({ status: false, message: "type must be passed valid." });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};

//report solved
exports.solveReport = async (req, res) => {
  try {
    if (!req.query.reportId) {
      return res.status(200).json({ status: false, message: "reportId must be requried." });
    }

    const report = await Report.findById(req.query.reportId);
    if (!report) {
      return res.status(200).json({ status: false, message: "report does not found." });
    }

    if (report.status == 2) {
      return res.status(200).json({ status: false, message: "report already solved by the admin." });
    }

    report.status = 2;
    await report.save();

    res.status(200).send({
      status: true,
      message: "Report has been solved by the admin.",
      data: report,
    });

    const user = await User.findById(report.userId).select("_id isBlock fcmToken");
    if (!user.isBlock && user.fcmToken && user.fcmToken !== null) {
      const adminPromise = await admin;

      const payload = {
        token: user.fcmToken,
        notification: {
          title: "📢 Great News! Your Report Has Been Resolved ✅",
          body: "🚀 Thanks for reporting! We've reviewed and fixed the issue in the short video. Keep enjoying seamless content! 🎥✨",
        },
        data: {
          type: "REPORT_SOLVED",
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
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};

//delete report
exports.deleteReport = async (req, res) => {
  try {
    if (!req.query.reportId) {
      return res.status(200).json({ status: false, message: "reportId must be requried." });
    }

    const report = await Report.findById(req.query.reportId);
    if (!report) {
      return res.status(200).json({ status: false, message: "report does not found." });
    }

    res.status(200).json({
      status: true,
      message: "Report has been deleted.",
    });

    if (report.videoId !== null) {
      const video = await ShortVideo.findById(report?.videoId);

      await Promise.all([
        video.videoImage ? deleteFromStorage(video.videoImage) : null,
        video.videoUrl ? deleteFromStorage(video.videoUrl) : null,
        UserVideoList.updateMany({ "videos.videoId": video._id }, { $pull: { videos: { videoId: video._id } } }),
      ]);

      await ShortVideo.deleteOne({ _id: video._id });
    }

    await report.deleteOne();
  } catch {
    console.log(error);
    return res.status(500).json({ status: false, message: error.message || "Internal Server Error" });
  }
};
