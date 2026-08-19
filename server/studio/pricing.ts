/**
 * server/studio/pricing.ts — BẢNG GIÁ DUY NHẤT của Xưởng.
 * Số liệu 19/08/2026 (spec mục 9). Model chưa có giá → ném lỗi, không trả 0.
 */
export const PRICES = {
  videoPerSec: {
    "veo-3.1-lite-generate-preview": 0.05,
    "veo-3.1-fast-generate-preview": 0.15,
    "veo-3.1-generate-preview": 0.4,
    "kling-3.0-standard": 0.084,
    "kling-3.0-pro": 0.112,
    fake: 0,
  } as Record<string, number>,
  imagePerImage: {
    "gemini-3-pro-image": 0.134,
    "gemini-3-pro-image@4K": 0.24,
    fake: 0,
  } as Record<string, number>,
  voicePer1kChars: { edge: 0, fpt: 0.02, fake: 0 } as Record<string, number>,
  scriptPerCall: 0.01,
};

export const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function videoCost(model: string, seconds: number): number {
  const p = PRICES.videoPerSec[model];
  if (p === undefined) throw new Error(`Chưa có giá cho model video: ${model}`);
  return round4(p * seconds);
}

export function imageCost(model: string, size: "1K" | "2K" | "4K" = "2K"): number {
  const p = size === "4K" ? PRICES.imagePerImage[`${model}@4K`] ?? PRICES.imagePerImage[model] : PRICES.imagePerImage[model];
  if (p === undefined) throw new Error(`Chưa có giá cho model ảnh: ${model}`);
  return p;
}

export function voiceCost(engine: string, chars: number): number {
  const p = PRICES.voicePer1kChars[engine];
  if (p === undefined) throw new Error(`Chưa có giá cho engine giọng: ${engine}`);
  return round4((p * chars) / 1000);
}

export interface Estimate { imagesUsd: number; clipsUsd: number; voiceUsd: number; totalUsd: number }

export function estimateProject(a: { shots: number; clipLen: number; videoModel: string; imageModel: string; voiceEngine: string; dialogChars: number }): Estimate {
  const imagesUsd = round4(a.shots * imageCost(a.imageModel, "2K"));
  const clipsUsd = round4(a.shots * videoCost(a.videoModel, a.clipLen));
  const voiceUsd = voiceCost(a.voiceEngine, a.dialogChars);
  return { imagesUsd, clipsUsd, voiceUsd, totalUsd: round4(imagesUsd + clipsUsd + voiceUsd) };
}

/** Quy đổi tham khảo, làm tròn nghìn đồng. */
export function usdToVnd(usd: number, rate = 26000): number {
  return Math.round((usd * rate) / 1000) * 1000;
}
