/**
 * server/studio/engines/video.ts — ảnh khoá → clip bằng Veo 3.1 qua Gemini API.
 * Dùng KHUNG HÌNH ĐẦU (image) — SDK không cho dùng cùng lúc với referenceImages.
 * Poll operation mỗi 10s, tối đa 8 phút. RAI lọc hết → lỗi "blocked" (không thử lại).
 */
import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { STUDIO } from "../config.js";
import { videoCost } from "../pricing.js";
import { StudioError } from "../errors.js";
import type { VideoEngine, VideoRequest } from "./types.js";

const MOTION_HINT: Record<VideoRequest["motionLevel"], string> = {
  low: "Subtle, slow camera motion only; keep the product label perfectly legible and undistorted; no fast hand movement.",
  medium: "Natural handheld motion; keep the product recognizable throughout.",
  high: "",
};

export function buildMotionPrompt(req: Pick<VideoRequest, "prompt" | "motionLevel">): string {
  const hint = MOTION_HINT[req.motionLevel];
  return hint ? `${req.prompt.trim()} ${hint}` : req.prompt.trim();
}

export function pickVideo(op: any): any {
  if (op?.error) throw new StudioError("other", `Veo báo lỗi: ${op.error.message || JSON.stringify(op.error)}`);
  const vids: any[] = op?.response?.generatedVideos || [];
  const v = vids.find((g) => g?.video)?.video;
  if (v) return v;
  const filtered = Number(op?.response?.raiMediaFilteredCount || 0);
  if (filtered > 0) throw new StudioError("blocked", `Veo lọc nội dung: ${(op.response.raiMediaFilteredReasons || []).join("; ")}`);
  throw new StudioError("other", "Veo không trả về video.");
}

const sleepDefault = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function veoVideoEngine(
  apiKey: string,
  models: { draft: string; final: string } = { draft: STUDIO.videoModelDraft, final: STUDIO.videoModelFinal },
  deps: { sleep?: (ms: number) => Promise<unknown>; pollMs?: number; maxWaitMs?: number } = {}
): VideoEngine {
  const ai = new GoogleGenAI({ apiKey });
  const sleep = deps.sleep ?? sleepDefault;
  const pollMs = deps.pollMs ?? 10_000;
  const maxWaitMs = deps.maxWaitMs ?? 8 * 60_000;
  return {
    name: `veo:${models.draft}|${models.final}`,
    async generate(req) {
      const model = req.tier === "final" ? models.final : models.draft;
      let op: any = await ai.models.generateVideos({
        model,
        prompt: buildMotionPrompt(req),
        image: { imageBytes: fs.readFileSync(req.firstFrame.path).toString("base64"), mimeType: req.firstFrame.mimeType },
        // KHÔNG truyền generateAudio: Gemini API không hỗ trợ (chỉ Vertex AI có). Veo tự sinh
        // audio nhưng assemble.ts chỉ map audio từ file giọng nên track đó bị bỏ — vô hại.
        config: { aspectRatio: req.aspectRatio, durationSeconds: req.durationSec, numberOfVideos: 1, resolution: "720p" },
      });
      const started = Date.now();
      while (!op.done) {
        if (Date.now() - started > maxWaitMs) throw new StudioError("network", "Veo quá 8 phút chưa xong.");
        await sleep(pollMs);
        op = await ai.operations.getVideosOperation({ operation: op });
      }
      const video = pickVideo(op);
      await ai.files.download({ file: video, downloadPath: req.outPath });
      return { path: req.outPath, durationSec: req.durationSec, costUsd: videoCost(model, req.durationSec), model };
    },
  };
}
