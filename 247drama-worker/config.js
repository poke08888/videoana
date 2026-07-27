require("dotenv").config();
const path = require("path");

const workDir = process.env.WORK_DIR || "/Volumes/BINGNET/247drama-render";

const env = {
  mongoUri: process.env.MongoDb_Connection_String,
  baseUrl: process.env.baseURL || "http://103.179.185.196",
  workDir,
  downloadDir: path.join(workDir, "download"),
  tmpDir: path.join(workDir, "tmp"),
  outputDir: path.join(workDir, "output"),
  ocrPython: process.env.OCR_PYTHON,
  concurrency: Math.max(1, parseInt(process.env.RENDER_CONCURRENCY) || 4),
  ocrThreads: Math.max(0, parseInt(process.env.OCR_THREADS) || 3),
  keepOriginal: process.env.KEEP_ORIGINAL !== "0",
  server: {
    host: process.env.SERVER_HOST,
    user: process.env.SERVER_USER,
    password: process.env.SERVER_PASSWORD,
    uploadsPath: process.env.SERVER_UPLOADS,
  },
};

// Tên file phẳng, KHỚP đúng uploadBufferToStorage local của server.
function buildFilename(provider, sourceId, index) {
  return `${provider}_${sourceId}_ep${index}.mp4`;
}

// URL công khai KHỚP đúng bản server tạo (storage=local).
function buildVideoUrl(provider, sourceId, index) {
  const base = process.env.baseURL || env.baseUrl;
  return `${base}/uploads/${buildFilename(provider, sourceId, index)}`;
}

// Khớp getSubtitleConfig() của server (controllers/admin/movieSeries.controller.js).
function buildSubtitleConfig(settingJSON) {
  const s = (settingJSON && settingJSON.subtitle) || {};
  return {
    apiKey: s.geminiApiKey || "",
    geminiModel: s.geminiModel || "gemini-2.5-flash",
    whisperModel: s.whisperModel || "medium",
    whisperCpuThreads: s.whisperCpuThreads || 4,
    sourceLang: s.sourceLang || "zh",
    targetLang: s.targetLang || "vi",
    translateBatchSize: s.translateBatchSize || 20,
    coverBoxYRatio: typeof s.coverBoxYRatio === "number" ? s.coverBoxYRatio : 0.66,
    coverBoxHeightRatio: typeof s.coverBoxHeightRatio === "number" ? s.coverBoxHeightRatio : 0.17,
    coverBoxColor: s.coverBoxColor || "white@1",
    coverEnabled: s.coverEnabled !== false,
  };
}

module.exports = { env, buildFilename, buildVideoUrl, buildSubtitleConfig };
