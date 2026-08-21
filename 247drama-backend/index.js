//express
const express = require("express");
const app = express();

//cors
const cors = require("cors");

app.use(cors());
app.use(express.json());

app.set("trust proxy", true);

//logging middleware
const logger = require("morgan");
app.use(logger("dev"));

//compression
const compression = require("compression");
app.use(compression());

//path
const path = require("path");

//dotenv
require("dotenv").config({ path: ".env" });

//Declare global variable
global.settingJSON = {};

// Cập nhật setting trong bộ nhớ (RAM) sau khi save vào MongoDB.
// Không ghi ra file để tránh mất dữ liệu khi restart server.
global.updateSettingJSON = (settingData) => {
  global.settingJSON = settingData.toObject ? settingData.toObject() : settingData;
};


//connection.js
const db = require("./util/connection");

// Step 1: Import initializeSettings
const initializeSettings = require("./util/initializeSettings");

async function startServer() {
  console.log("🔄 Initializing settings...");
  await initializeSettings(); // Ensure settings are loaded before other modules

  console.log("✅ Settings Loaded");

  // Step 2: Require all other modules after settings are initialized
  const routes = require("./routes/index");
  app.use("/api", routes);

  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/.well-known/assetlinks.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(global?.settingJSON?.androidAssetLinks || []);
  });

  app.get("/.well-known/apple-app-site-association", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(global?.settingJSON?.appleAppSiteAssociation || {});
  });

  db.on("error", () => {
    console.log("Connection Error: ");
  });

  db.once("open", async () => {
    console.log("Mongo: successfully connected to db");
  });

  // Step 3: Start Server after all setup is done
  app.listen(process?.env.PORT, () => {
    console.log("Hello World ! listening on " + process.env.PORT);
  });
}

// Run server startup
startServer();

//node-cron
const cron = require("node-cron");

//import model
const User = require("./models/user.model");

// Cổng lên app: chấm lại xem phim nào đã đủ tập, phim nào còn thiếu/còn tập hỏng.
// Chạy ngay lúc khởi động (để cờ đúng ngay sau khi deploy) rồi lặp mỗi 2 phút — máy render
// làm xong tập cuối lúc nào thì phim tự lên app sau đó chậm nhất 2 phút, không cần ai bấm.
const { sweepPublishGate } = require("./util/publishGate");
const MovieSeriesModel = require("./models/movieSeries.model");
const ShortVideoModel = require("./models/shortVideo.model");
async function runPublishGate() {
  try {
    const r = await sweepPublishGate({ MovieSeries: MovieSeriesModel, ShortVideo: ShortVideoModel, log: console.log });
    if (r.changed) console.log(`[cổng app] ${r.published}/${r.checked} phim đủ điều kiện lên app`);
  } catch (e) {
    console.error("[cổng app] chấm lại lỗi:", e.message);
  }
}
// pm2 chạy 4 bản index.js (cluster). Quét cả kho 4 lần một lúc là thừa -> chỉ bản số 0 làm.
const isPrimaryInstance = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === "0";
if (isPrimaryInstance) {
  setTimeout(runPublishGate, 5000);
  cron.schedule("*/2 * * * *", runPublishGate);
}

//this run for update user's daily watch Ads
cron.schedule("0 0 * * *", async () => {
  await User.updateMany(
    {
      "watchAds.count": { $gt: 0 },
      "watchAds.date": { $ne: null },
    },
    {
      $set: {
        "watchAds.count": 0,
        "watchAds.date": null,
      },
    },
  );
});

//this run for update user's daily watch Ads for unlock episodes
cron.schedule("0 0 * * *", async () => {
  try {
    await User.updateMany(
      {
        episodeUnlockAds: { $exists: true, $not: { $size: 0 } },
        "episodeUnlockAds.count": { $gt: 0 },
      },
      {
        $set: {
          "episodeUnlockAds.$[].count": 0,
          "episodeUnlockAds.$[].date": null,
        },
      },
    );
    console.log("Cron job executed: Reset episodeUnlockAds for all users.");
  } catch (error) {
    console.error("Error resetting episodeUnlockAds:", error);
  }
});
