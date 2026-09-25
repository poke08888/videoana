/**
 * server/style/config.ts — cấu hình Style kênh, đọc env một lần. Mọi ngưỡng ở đây (spec §4, §6, §11).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL } from "../nonelabPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
// Biến thể có dấu của num() — dùng cho ngưỡng âm (vd. silenceDb) mà không đổi hành vi num() cho các trường còn lại.
const snum = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v: string | undefined, d: string) => (v || "").trim() || d;

/** Parse "90,180,365" → [90,180,365] tăng dần; bỏ giá trị không phải số; rỗng/không hợp lệ → default. Export để test đơn vị. */
export function parseWindowsDays(v: string | undefined, d: number[]): number[] {
  if (!v || !v.trim()) return d;
  const nums = v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return d;
  return [...new Set(nums)].sort((a, b) => a - b);
}

const engineRaw = str(process.env.STYLE_ENGINE, "gemini");
const engine: "gemini" | "fake" = engineRaw === "fake" ? "fake" : "gemini";

export const STYLE = {
  model: str(process.env.STYLE_MODEL, str(process.env.GEMINI_MODEL, DEFAULT_MODEL)),
  engine,
  tmpDir: str(process.env.STYLE_TMP_DIR, path.join(__dirname, "..", "..", "data", "style-tmp")),
  concurrency: Math.max(1, num(process.env.STYLE_CONCURRENCY, 4)),
  sceneThreshold: num(process.env.STYLE_SCENE_THRESHOLD, 0.35),
  minVideos: Math.max(1, num(process.env.STYLE_MIN_VIDEOS, 15)),
  pickCount: num(process.env.STYLE_PICK_COUNT, 30),
  exemplarCount: num(process.env.STYLE_EXEMPLAR_COUNT, 5),
  windowsDays: parseWindowsDays(process.env.STYLE_WINDOWS_DAYS, [90, 180, 365]),
  recentDays: num(process.env.STYLE_RECENT_DAYS, 90),
  oldWeight: num(process.env.STYLE_OLD_WEIGHT, 0.5),
  hardShare: num(process.env.STYLE_HARD_SHARE, 0.7),
  softShare: num(process.env.STYLE_SOFT_SHARE, 0.4),
  outlierLayers: Math.max(1, num(process.env.STYLE_OUTLIER_LAYERS, 3)),
  fpsShort: num(process.env.STYLE_FPS_SHORT, 3),
  fpsLong: num(process.env.STYLE_FPS_LONG, 2),
  fpsTimeline: num(process.env.STYLE_FPS_TIMELINE, 5),
  longVideoSec: num(process.env.STYLE_LONG_VIDEO_SEC, 60),
  silenceDb: snum(process.env.STYLE_SILENCE_DB, -35),
  frameCount: num(process.env.STYLE_FRAME_COUNT, 6),
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
