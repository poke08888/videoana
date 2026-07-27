const mongoose = require("mongoose");
const { env } = require("./config");

const MovieSeries = require("./models/movieSeries.model");
const ShortVideo = require("./models/shortVideo.model");
const Setting = require("./models/setting.model");

async function connect() {
  if (!env.mongoUri) throw new Error("Thiếu MongoDb_Connection_String trong .env");
  await mongoose.connect(env.mongoUri);
}

// Nạp Setting -> gán global.settingJSON (các module pipeline đọc từ đây). Inject ocrThreads để giới hạn luồng OCR.
async function loadSettings() {
  const s = await Setting.findOne({}).lean();
  if (!s) throw new Error("Không đọc được Setting từ Mongo");
  s.subtitle = s.subtitle || {};
  if (env.ocrThreads > 0) s.subtitle.ocrThreads = env.ocrThreads;
  global.settingJSON = s;
  return s;
}

module.exports = { connect, loadSettings, mongoose, MovieSeries, ShortVideo, Setting };
