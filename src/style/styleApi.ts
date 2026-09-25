/** src/style/styleApi.ts — client cho /api/style. Zip tải qua <a href> nên token gắn trên query `t`. */
import { authHeaders } from "../lib/api";
const jh = () => ({ ...authHeaders(), "Content-Type": "application/json" });
const parse = (r: Response) => r.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ từ server." }));

export const getStyleHealth = () => fetch("/api/style/health", { headers: authHeaders() }).then(parse);
export const pickStyle = (url: string, count = 30, exemplars = 5) => fetch("/api/style/pick", { method: "POST", headers: jh(), body: JSON.stringify({ url, count, exemplars }) }).then(parse);
export const createStyle = (body: { account: any; videos: any[]; exemplarIds: string[] }) => fetch("/api/style/create", { method: "POST", headers: jh(), body: JSON.stringify(body) }).then(parse);
export const listStyleProfiles = () => fetch("/api/style/profiles", { headers: authHeaders() }).then(parse);
export const getStyleProfile = (id: string) => fetch(`/api/style/profile/${id}`, { headers: authHeaders() }).then(parse);
export const aggregateStyle = (id: string) => fetch(`/api/style/profile/${id}/aggregate`, { method: "POST", headers: jh() }).then(parse);
export const retryStyleFailed = (id: string) => fetch(`/api/style/profile/${id}/retry-failed`, { method: "POST", headers: jh() }).then(parse);
export const deleteStyleProfile = (id: string) => fetch(`/api/style/profile/${id}`, { method: "DELETE", headers: authHeaders() }).then(parse);
export function styleZipUrl(id: string): string { let t = ""; try { t = localStorage.getItem("nonelab_token") || ""; } catch {} return `/api/style/profile/${id}/skill.zip?t=${encodeURIComponent(t)}`; }
export const fmtN = (n: number) => Math.round(n || 0).toLocaleString("vi-VN");
