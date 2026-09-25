/**
 * server/style/measure.ts — đo phần đo được bằng ffmpeg, không AI (spec §4).
 * Mỗi phép đo độc lập: lỗi → trường null, không fail cả video.
 * ffmpeg-static không có ffprobe → mọi thông tin đọc từ stderr của ffmpeg.
 */
import { spawn } from "node:child_process";
import { runFfmpeg, FFMPEG, parseDurationLine } from "../studio/ffmpeg.js";
import { STYLE } from "./config.js";
import type { StyleMeasure } from "./types.js";
import { LEVELS, TONES } from "./types.js";

const T = 60_000;
/** Ngưỡng so khung đầu–cuối để đoán video có loop hay không (frameStats). */
const LOOP_DY = 6;
const LOOP_DRANGE = 12;
const LOOP_DUV = 6;
/** Ngưỡng phân loại tông màu / độ bão hoà / độ tương phản (colorLabels). */
const TONE_DELTA = 8;
const SAT_LO = 30;
const SAT_HI = 60;
const CONTRAST_LO = 30;
const CONTRAST_HI = 55;

/** Chạy ffmpeg và trả stderr dù thoát mã ≠ 0 (nhiều filter in kết quả rồi thoát 0, nhưng -i không output thoát 1). */
async function stderrOf(args: string[], timeoutMs = T): Promise<string> {
  try { return await runFfmpeg(args, { nice: false, timeoutMs }); }
  catch (e: any) { return String(e?.message || ""); }
}
/**
 * Chạy ffmpeg và trả TOÀN BỘ stderr (không cắt 6 dòng cuối như runFfmpeg) — cần nguyên dòng
 * "Duration:" cho probe ban đầu. Có timeout riêng: hết giờ thì kill("SIGKILL") và trả lại phần
 * stderr đã thu được thay vì treo mãi (probe không có -t/frame limit nên có thể không tự thoát).
 */
function rawStderr(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((res) => {
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    p.stderr.on("data", (c) => (s += String(c)));
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} res(s); }, timeoutMs);
    p.on("close", () => { clearTimeout(t); res(s); });
    p.on("error", () => { clearTimeout(t); res(s); });
  });
}

export function parseShowinfoTimes(s: string): number[] { return [...s.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n)); }
export function parseEbur128(s: string): number | null { const m = s.match(/Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+)\s*LUFS/); return m ? Number(m[1]) : null; }
export function parseSignalstats(s: string): { y: number; u: number; v: number; sat: number }[] {
  const ys = [...s.matchAll(/signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const us = [...s.matchAll(/signalstats\.UAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const vs = [...s.matchAll(/signalstats\.VAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const ss = [...s.matchAll(/signalstats\.SATAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return ys.map((y, i) => ({ y, u: us[i] ?? 128, v: vs[i] ?? 128, sat: ss[i] ?? 0 }));
}
export function parseSilenceStart(s: string): number | null {
  const start = s.match(/silence_start:\s*(-?[\d.]+)/); if (!start || Number(start[1]) > 0.05) return null;
  const end = s.match(/silence_end:\s*([\d.]+)/); return end ? Number(end[1]) : null;
}
export function parseStreamInfo(s: string): { width: number; height: number; fps: number } | null {
  const m = s.match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b.*?([\d.]+)\s*fps/); return m ? { width: Number(m[1]), height: Number(m[2]), fps: Number(m[3]) } : null;
}
export function aspectOf(w: number, h: number): string { const r = w / h; if (Math.abs(r - 9 / 16) < 0.05) return "9:16"; if (Math.abs(r - 1) < 0.05) return "1:1"; if (Math.abs(r - 16 / 9) < 0.05) return "16:9"; if (Math.abs(r - 3 / 4) < 0.05) return "3:4"; return `${w}:${h}`; }

const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p))); return s[i]; };
export function cutStats(cuts: number[], duration: number) {
  // Cùng 1 danh sách cut đã lọc (0, duration) + sắp tăng dần dùng cho CẢ shot length lẫn cutsPerMin.
  const sorted = cuts.filter((c) => c > 0 && c < duration).sort((a, b) => a - b);
  const bounds = [0, ...sorted, duration];
  const shots = bounds.slice(1).map((b, i) => b - bounds[i]).filter((d) => d > 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { cutsPerMin: duration > 0 ? r2((sorted.length / duration) * 60) : 0, medianShotLen: r2(q(shots, 0.5)), shotLenP10: r2(q(shots, 0.1)), shotLenP90: r2(q(shots, 0.9)), cutsIn3s: cuts.filter((c) => c <= 3).length };
}
export function colorLabels(c: { y: number; u: number; v: number; saturation: number; contrast: number }) {
  const d = c.v - c.u; const tone: (typeof TONES)[number] = d > TONE_DELTA ? "warm" : d < -TONE_DELTA ? "cool" : "neutral";
  const lv = (x: number, lo: number, hi: number): (typeof LEVELS)[number] => (x < lo ? "low" : x > hi ? "high" : "mid");
  return { tone, saturationLevel: lv(c.saturation, SAT_LO, SAT_HI), contrastLevel: lv(c.contrast, CONTRAST_LO, CONTRAST_HI) };
}

/** Khử trùng lặp mốc thời gian (giây): gộp giá trị cách nhau < 0.05 s, trả về mảng tăng dần. */
function dedupeTimes(xs: number[]): number[] {
  const s = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) { if (!out.length || x - out[out.length - 1] > 0.05) out.push(x); }
  return out;
}

/**
 * Chọn `count` mốc thời gian (giây) để chụp khung đại diện của video dài `dur` giây, dùng danh
 * sách cut `cuts` (giây) làm gợi ý. Luôn giữ mốc đầu (0.05 s) và mốc cuối (dur-0.3 s); `count-2`
 * mốc giữa lấy từ các cut trải đều khi có đủ cut phân biệt trong (0, dur), nếu không đủ thì lấy
 * đều theo thời lượng. Mọi mốc bị kẹp vào [0, max(0, dur-0.3)] và loại trùng (cách nhau < 0.05 s).
 */
export function frameTimes(cuts: number[], dur: number, count: number): number[] {
  const cap = Math.max(0, dur - 0.3);
  const clamp = (t: number) => Math.min(cap, Math.max(0, t));
  if (count <= 0) return [];
  if (count === 1) return [clamp(0.05)];
  const first = clamp(0.05);
  const last = clamp(dur - 0.3);
  const need = count - 2;
  let mid: number[] = [];
  if (need > 0) {
    const distinct = dedupeTimes(cuts.filter((c) => c > 0 && c < dur));
    if (distinct.length >= need) {
      mid = Array.from({ length: need }, (_, i) => {
        const idx = need === 1 ? Math.floor((distinct.length - 1) / 2) : Math.round((i * (distinct.length - 1)) / (need - 1));
        return clamp(distinct[idx]);
      });
    } else {
      mid = Array.from({ length: need }, (_, i) => clamp((dur * (i + 1)) / (need + 1)));
    }
  }
  return dedupeTimes([first, ...mid, last]);
}

async function grabFrame(file: string, sec: number): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ["-ss", String(Math.max(0, sec)), "-i", file, "-frames:v", "1", "-vf", "scale=-2:360", "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = []; p.stdout.on("data", (c) => chunks.push(c));
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} resolve(null); }, 20_000);
    p.on("close", () => { clearTimeout(t); const b = Buffer.concat(chunks); resolve(b.length > 100 ? `data:image/jpeg;base64,${b.toString("base64")}` : null); });
    p.on("error", () => { clearTimeout(t); resolve(null); });
  });
}
/** Đọc YAVG/YLOW/YHIGH/UAVG/VAVG của 1 khung (không phải histogram) — dùng để so khung đầu–cuối video khi đoán loop. */
async function frameStats(file: string, sec: number): Promise<{ y: number; ylow: number; yhigh: number; u: number; v: number } | null> {
  const s = await stderrOf(["-ss", String(Math.max(0, sec)), "-i", file, "-frames:v", "1", "-vf", "scale=64:64,signalstats,metadata=print", "-f", "null", "-"]);
  const y = s.match(/signalstats\.YAVG=([\d.]+)/); const lo = s.match(/signalstats\.YLOW=([\d.]+)/); const hi = s.match(/signalstats\.YHIGH=([\d.]+)/);
  const u = s.match(/signalstats\.UAVG=([\d.]+)/); const v = s.match(/signalstats\.VAVG=([\d.]+)/);
  return y ? { y: Number(y[1]), ylow: lo ? Number(lo[1]) : 0, yhigh: hi ? Number(hi[1]) : 255, u: u ? Number(u[1]) : 128, v: v ? Number(v[1]) : 128 } : null;
}

export async function measureVideo(file: string): Promise<StyleMeasure> {
  const m: StyleMeasure = { duration: null, width: null, height: null, aspect: null, fps: null, cuts: [], cutsPerMin: null, medianShotLen: null, shotLenP10: null, shotLenP90: null, cutsIn3s: null,
    loudness: { integratedLufs: null, first3sLufs: null }, silenceStart: null, color: null, loopLikely: null, frames: [] };
  let info = "";
  try { info = await rawStderr(["-i", file]); } catch { info = ""; }
  m.duration = parseDurationLine(info); const si = parseStreamInfo(info);
  if (si) { m.width = si.width; m.height = si.height; m.fps = si.fps; m.aspect = aspectOf(si.width, si.height); }
  const dur = m.duration || 0;
  // Cut
  try {
    // rawStderr (TOÀN BỘ stderr): runFfmpeg chỉ giữ 20.000 ký tự cuối, mỗi dòng showinfo ~420 ký tự →
    // > ~45 cut là mất các cut ĐẦU (cut của hook). -nostats bỏ dòng tiến độ để stderr gọn.
    const s = await rawStderr(["-nostats", "-i", file, "-vf", `select='gt(scene,${STYLE.sceneThreshold})',showinfo`, "-an", "-f", "null", "-"], 120_000);
    m.cuts = parseShowinfoTimes(s).map((t) => Math.round(t * 100) / 100);
    if (dur > 0) Object.assign(m, cutStats(m.cuts, dur));
  } catch { /* giữ null */ }
  // Loudness cả video + 3 s đầu + im lặng đầu
  try { m.loudness.integratedLufs = parseEbur128(await stderrOf(["-nostats", "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"])); } catch {}
  try { m.loudness.first3sLufs = parseEbur128(await stderrOf(["-nostats", "-t", "3", "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"])); } catch {}
  try { m.silenceStart = parseSilenceStart(await stderrOf(["-nostats", "-t", "5", "-i", file, "-vn", "-af", `silencedetect=n=${STYLE.silenceDb}dB:d=0.3`, "-f", "null", "-"])); } catch {}
  // Màu: 8 khung lấy đều
  try {
    const step = dur > 0 ? dur / 9 : 1;
    const s = await stderrOf(["-nostats", "-i", file, "-vf", `fps=1/${step.toFixed(3)},scale=160:-2,signalstats,metadata=print`, "-frames:v", "8", "-an", "-f", "null", "-"], 120_000);
    const rows = parseSignalstats(s);
    if (rows.length) {
      const avg = (k: "y" | "u" | "v" | "sat") => rows.reduce((a, r) => a + r[k], 0) / rows.length;
      const ys = rows.map((r) => r.y); const contrast = Math.max(...ys) - Math.min(...ys);
      const c = { y: avg("y"), u: avg("u"), v: avg("v"), saturation: avg("sat"), contrast };
      m.color = { ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * 10) / 10])) as typeof c, ...colorLabels(c) };
    }
  } catch {}
  // Loop: so khung đầu–cuối (Y + U/V để tránh nhầm 2 cảnh khác màu nhưng cùng độ sáng)
  try {
    const a = await frameStats(file, 0.1); const b = await frameStats(file, Math.max(0, dur - 0.2));
    m.loopLikely = !!(a && b) && Math.abs(a.y - b.y) < LOOP_DY && Math.abs(a.yhigh - b.yhigh) < LOOP_DRANGE && Math.abs(a.u - b.u) < LOOP_DUV && Math.abs(a.v - b.v) < LOOP_DUV;
  } catch {}
  // Frames: mốc lấy qua frameTimes (đầu + giữa trải theo cut/thời lượng + cuối), số lượng = STYLE.frameCount
  const at = frameTimes(m.cuts, dur, STYLE.frameCount);
  for (const t of at) { const f = await grabFrame(file, t); if (f) m.frames.push(f); }
  return m;
}
