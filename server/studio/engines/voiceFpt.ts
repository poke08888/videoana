/**
 * server/studio/engines/voiceFpt.ts — FPT.AI TTS v5 (giọng Việt bản địa, hạng chốt).
 * API trả URL bất đồng bộ → poll tới khi 200. Không trả timestamp → align.ts chia tỉ lệ.
 */
import fs from "node:fs";
import { StudioError } from "../errors.js";
import { voiceCost } from "../pricing.js";
import { probeDuration } from "../ffmpeg.js";
import type { VoiceEngine } from "./types.js";

export const FPT_VOICES = [
  { id: "banmai", label: "Ban Mai (nữ, Bắc)" }, { id: "leminh", label: "Lê Minh (nam, Bắc)" }, { id: "thuminh", label: "Thu Minh (nữ, Bắc)" },
  { id: "giahuy", label: "Gia Huy (nam, Trung)" }, { id: "ngoclam", label: "Ngọc Lam (nữ, Huế)" }, { id: "myan", label: "Mỹ An (nữ, Trung)" },
  { id: "lannhi", label: "Lan Nhi (nữ, Nam)" }, { id: "linhsan", label: "Linh San (nữ, Nam)" }, { id: "minhquang", label: "Minh Quang (nam, Nam)" },
];

/** rate 1.0 = 0; mỗi 0.2 = 1 bậc; FPT nhận -3..3. */
export const rateToSpeed = (rate: number) => Math.max(-3, Math.min(3, Math.round(((rate || 1) - 1) * 5)));

export function fptVoiceEngine(apiKey: string, fetchImpl: typeof fetch = fetch, deps: { pollMs?: number; maxWaitMs?: number; probe?: (p: string) => Promise<number> } = {}): VoiceEngine {
  const pollMs = deps.pollMs ?? 2000, maxWaitMs = deps.maxWaitMs ?? 90_000, probe = deps.probe ?? probeDuration;
  return {
    name: "fpt",
    voices: () => FPT_VOICES,
    async synthesize(req) {
      const res = await fetchImpl("https://api.fpt.ai/hmi/tts/v5", {
        method: "POST",
        headers: { "api-key": apiKey, voice: req.voice, speed: String(rateToSpeed(req.rate)), format: "mp3" },
        body: req.text,
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || Number(j?.error) !== 0 || !j?.async) throw new StudioError(res.status === 401 || res.status === 403 ? "billing" : "other", `FPT.AI: ${j?.message || res.status}`);
      const started = Date.now();
      for (;;) {
        const a = await fetchImpl(j.async);
        if (a.ok && a.status === 200) { fs.writeFileSync(req.outPath, Buffer.from(await a.arrayBuffer())); break; }
        if (Date.now() - started > maxWaitMs) throw new StudioError("network", "FPT.AI quá lâu chưa trả file giọng.");
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return { path: req.outPath, durationSec: await probe(req.outPath), words: null, costUsd: voiceCost("fpt", req.text.length) };
    },
  };
}
