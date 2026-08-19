/**
 * server/studio/engines/image.ts — ảnh khoá bằng Nano Banana Pro (Gemini 3 Pro Image).
 * Ảnh sản phẩm + bối cảnh là tham chiếu cứng; prompt tiếng Anh; 9:16 2K.
 */
import fs from "node:fs";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { STUDIO } from "../config.js";
import { imageCost } from "../pricing.js";
import { StudioError } from "../errors.js";
import type { ImageEngine, ImageRequest } from "./types.js";

export function buildImageParts(req: ImageRequest): any[] {
  const parts: any[] = req.refs.map((r) => ({
    inlineData: { data: fs.readFileSync(r.path).toString("base64"), mimeType: r.mimeType },
  }));
  parts.push(req.prompt);
  return parts;
}

export function extractImage(resp: any): { data: string; mimeType: string } {
  const cand = resp?.candidates?.[0];
  const parts: any[] = cand?.content?.parts || [];
  const p = parts.find((x) => x?.inlineData?.data);
  if (p) return { data: p.inlineData.data, mimeType: p.inlineData.mimeType || "image/png" };
  const reason = String(cand?.finishReason || resp?.promptFeedback?.blockReason || "");
  if (/SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(reason)) throw new StudioError("blocked", `Ảnh bị model từ chối (${reason}).`);
  throw new StudioError("other", "Model không trả về ảnh.");
}

export function nanoImageEngine(apiKey: string, model = STUDIO.imageModel): ImageEngine {
  const ai = new GoogleGenAI({ apiKey });
  return {
    name: model,
    async generate(req) {
      const resp = await ai.models.generateContent({
        model,
        contents: createUserContent(buildImageParts(req)),
        config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: req.aspectRatio, imageSize: req.size } },
      });
      const img = extractImage(resp);
      fs.writeFileSync(req.outPath, Buffer.from(img.data, "base64"));
      return { path: req.outPath, mimeType: img.mimeType, costUsd: imageCost(model, req.size), model };
    },
  };
}
