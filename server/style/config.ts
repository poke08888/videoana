/**
 * server/style/config.ts — cấu hình Style kênh, đọc env một lần. Mọi ngưỡng ở đây (spec §4, §6, §11).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL } from "../nonelabPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const str = (v: string | undefined, d: string) => (v || "").trim() || d;

export const STYLE = {
  model: str(process.env.STYLE_MODEL, str(process.env.GEMINI_MODEL, DEFAULT_MODEL)),
  engine: str(process.env.STYLE_ENGINE, "gemini") as "gemini" | "fake",
  tmpDir: str(process.env.STYLE_TMP_DIR, path.join(__dirname, "..", "..", "data", "style-tmp")),
  concurrency: Math.max(1, num(process.env.STYLE_CONCURRENCY, 4)),
  sceneThreshold: num(process.env.STYLE_SCENE_THRESHOLD, 0.35),
  minVideos: Math.max(1, num(process.env.STYLE_MIN_VIDEOS, 15)),
  pickCount: 30, exemplarCount: 5,
  windowsDays: [90, 180, 365],
  recentDays: 90, oldWeight: 0.5,
  hardShare: 0.7, softShare: 0.4,
  outlierLayers: Math.max(1, num(process.env.STYLE_OUTLIER_LAYERS, 3)),
  fpsShort: 3, fpsLong: 2, fpsTimeline: 5, longVideoSec: 60,
  silenceDb: -35,
  frameCount: 6,
  /** Trường mà 0 % có nghĩa "kênh không bao giờ làm" (spec §6). key = layer.field, value = danh sách giá trị đáng nói. */
  neverFields: {
    "structure.transitions": ["zoom", "whip", "match", "fade"],
    "brand.intro": ["true"], "brand.outro": ["true"],
    "text.stickers": ["arrow", "circle", "meme", "lower-third", "emoji"],
    "visual.frame": ["border", "split", "pip"],
    "text.captionStyle": ["word-pop"],
    "audio.sfxDensity": ["dense"],
    "audio.music.levelVsVoice": ["over"],
    "visual.punchIn": ["true"],
  } as Record<string, string[]>,
};
