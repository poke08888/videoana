/**
 * gemini.ts — kết nối thật tới Google Gemini API.
 *
 * Luồng (theo script gốc scripts/analyze_video.py của skill):
 *   1. Upload MP4 lên Gemini Files API -> chờ trạng thái ACTIVE.
 *   2. generateContent([videoPart, prompt]) với model gemini-3-flash-preview.
 *   3. Yêu cầu JSON, parse ra object "Phiếu mổ xẻ".
 * YouTube/link công khai: truyền thẳng fileUri, không cần upload.
 */
import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import { buildAnalysisPrompt, DEFAULT_MODEL, type AnalyzeForm } from "./nonelabPrompt.js";

function client(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

/** Kiểm tra key + model có hợp lệ không (dùng cho nút "Kết nối" ở Quản trị). */
export async function testConnection(apiKey: string, model?: string): Promise<{ ok: boolean; model: string; message: string }> {
  const ai = client(apiKey);
  const useModel = model || DEFAULT_MODEL;
  try {
    // Liệt kê model — gọi rẻ, đủ để xác thực key.
    const pager = await ai.models.list();
    let count = 0;
    for await (const _m of pager) {
      count++;
      if (count >= 1) break;
    }
    return { ok: true, model: useModel, message: "Đã kết nối Gemini API thành công" };
  } catch (err: any) {
    return { ok: false, model: useModel, message: humanizeError(err) };
  }
}

const state = (f: any): string => String(f?.state?.name ?? f?.state ?? "").toUpperCase();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lỗi tạm thời của Gemini (quá tải/giới hạn nhịp) — nên thử lại. */
function isTransient(err: any): boolean {
  const m = String(err?.message || err || "");
  return /\b503\b|\b429\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|temporarily|try again/i.test(m);
}

/** Thử lại với backoff tăng dần khi gặp lỗi tạm thời (quan trọng cho hàng đợi lớn). */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  const backoff = [2000, 5000, 12000, 20000];
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransient(e) || i === tries - 1) throw e;
      await sleep(backoff[i] ?? 20000);
    }
  }
  throw last;
}

async function uploadAndWait(ai: GoogleGenAI, filePath: string, mimeType: string) {
  let file = await ai.files.upload({ file: filePath, config: { mimeType } });
  const started = Date.now();
  const MAX_WAIT = 180_000; // 3 phút
  while (state(file) === "PROCESSING") {
    if (Date.now() - started > MAX_WAIT) {
      throw new Error("Gemini xử lý video quá lâu (>180s).");
    }
    await new Promise((r) => setTimeout(r, 4000));
    file = await ai.files.get({ name: file.name as string });
  }
  if (state(file) !== "ACTIVE") {
    throw new Error(`Video rơi vào trạng thái lạ: ${state(file)}`);
  }
  return file;
}

export interface AnalyzeArgs {
  apiKey: string;
  model?: string;
  form: AnalyzeForm;
  videoPath?: string; // file MP4 đã upload lên server
  mimeType?: string;
  youtubeUrl?: string; // hoặc link công khai
  productKnowledge?: string; // kho kiến thức riêng cho sản phẩm (bơm vào prompt)
  onProgress?: (msg: string) => void;
}

export async function analyzeVideo(args: AnalyzeArgs): Promise<any> {
  const ai = client(args.apiKey);
  const model = args.model || DEFAULT_MODEL;
  const hasVideo = !!(args.videoPath || args.youtubeUrl);
  const prompt = buildAnalysisPrompt(args.form, hasVideo, args.productKnowledge);

  let parts: any[];
  if (args.youtubeUrl) {
    args.onProgress?.("Đang nạp link video...");
    parts = [createPartFromUri(args.youtubeUrl, args.mimeType || "video/mp4"), prompt];
  } else if (args.videoPath) {
    args.onProgress?.("Đang upload video lên Gemini...");
    const file = await uploadAndWait(ai, args.videoPath, args.mimeType || "video/mp4");
    args.onProgress?.("Video sẵn sàng — đang mổ xẻ...");
    parts = [createPartFromUri(file.uri as string, file.mimeType as string), prompt];
  } else {
    // Không có video: chỉ suy luận từ mô tả.
    parts = [prompt];
  }

  const resp = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: createUserContent(parts),
      config: { responseMimeType: "application/json", temperature: 0.7 },
    })
  );

  const text = (resp.text ?? "").trim();
  const json = extractJSON(text);
  if (!json || !json.acts || !json.checklist) {
    throw new Error("Gemini trả về JSON không hợp lệ.");
  }
  return json;
}

/** Gọi Gemini với prompt THUẦN CHỮ (không video), yêu cầu trả JSON — dùng cho
 *  báo cáo tổng hợp nhiều phiếu. Có retry khi Gemini quá tải. */
export async function generateJSON(apiKey: string, model: string | undefined, prompt: string): Promise<any> {
  const ai = client(apiKey);
  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: model || DEFAULT_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.5 },
    })
  );
  const json = extractJSON((resp.text ?? "").trim());
  if (!json) throw new Error("Gemini trả về JSON không hợp lệ.");
  return json;
}

function extractJSON(text: string): any | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i < 0 || j < 0) return null;
  try {
    return JSON.parse(t.slice(i, j + 1));
  } catch {
    return null;
  }
}

export function humanizeError(err: any): string {
  const msg = String(err?.message || err || "");
  if (/api[_ ]?key|API key not valid|invalid.*key|PERMISSION_DENIED|401|403/i.test(msg)) {
    return "API key không hợp lệ hoặc thiếu quyền. Kiểm tra lại key Gemini.";
  }
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return "Đã hết hạn mức Gemini (quota). Thử lại sau hoặc dùng key khác.";
  }
  if (/not found|404|model/i.test(msg) && /model/i.test(msg)) {
    return "Model không tồn tại hoặc key chưa được cấp quyền dùng model này.";
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|ETIMEDOUT/i.test(msg)) {
    return "Không kết nối được tới Gemini (mạng bị chặn?).";
  }
  return msg || "Lỗi không xác định khi gọi Gemini.";
}
