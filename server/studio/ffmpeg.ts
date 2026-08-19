/**
 * server/studio/ffmpeg.ts — chạy ffmpeg (FFMPEG_PATH → ffmpeg-static → PATH), có timeout,
 * chạy `nice` khi có để không giành lõi với API. ffmpeg-static KHÔNG có ffprobe → đo thời lượng
 * bằng cách parse dòng "Duration:" trong stderr.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import ffmpegStatic from "ffmpeg-static";

export const FFMPEG = (process.env.FFMPEG_PATH || "").trim() || (ffmpegStatic as unknown as string) || "ffmpeg";
const HAS_NICE = process.platform !== "win32" && fs.existsSync("/usr/bin/nice");

export function runFfmpeg(args: string[], opts: { timeoutMs?: number; nice?: boolean } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const useNice = (opts.nice ?? true) && HAS_NICE;
  const cmd = useNice ? "/usr/bin/nice" : FFMPEG;
  const full = useNice ? ["-n", "10", FFMPEG, ...args] : args;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, full, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => { err += String(c); if (err.length > 20000) err = err.slice(-20000); });
    const guard = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} reject(new Error(`ffmpeg quá ${timeoutMs}ms`)); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(guard); reject(new Error(`ffmpeg không chạy được: ${e.message}`)); });
    p.on("close", (code) => {
      clearTimeout(guard);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg thoát mã ${code}: ${err.split("\n").slice(-6).join(" | ")}`));
    });
  });
}

export function parseDurationLine(text: string): number | null {
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Thời lượng (giây). ffmpeg -i không có output sẽ thoát mã 1 nhưng vẫn in Duration → bắt từ lỗi. */
export async function probeDuration(filePath: string): Promise<number> {
  let text = "";
  try { text = await runFfmpeg(["-i", filePath], { nice: false, timeoutMs: 30_000 }); }
  catch (e: any) { text = String(e?.message || ""); }
  const d = parseDurationLine(text);
  if (d === null) {
    // Lỗi gộp chỉ giữ 6 dòng cuối — chạy lại lấy nguyên stderr.
    const raw = await new Promise<string>((res) => {
      const p = spawn(FFMPEG, ["-i", filePath], { stdio: ["ignore", "ignore", "pipe"] });
      let s = ""; p.stderr.on("data", (c) => (s += String(c))); p.on("close", () => res(s)); p.on("error", () => res(s));
    });
    const d2 = parseDurationLine(raw);
    if (d2 === null) throw new Error(`Không đo được thời lượng: ${filePath}`);
    return d2;
  }
  return d;
}
