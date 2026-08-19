/**
 * server/studio/assemble.ts — MỘT lệnh ffmpeg, MỘT lần encode: scale/crop → xfade → subtitles;
 * giọng từng cảnh đặt đúng mốc bằng adelay; nhạc nền loop + volume + fade-out 3s; -t chặn tổng.
 * (Bài học MoneyPrinterTurbo, spec 3.3c–e.)
 */
import fs from "node:fs";
import { STUDIO } from "./config.js";
import { runFfmpeg, probeDuration } from "./ffmpeg.js";
import { toAss, type SubCue } from "./subtitles.js";

export const TRANSITIONS = ["none", "fade", "dissolve", "wipeleft", "slideleft", "zoomin"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export interface AssembleInput {
  clips: { path: string; durationSec: number }[];
  voices: ({ path: string; startSec: number } | null)[];   // cùng độ dài với clips
  cues: SubCue[];                                          // đã dời theo mốc cảnh
  musicPath: string | null;
  transition: Transition;
  width: number; height: number; font: string;
  outPath: string; assPath: string;
}

/** start_k = Σ d(0..k-1) − k·t. Với transition none, t = 0. */
export function clipStarts(durations: number[], t: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let k = 0; k < durations.length; k++) { out.push(Math.round((acc - k * t) * 1000) / 1000); acc += durations[k]; }
  return out;
}
export const totalDuration = (durations: number[], t: number) =>
  Math.round((durations.reduce((a, b) => a + b, 0) - t * Math.max(0, durations.length - 1)) * 1000) / 1000;

const escFilterPath = (p: string) => p.replace(/\\/g, "\\\\").replace(/'/g, "'\\''").replace(/:/g, "\\:");

export function buildAssembleArgs(i: AssembleInput, transitionSec: number): string[] {
  const n = i.clips.length;
  const t = i.transition === "none" ? 0 : transitionSec;
  const durs = i.clips.map((c) => c.durationSec);
  const starts = clipStarts(durs, t);
  const total = totalDuration(durs, t);
  const args: string[] = ["-hide_banner", "-loglevel", "error"];
  i.clips.forEach((c) => args.push("-i", c.path));
  const voiceIdx: number[] = [];
  i.voices.forEach((v) => { if (v) { voiceIdx.push(n + voiceIdx.length); args.push("-i", v.path); } });
  let musicIdx = -1;
  if (i.musicPath) { musicIdx = n + voiceIdx.length; args.push("-stream_loop", "-1", "-i", i.musicPath); }

  const f: string[] = [];
  for (let k = 0; k < n; k++) f.push(`[${k}:v]scale=${i.width}:${i.height}:force_original_aspect_ratio=increase,crop=${i.width}:${i.height},setsar=1,fps=24,format=yuv420p[v${k}]`);
  let vlast = "[v0]";
  if (n > 1 && t > 0) {
    for (let k = 1; k < n; k++) { const o = `[x${k}]`; f.push(`${vlast}[v${k}]xfade=transition=${i.transition}:duration=${t}:offset=${starts[k]}${o}`); vlast = o; }
  } else if (n > 1) {
    f.push(`${i.clips.map((_, k) => `[v${k}]`).join("")}concat=n=${n}:v=1:a=0[vcat]`); vlast = "[vcat]";
  }
  f.push(`${vlast}subtitles=filename='${escFilterPath(i.assPath)}'[vout]`);

  const aparts: string[] = [];
  let vi = 0;
  i.voices.forEach((v) => {
    if (!v) return;
    const ms = Math.round(v.startSec * 1000);
    f.push(`[${voiceIdx[vi]}:a]adelay=${ms}|${ms}[a${vi}]`); aparts.push(`[a${vi}]`); vi++;
  });
  if (musicIdx >= 0) { f.push(`[${musicIdx}:a]volume=${STUDIO.musicVolume},afade=t=out:st=${Math.max(0, total - 3)}:d=3[bg]`); aparts.push("[bg]"); }
  let audioMap: string[];
  if (aparts.length === 0) audioMap = ["-an"];
  else if (aparts.length === 1) { f.push(`${aparts[0]}anull[aout]`); audioMap = ["-map", "[aout]"]; }
  else { f.push(`${aparts.join("")}amix=inputs=${aparts.length}:duration=longest:normalize=0[aout]`); audioMap = ["-map", "[aout]"]; }

  args.push("-filter_complex", f.join(";"), "-map", "[vout]", ...audioMap,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "24",
    ...(aparts.length ? ["-c:a", "aac", "-b:a", "128k"] : []),
    "-movflags", "+faststart", "-t", String(total), "-y", i.outPath);
  return args;
}

export async function assembleVideo(i: AssembleInput): Promise<{ outPath: string; durationSec: number }> {
  fs.writeFileSync(i.assPath, toAss(i.cues, { font: i.font, width: i.width, height: i.height }));
  await runFfmpeg(buildAssembleArgs(i, STUDIO.transitionSec), { timeoutMs: 15 * 60_000 });
  return { outPath: i.outPath, durationSec: await probeDuration(i.outPath) };
}
