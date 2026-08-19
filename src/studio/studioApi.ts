/** src/studio/studioApi.ts — client cho /api/studio. Đường dẫn file: dùng studioFileUrl (token trên query vì <img>/<video> không gửi header). */
import { authHeaders } from "../lib/api";

const jh = () => ({ ...authHeaders(), "Content-Type": "application/json" });
const parse = (r: Response) => r.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ từ server." }));

export const getStudioHealth = () => fetch("/api/studio/health", { headers: authHeaders() }).then(parse);
export const listStudioMusic = () => fetch("/api/studio/music", { headers: authHeaders() }).then(parse);
export const listStudioProjects = () => fetch("/api/studio/projects", { headers: authHeaders() }).then(parse);
export const createStudioProject = (fd: FormData) => fetch("/api/studio/projects", { method: "POST", headers: authHeaders(), body: fd }).then(parse);
export const getStudioProject = (id: string) => fetch(`/api/studio/projects/${id}`, { headers: authHeaders() }).then(parse);
export const deleteStudioProject = (id: string) => fetch(`/api/studio/projects/${id}`, { method: "DELETE", headers: authHeaders() }).then(parse);
export const patchStudioProject = (id: string, body: any) => fetch(`/api/studio/projects/${id}`, { method: "PATCH", headers: jh(), body: JSON.stringify(body) }).then(parse);
export const genStudioScript = (id: string, body: { source: "ai" | "manual"; shots?: any[]; notes?: string; count?: number; apiKey?: string; model?: string; caption?: string; hashtags?: string[] }) =>
  fetch(`/api/studio/projects/${id}/script`, { method: "POST", headers: jh(), body: JSON.stringify(body) }).then(parse);
export const saveStudioShots = (id: string, shots: any[]) => fetch(`/api/studio/projects/${id}/shots`, { method: "PUT", headers: jh(), body: JSON.stringify({ shots }) }).then(parse);
export const requestStudioKeyframes = (id: string, shotIds?: string[]) => fetch(`/api/studio/projects/${id}/keyframes`, { method: "POST", headers: jh(), body: JSON.stringify({ shotIds }) }).then(parse);
export const approveStudioShot = (shotId: string, approved: 0 | 1) => fetch(`/api/studio/shots/${shotId}/approve`, { method: "POST", headers: jh(), body: JSON.stringify({ approved }) }).then(parse);
export const regenerateStudioShot = (shotId: string, image_prompt?: string) => fetch(`/api/studio/shots/${shotId}/regenerate`, { method: "POST", headers: jh(), body: JSON.stringify({ image_prompt }) }).then(parse);
export const requestStudioClips = (id: string, tier: "draft" | "final") => fetch(`/api/studio/projects/${id}/clips`, { method: "POST", headers: jh(), body: JSON.stringify({ tier }) }).then(parse);
export const requestStudioAssemble = (id: string, body: { voice: string; voiceRate: number; music: string | null; transition: string }) => fetch(`/api/studio/projects/${id}/assemble`, { method: "POST", headers: jh(), body: JSON.stringify(body) }).then(parse);
export const getStudioEstimate = (id: string, tier: "draft" | "final") => fetch(`/api/studio/projects/${id}/estimate?tier=${tier}`, { headers: authHeaders() }).then(parse);

export function studioFileUrl(projectId: string, rel: string | null | undefined): string {
  if (!rel) return "";
  let t = ""; try { t = localStorage.getItem("nonelab_token") || ""; } catch {}
  return `/api/studio/file/${projectId}/${rel}?t=${encodeURIComponent(t)}`;
}

/** Giữ đồng bộ với server/studio/text.ts. */
export const countSyllables = (text: string) => String(text || "").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
