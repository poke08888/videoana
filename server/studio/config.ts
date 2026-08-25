/**
 * server/studio/config.ts — cấu hình Xưởng, đọc từ biến môi trường một lần.
 * Mọi model ID, thư mục, ngưỡng an toàn nằm ở đây — không hard-code chỗ khác.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL } from "../nonelabPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const str = (v: string | undefined, d: string) => (v || "").trim() || d;

export type AspectRatio = "9:16" | "16:9" | "1:1";

export const STUDIO = {
  dataDir: str(process.env.STUDIO_DATA_DIR, path.join(__dirname, "..", "..", "data", "studio")),
  imageModel: str(process.env.STUDIO_IMAGE_MODEL, "gemini-3-pro-image"),
  videoModelDraft: str(process.env.STUDIO_VIDEO_MODEL_DRAFT, "veo-3.1-lite-generate-preview"),
  videoModelFinal: str(process.env.STUDIO_VIDEO_MODEL_FINAL, "veo-3.1-fast-generate-preview"),
  scriptModel: str(process.env.STUDIO_SCRIPT_MODEL, DEFAULT_MODEL),
  voiceDefault: str(process.env.STUDIO_VOICE_DEFAULT, "vi-VN-HoaiMyNeural"),
  concurrency: Math.max(1, num(process.env.STUDIO_CONCURRENCY, 3)),
  ffmpegConcurrency: Math.max(1, num(process.env.STUDIO_FFMPEG_CONCURRENCY, 2)),
  dailyBudgetUsd: num(process.env.STUDIO_DAILY_BUDGET_USD, 20),
  maxDiskGb: num(process.env.STUDIO_MAX_DISK_GB, 60),
  subFont: str(process.env.STUDIO_SUB_FONT, "DejaVu Sans"),
  engines: {
    image: str(process.env.STUDIO_ENGINE_IMAGE, "nano") as "nano" | "fake",
    video: str(process.env.STUDIO_ENGINE_VIDEO, "veo") as "veo" | "fake",
    voice: str(process.env.STUDIO_ENGINE_VOICE, "edge") as "edge" | "fpt" | "fake",
  },
  // Cảnh packaging/label dựng bằng Ken Burns trên ảnh khoá thay vì gọi model video.
  // Bench Bước 0: chữ nhãn giữ nguyên từng điểm ảnh và tốn 0 đồng. Đặt =0 để tắt.
  kenBurnsForLabels: str(process.env.STUDIO_KENBURNS_LABELS, "1") !== "0",
  transitionSec: 0.5,
  musicVolume: 0.12,
};

/** Kích thước khung hình theo tỉ lệ. */
export function frameSize(ratio: AspectRatio): { width: number; height: number } {
  if (ratio === "16:9") return { width: 1920, height: 1080 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export function projectDir(projectId: string): string {
  return path.join(STUDIO.dataDir, projectId);
}

/** Tạo assets/ keyframes/ clips/ render/ cho một dự án; trả về thư mục gốc. */
export function ensureProjectDirs(projectId: string): string {
  const root = projectDir(projectId);
  for (const sub of ["assets", "keyframes", "clips", "render"]) fs.mkdirSync(path.join(root, sub), { recursive: true });
  return root;
}

export function musicDir(): string {
  const d = path.join(STUDIO.dataDir, "_music");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Thư mục multer nhận file tạm trước khi chuyển vào assets/ của dự án. */
export function incomingDir(): string {
  const d = path.join(STUDIO.dataDir, "_incoming");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
