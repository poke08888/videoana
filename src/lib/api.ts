export interface AnalyzeForm {
  title?: string;
  platform?: string;
  product?: string;
  genre?: string;
  notes?: string;
}

export interface AnalyzeResult {
  ok: boolean;
  analysis?: any;
  watchedVideo?: boolean;
  model?: string;
  error?: string;
  message?: string;
}

/** Gọi backend mổ xẻ video bằng Gemini. */
export async function analyzeVideo(opts: {
  form: AnalyzeForm;
  file?: File | null;
  youtubeUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<AnalyzeResult> {
  const fd = new FormData();
  fd.append("form", JSON.stringify(opts.form));
  if (opts.apiKey) fd.append("apiKey", opts.apiKey);
  if (opts.model) fd.append("model", opts.model);
  if (opts.youtubeUrl) fd.append("youtubeUrl", opts.youtubeUrl);
  if (opts.file) fd.append("video", opts.file);

  const res = await fetch("/api/analyze", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ từ server." }));
  if (!res.ok) return { ok: false, error: data.error, message: data.message || "Lỗi server." };
  return data as AnalyzeResult;
}

/** Kiểm tra kết nối Gemini API. */
export async function testGemini(apiKey: string, model: string): Promise<{ ok: boolean; message: string; model?: string }> {
  try {
    const res = await fetch("/api/gemini/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, model }),
    });
    return await res.json();
  } catch {
    return { ok: false, message: "Không gọi được backend. Backend đã chạy chưa?" };
  }
}
