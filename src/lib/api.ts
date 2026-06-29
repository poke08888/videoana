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

/** Lấy token phiên (JWT) đã lưu để gắn vào header Authorization. */
export function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem("nonelab_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

/** Gọi backend mổ xẻ video bằng Gemini. */
export async function analyzeVideo(opts: {
  form: AnalyzeForm;
  file?: File | null;
  youtubeUrl?: string;
  tiktokUrl?: string;
  apiKey?: string;
  model?: string;
  email?: string;
}): Promise<AnalyzeResult> {
  const fd = new FormData();
  fd.append("form", JSON.stringify(opts.form));
  if (opts.apiKey) fd.append("apiKey", opts.apiKey);
  if (opts.model) fd.append("model", opts.model);
  if (opts.youtubeUrl) fd.append("youtubeUrl", opts.youtubeUrl);
  if (opts.tiktokUrl) fd.append("tiktokUrl", opts.tiktokUrl);
  if (opts.file) fd.append("video", opts.file);

  const res = await fetch("/api/analyze", { method: "POST", body: fd, headers: authHeaders() });
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

/** Gọi backend phân tích hàng loạt video chạy nền (Batch Queue). */
export async function analyzeVideoBatch(opts: {
  form: AnalyzeForm;
  files: File[];
  tiktokUrls?: string[];
  apiKey?: string;
  model?: string;
  email?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const fd = new FormData();
  fd.append("form", JSON.stringify(opts.form));
  if (opts.apiKey) fd.append("apiKey", opts.apiKey);
  if (opts.model) fd.append("model", opts.model);
  if (opts.tiktokUrls && opts.tiktokUrls.length) fd.append("tiktokUrls", JSON.stringify(opts.tiktokUrls));

  for (const file of opts.files) {
    fd.append("videos", file); // Multer array field name is "videos"
  }

  try {
    const res = await fetch("/api/analyze/batch", { method: "POST", body: fd, headers: authHeaders() });
    const data = await res.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ từ server." }));
    if (!res.ok) return { ok: false, message: data.message || "Lỗi server." };
    return data;
  } catch {
    return { ok: false, message: "Không gọi được backend. Backend đã chạy chưa?" };
  }
}
