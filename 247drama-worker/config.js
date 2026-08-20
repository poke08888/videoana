require("dotenv").config();
const path = require("path");

const ALL_PROVIDERS = ["hg", "hm", "dl"];

// "hm" -> ["hm"]; "hg,hm" -> cả hai; rỗng/sai -> cả hai (đừng để máy đứng im vì gõ nhầm).
function parseProviders(raw) {
  const list = String(raw || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => ALL_PROVIDERS.includes(x));
  return list.length ? [...new Set(list)] : [...ALL_PROVIDERS];
}

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
  // Nguồn phim máy này nhận: "hg", "hm", hoặc cả hai (mặc định). Chạy nhiều máy thì chia
  // nguồn ra để hai máy không cùng kéo phim hm qua một IP VPS — CDN Trung Quốc bóp băng
  // thông theo IP, chia đôi luồng chỉ làm cả hai cùng chậm.
  providers: parseProviders(process.env.WORKER_PROVIDERS),
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

// Ngôn ngữ hợp lệ: chỉ nhận mã đã có quy tắc nghiệm thu, bỏ trùng, giữ thứ tự.
// Ngôn ngữ chính luôn đứng đầu để render.js và autosub biết track nào bắt buộc.
function buildLangs(s) {
  const { isSupported } = require("./util/langRules");
  const primary = s.targetLang || "vi";
  const raw = Array.isArray(s.langs) && s.langs.length ? s.langs : [primary, s.secondLang || "en"];
  const out = [];
  for (const code of [primary, ...raw]) {
    const c = String(code || "").trim().toLowerCase();
    if (c && isSupported(c) && !out.includes(c)) out.push(c);
  }
  return out;
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
    // Danh sách ngôn ngữ phụ đề rời, phần tử ĐẦU là ngôn ngữ chính (cũng là ngôn ngữ burn).
    // Đọc từ settingJSON.subtitle.langs; thiếu thì giữ hành vi cũ (chính + secondLang).
    langs: buildLangs(s),
  };
}

// Key phụ đề trên R2: cùng tên file video, thêm số phiên bản rồi tới ngôn ngữ.
// Phiên bản để render lại KHÔNG ghi đè bộ .vtt cũ: bản ghi Mongo (ghi sau cùng) luôn trỏ
// vào một bộ file nhất quán, không bao giờ có cảnh video mới nằm cạnh sub cũ.
function buildSubKey(provider, sourceId, index, lang, version = 1) {
  const v = Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;
  return buildR2Key(provider, sourceId, index).replace(/\.mp4$/, `.v${v}.${lang}.vtt`);
}

function buildSubUrl(provider, sourceId, index, lang, version = 1) {
  const base = process.env.R2_PUBLIC_BASE || env.r2.publicBase || "";
  return `${base}/${buildSubKey(provider, sourceId, index, lang, version)}`;
}

module.exports = {
  parseProviders, env, buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig, buildSubKey, buildSubUrl };
