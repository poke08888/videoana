const User = require("../../models/user.model");
const admin = require("../../util/privateKey");

//send notification
exports.sendNotifications = async (req, res) => {
  try {
    const userFCM = await User.find({ isBlock: false }).distinct("fcmToken");
    const validTokens = userFCM.filter((token) => token && typeof token === "string" && token.trim() !== "");

    if (validTokens.length > 0) {
      const payload = {
        message: {
          tokens: validTokens,
          notification: {
            title: req.body.title || "Default Title",
            body: req.body.description || "Default Message",
            image: req.body.image || "",
          },
          data: {
            image: String(req.body.image || ""),
          },
        },
      };

      try {
        const adminPromise = await admin;

        const BATCH_SIZE = 500;
        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < validTokens.length; i += BATCH_SIZE) {
          const batchTokens = validTokens.slice(i, i + BATCH_SIZE);

          try {
            const response = await adminPromise.messaging().sendEachForMulticast({
              tokens: batchTokens,
              notification: payload.message.notification,
            });

            successCount += response.successCount;
            failureCount += response.failureCount;

            if (response.failureCount > 0) {
              response.responses.forEach((res, index) => {
                if (!res.success) {
                  console.error(`Error for token ${batchTokens[index]}:`, res.error.message);
                }
              });
            }
          } catch (error) {
            console.error("Batch send error:", error);
          }
        }

        console.log("Total Success:", successCount);
        console.log("Total Failure:", failureCount);
      } catch (error) {
        console.error("Error sending message:", error);
      }
    } else {
      console.error("Invalid or empty FCM token array.");
    }

    return res.status(200).json({ status: true, message: "Success" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ status: false, error: error.message || "Internal Server Error" });
  }
};
