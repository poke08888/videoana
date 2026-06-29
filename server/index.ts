/**
 * server/index.ts — backend Nonelab Studio.
 *
 *  POST /api/analyze       (multipart) — mổ xẻ 1 video bằng Gemini, trả JSON phiếu mổ xẻ
 *  POST /api/gemini/test   (json)      — kiểm tra kết nối API key
 *  GET  /api/health
 *
 * Key Gemini: ưu tiên key người dùng gửi lên (từ màn Quản trị), sau đó tới
 * biến môi trường GEMINI_API_KEY trong .env.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeVideo, testConnection, humanizeError } from "./gemini.js";
import { DEFAULT_MODEL, type AnalyzeForm } from "./nonelabPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function resolveKey(reqKey?: string): string | null {
  const k = (reqKey || "").trim();
  if (k.length >= 10) return k;
  const env = (process.env.GEMINI_API_KEY || "").trim();
  return env.length >= 10 ? env : null;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: DEFAULT_MODEL, hasEnvKey: !!(process.env.GEMINI_API_KEY || "").trim() });
});

app.post("/api/gemini/test", async (req, res) => {
  const key = resolveKey(req.body?.apiKey);
  if (!key) return res.status(400).json({ ok: false, message: "Chưa có API key (nhập key hoặc đặt GEMINI_API_KEY trong .env)." });
  const result = await testConnection(key, req.body?.model);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/analyze", upload.single("video"), async (req, res) => {
  const file = req.file;
  const cleanup = () => {
    if (file?.path) fs.promises.unlink(file.path).catch(() => {});
  };
  try {
    const apiKey = resolveKey(req.body?.apiKey);
    const model = req.body?.model || DEFAULT_MODEL;
    const youtubeUrl = (req.body?.youtubeUrl || "").trim() || undefined;

    let form: AnalyzeForm = {};
    if (req.body?.form) {
      try {
        form = JSON.parse(req.body.form);
      } catch {
        /* ignore */
      }
    } else {
      form = {
        title: req.body?.title,
        platform: req.body?.platform,
        product: req.body?.product,
        genre: req.body?.genre,
        notes: req.body?.notes,
      };
    }

    if (!apiKey) {
      cleanup();
      return res.status(400).json({ ok: false, error: "no-key", message: "Chưa kết nối Gemini API. Vào Quản trị nhập API key, hoặc đặt GEMINI_API_KEY trong .env." });
    }

    const analysis = await analyzeVideo({
      apiKey,
      model,
      form,
      videoPath: file?.path,
      mimeType: file?.mimetype || "video/mp4",
      youtubeUrl,
    });

    cleanup();
    res.json({ ok: true, analysis, usedAI: true, watchedVideo: !!(file || youtubeUrl), model });
  } catch (err: any) {
    cleanup();
    res.status(502).json({ ok: false, error: "gemini-failed", message: humanizeError(err) });
  }
});

// Phục vụ frontend đã build trong production
if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[nonelab] backend chạy ở http://localhost:${PORT}  (model mặc định: ${DEFAULT_MODEL})`);
  if (!(process.env.GEMINI_API_KEY || "").trim()) {
    console.log("[nonelab] Chưa có GEMINI_API_KEY trong .env — người dùng cần nhập key ở màn Quản trị.");
  }
});
