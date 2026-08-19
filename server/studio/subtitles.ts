/**
 * server/studio/subtitles.ts — từ mốc thời gian từng từ → cue phụ đề → ASS (burn) và SRT.
 * Hộp nền vuông BorderStyle=3 (libass không bo góc), canh dưới, MarginV cao để tránh UI TikTok.
 */
import type { WordTiming } from "./engines/types.js";

export interface SubCue { text: string; startSec: number; endSec: number }

/** Không có timestamp thật → chia đều theo độ dài chữ (+1 cho khoảng cách). */
export function proportionalTimings(text: string, durationSec: number): WordTiming[] {
  const tokens = String(text || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map((t) => t.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: WordTiming[] = [];
  let t = 0;
  for (let i = 0; i < tokens.length; i++) {
    const d = (weights[i] / total) * durationSec;
    const end = i === tokens.length - 1 ? durationSec : t + d;
    out.push({ text: tokens[i], startSec: t, endSec: end });
    t = end;
  }
  return out;
}

export function groupCues(words: WordTiming[], maxChars = 26): SubCue[] {
  const cues: SubCue[] = [];
  let buf: WordTiming[] = [];
  const flush = () => {
    if (!buf.length) return;
    cues.push({ text: buf.map((w) => w.text).join(" "), startSec: buf[0].startSec, endSec: buf[buf.length - 1].endSec });
    buf = [];
  };
  for (const w of words) {
    const candidate = [...buf, w].map((x) => x.text).join(" ");
    if (buf.length && candidate.length > maxChars) flush();
    buf.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return cues;
}

export const shiftCues = (cues: SubCue[], offsetSec: number): SubCue[] =>
  cues.map((c) => ({ ...c, startSec: c.startSec + offsetSec, endSec: c.endSec + offsetSec }));

export function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const cs = Math.round((r - Math.floor(r)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(r)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const escAss = (t: string) => t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");

export function toAss(cues: SubCue[], o: { font: string; width: number; height: number; fontSize?: number }): string {
  const fs = o.fontSize ?? Math.round(o.height * 0.034); // ~64px trên 1920
  const marginV = Math.round(o.height * 0.14);
  const head = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${o.width}`, `PlayResY: ${o.height}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${o.font},${fs},&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,3,14,0,2,60,60,${marginV},163`, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines = cues.map((c) => `Dialogue: 0,${assTime(c.startSec)},${assTime(c.endSec)},Default,,0,0,0,,${escAss(c.text)}`);
  return [...head, ...lines, ""].join("\n");
}

const srtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};
export function toSrt(cues: SubCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.startSec)} --> ${srtTime(c.endSec)}\n${c.text}\n`).join("\n");
}
