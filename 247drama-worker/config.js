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
  r2: {
    endpoint: process.env.R2_ENDPOINT,
    accessKey: process.env.R2_ACCESS_KEY,
    secret: process.env.R2_SECRET,
    bucket: process.env.R2_BUCKET,
    publicBase: process.env.R2_PUBLIC_BASE,
    keyPrefix: process.env.R2_KEY_PREFIX || "videos",
  },
};

// Tên file phẳng, KHỚP đúng uploadBufferToStorage local của server.
function buildFilename(provider, sourceId, index) {
  return `${provider}_${sourceId}_ep${index}.mp4`;
}

// Key trên R2: <prefix>/<filename>. Server + worker dùng chung scheme.
function buildR2Key(provider, sourceId, index) {
  const prefix = process.env.R2_KEY_PREFIX || "videos";
  return `${prefix}/${buildFilename(provider, sourceId, index)}`;
}

// URL công khai đọc từ R2 (r2.dev hoặc custom domain sau này).
function buildVideoUrl(provider, sourceId, index) {
  const base = process.env.R2_PUBLIC_BASE || env.r2.publicBase || "";
  return `${base}/${buildR2Key(provider, sourceId, index)}`;
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
    // "burn" (mặc định) = đốt phụ đề Việt vào video như cũ.
    // "soft" = video sạch + 2 file .vtt (vi/en) rời -> app chọn theo quốc gia.
    mode: s.mode === "soft" ? "soft" : "burn",
    secondLang: s.secondLang || "en",
  };
}

module.exports = { env, buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig };
