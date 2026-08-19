/**
 * server/studio/engines/voice.ts — giọng nháp miễn phí qua Edge Read-Aloud (msedge-tts),
 * có mốc thời gian từng từ. API không chính thức → CHỈ nháp nội bộ (spec mục 2).
 */
import fs from "node:fs";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { probeDuration } from "../ffmpeg.js";
import type { VoiceEngine, WordTiming } from "./types.js";

export const EDGE_VOICES = [
  { id: "vi-VN-HoaiMyNeural", label: "Hoài My (nữ, miền Bắc)" },
  { id: "vi-VN-NamMinhNeural", label: "Nam Minh (nam, miền Bắc)" },
];

export const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function parseEdgeMetadata(meta: any): WordTiming[] {
  const items: any[] = meta?.Metadata || [];
  return items
    .filter((m) => m?.Type === "WordBoundary")
    .map((m) => {
      const start = Number(m.Data.Offset) / 1e7;
      const dur = Number(m.Data.Duration) / 1e7;
      return { text: String(m.Data.text?.Text || ""), startSec: round3(start), endSec: round3(start + dur) };
    });
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function edgeVoiceEngine(): VoiceEngine {
  return {
    name: "edge",
    voices: () => EDGE_VOICES,
    async synthesize(req) {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(req.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
      const tmp = fs.mkdtempSync(path.join(path.dirname(req.outPath), "tts-"));
      try {
        const { audioFilePath, metadataFilePath } = await tts.toFile(tmp, escapeXml(req.text), { rate: req.rate || 1 });
        fs.renameSync(audioFilePath, req.outPath);
        const words = metadataFilePath && fs.existsSync(metadataFilePath) ? parseEdgeMetadata(JSON.parse(fs.readFileSync(metadataFilePath, "utf8"))) : null;
        return { path: req.outPath, durationSec: await probeDuration(req.outPath), words: words && words.length ? words : null, costUsd: 0 };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        try { (tts as any).close?.(); } catch { /* bỏ qua */ }
      }
    },
  };
}
