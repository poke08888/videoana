/** server/studio/engines/align.ts — GĐ 1: engine không trả timestamp → chia tỉ lệ. GĐ 1.5: whisper forced-alignment. */
import { proportionalTimings } from "../subtitles.js";
import type { WordTiming } from "./types.js";

export function alignWords(words: WordTiming[] | null, text: string, durationSec: number): WordTiming[] {
  if (words && words.length) return words;
  return proportionalTimings(text, durationSec);
}
