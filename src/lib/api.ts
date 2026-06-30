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

/** Lấy hồ sơ hiện tại (role/perms mới nhất) — refresh quyền không cần đăng nhập lại. */
export async function getMe(): Promise<any> {
  try {
    const res = await fetch("/api/auth/me", { headers: authHeaders() });
    return await res.json().catch(() => ({ ok: false }));
  } catch {
    return { ok: false };
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

// ── Phân tích chỉ số ads (import Excel) ──────────────────────────────────────
async function jget(url: string): Promise<any> {
  const res = await fetch(url, { headers: authHeaders() });
  return res.json().catch(() => ({ ok: false }));
}

/** Nạp file Excel chỉ số → tạo cụm + chạy mổ xẻ nội dung nền. */
export async function importAds(opts: { file: File; product: string; apiKey?: string; model?: string }): Promise<any> {
  const fd = new FormData();
  fd.append("file", opts.file);
  fd.append("product", opts.product);
  if (opts.apiKey) fd.append("apiKey", opts.apiKey);
  if (opts.model) fd.append("model", opts.model);
  try {
    const res = await fetch("/api/ads/import", { method: "POST", body: fd, headers: authHeaders() });
    return await res.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ." }));
  } catch {
    return { ok: false, message: "Không gọi được backend." };
  }
}

export const getHistoryItem = (id: string): Promise<any> => jget(`/api/history/${id}`);

/** Tìm video TikTok theo từ khóa + ngưỡng tương tác → tạo cụm campaign. */
// Bước 1: tìm + trả danh sách video để duyệt (chưa phân tích).
// Endpoint STREAM NDJSON (search có thể vài phút) — đọc từng dòng, cập nhật tiến
// trình qua onProgress, lấy dòng {type:"done"} làm kết quả cuối.
export async function searchCampaign(
  opts: { keyword: string; minLikes?: number; minViews?: number; target?: number },
  onProgress?: (p: { found: number; scanned: number; page: number }) => void
): Promise<any> {
  try {
    const res = await fetch("/api/campaign/search", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    // Lỗi xác thực/validate trả JSON thường (không stream).
    const ctype = res.headers.get("content-type") || "";
    if (!res.ok && !ctype.includes("ndjson")) {
      return await res.json().catch(() => ({ ok: false, message: `Lỗi máy chủ (${res.status}).` }));
    }
    if (!res.body) return await res.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ." }));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let done: any = null;
    const handleLine = (line: string) => {
      const s = line.trim();
      if (!s) return;
      let obj: any;
      try { obj = JSON.parse(s); } catch { return; }
      if (obj.type === "progress") onProgress?.({ found: obj.found, scanned: obj.scanned, page: obj.page });
      else if (obj.type === "done") done = obj;
    };
    for (;;) {
      const { value, done: rdDone } = await reader.read();
      if (rdDone) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    if (buf) handleLine(buf);
    return done || { ok: false, message: "Mất kết nối khi tìm kiếm (chưa nhận được kết quả)." };
  } catch {
    return { ok: false, message: "Không gọi được backend." };
  }
}

// Bước 2: gửi video đã chọn để tạo cohort + xếp hàng Gemini.
export async function createCampaign(opts: { keywords: string[]; videos: any[]; minLikes?: number; apiKey?: string; model?: string }): Promise<any> {
  try {
    const res = await fetch("/api/campaign/create", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    return await res.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ." }));
  } catch {
    return { ok: false, message: "Không gọi được backend." };
  }
}

export const listCohorts = (): Promise<any[]> => jget("/api/ads/cohorts");
export const getCohort = (id: string): Promise<any> => jget(`/api/ads/cohort/${id}`);
export const listKnowledge = (): Promise<any[]> => jget("/api/knowledge");
export const getKnowledge = (slug: string): Promise<any> => jget(`/api/knowledge/${slug}`);

export async function finalizeCohort(id: string): Promise<any> {
  const res = await fetch(`/api/ads/cohort/${id}/finalize`, { method: "POST", headers: authHeaders() });
  return res.json().catch(() => ({ ok: false }));
}

export async function saveKnowledge(slug: string, product: string, content: string): Promise<any> {
  const res = await fetch(`/api/knowledge/${slug}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ product, content }),
  });
  return res.json().catch(() => ({ ok: false }));
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
