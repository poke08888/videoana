/**
 * server/studio/engines/fake.ts — engine giả chạy bằng ffmpeg lavfi: đúng hợp đồng, 0 đồng.
 * Cho test tự động và sửa code lúc nửa đêm không sợ mất tiền (spec mục 11).
 */
import { frameSize } from "../config.js";
import { runFfmpeg, probeDuration } from "../ffmpeg.js";
import { countSyllables } from "../text.js";
import type { ImageEngine, VideoEngine, VoiceEngine } from "./types.js";

export const FAKE_SYLLABLES_PER_SEC = 4.5;

export function fakeImageEngine(): ImageEngine {
  return {
    name: "fake",
    async generate(req) {
      const { width, height } = frameSize(req.aspectRatio);
      await runFfmpeg(["-f", "lavfi", "-i", `color=c=#b06a16:s=${width}x${height}`, "-frames:v", "1", "-y", req.outPath], { nice: false });
      return { path: req.outPath, mimeType: "image/png", costUsd: 0, model: "fake" };
    },
  };
}

export function fakeVideoEngine(): VideoEngine {
  return {
    name: "fake",
    async generate(req) {
      const { width, height } = frameSize(req.aspectRatio);
      await runFfmpeg(["-f", "lavfi", "-i", `color=c=#3c7a5e:s=${width}x${height}:d=${req.durationSec}:r=24`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", req.outPath], { nice: false });
      return { path: req.outPath, durationSec: req.durationSec, costUsd: 0, model: "fake" };
    },
  };
}

export function fakeVoiceEngine(): VoiceEngine {
  return {
    name: "fake",
    voices: () => [{ id: "fake", label: "Giọng giả (im lặng)" }],
    async synthesize(req) {
      const dur = Math.max(0.5, countSyllables(req.text) / (FAKE_SYLLABLES_PER_SEC * (req.rate || 1)));
      await runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", dur.toFixed(2), "-c:a", "libmp3lame", "-b:a", "48k", "-y", req.outPath], { nice: false });
      return { path: req.outPath, durationSec: await probeDuration(req.outPath), words: null, costUsd: 0 };
    },
  };
}
