/**
 * server/account.ts — phân tích tài khoản: resolve link→sec_id, lấy video theo
 * tài khoản (TikTok/Douyin), lọc theo like/view/ER/ngày. HTTP layer injectable
 * để test hermetic (không gọi API thật trong unit test).
 */
import { computeEngagement, type EngagementStats } from "./tiktok.js";

export type Platform = "tiktok" | "douyin";

export const TIKTOK_HOST = "tokapi-mobile-version.p.rapidapi.com";
export const DOUYIN_HOST = "douyin-api6.p.rapidapi.com";

export type ApiGet = (host: string, pathname: string, params: Record<string, string>, key: string) => Promise<any>;

/** HTTP GET JSON qua RapidAPI (mặc định). Thay bằng stub trong test. */
export const defaultApiGet: ApiGet = async (host, pathname, params, key) => {
  const u = new URL(`https://${host}${pathname}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v);
  const res = await fetch(u.toString(), { headers: { "x-rapidapi-key": key, "x-rapidapi-host": host } });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    throw new Error(`RapidAPI ${host} HTTP ${res.status}: ${b.slice(0, 160)}`);
  }
  return res.json();
};

export interface Account {
  platform: Platform;
  secId: string;
  handle: string;
  nickname: string;
  avatar: string;
}

/** Chuẩn hoá input người dùng thành {platform, ref}. TikTok ref=handle; Douyin ref=url. */
export function normalizeAccountInput(input: string): { platform: Platform; ref: string } | null {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/(douyin|iesdouyin)\.com/i.test(s)) {
    const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    return { platform: "douyin", ref: url };
  }
  if (/tiktok\.com/i.test(s)) {
    const m = s.match(/@([A-Za-z0-9_.\-]+)/);
    return m ? { platform: "tiktok", ref: m[1] } : null;
  }
  const bare = s.replace(/^@/, "");
  if (/^[A-Za-z0-9_.\-]+$/.test(bare)) return { platform: "tiktok", ref: bare };
  return null;
}

export interface AccountVideo {
  awemeId: string;
  desc: string;
  author: string;
  nickname: string;
  link: string;
  createTime: number; // epoch giây
  stats: EngagementStats;
}

export interface AccountFilter {
  minLikes?: number;
  minViews?: number;
  minER?: number; // %
  sinceDays?: number; // 0 = không giới hạn
}

/** Tỉ lệ tương tác (%) = (like+cmt+share+save)/view*100. 0 nếu view≤0. */
export function engagementRate(s: EngagementStats): number {
  if (!s || s.views <= 0) return 0;
  return ((s.likes + s.comments + s.shares + s.saves) / s.views) * 100;
}

/** Lọc danh sách video theo bộ lọc. `nowSec` truyền vào để test tất định. */
export function filterAccountVideos(videos: AccountVideo[], filter: AccountFilter, nowSec: number): AccountVideo[] {
  const minLikes = Math.max(0, filter.minLikes || 0);
  const minViews = Math.max(0, filter.minViews || 0);
  const minER = Math.max(0, filter.minER || 0);
  const sinceDays = Math.max(0, filter.sinceDays || 0);
  const cutoff = sinceDays > 0 ? nowSec - sinceDays * 86400 : 0;
  return videos.filter((v) => {
    if (v.stats.likes < minLikes) return false;
    if (v.stats.views < minViews) return false;
    if (minER > 0 && engagementRate(v.stats) < minER) return false;
    if (sinceDays > 0 && v.createTime > 0 && v.createTime < cutoff) return false;
    return true;
  });
}

function firstAvatar(u: any): string {
  for (const f of [u?.avatar_168x168, u?.avatar_larger, u?.avatar_medium, u?.avatar_thumb]) {
    const url = f?.url_list?.[0];
    if (typeof url === "string" && url) return url;
  }
  return "";
}

/** Resolve link/@handle → Account (sec_id + nickname + avatar). */
export async function resolveAccount(input: string, key: string, apiGet: ApiGet = defaultApiGet): Promise<Account> {
  const norm = normalizeAccountInput(input);
  if (!norm) throw new Error("Link tài khoản không hợp lệ. Dán link TikTok (tiktok.com/@ten) hoặc Douyin (douyin.com/user/...).");
  if (norm.platform === "tiktok") {
    const j = await apiGet(TIKTOK_HOST, `/v1/user/@${norm.ref}`, {}, key);
    const u = j?.user;
    const secId = String(u?.sec_uid || "");
    if (!secId) throw new Error(`Không tìm thấy tài khoản TikTok @${norm.ref}.`);
    return { platform: "tiktok", secId, handle: norm.ref, nickname: String(u?.nickname || norm.ref), avatar: firstAvatar(u) };
  }
  const sj = await apiGet(DOUYIN_HOST, "/api/v1/douyin/web/get_sec_user_id", { url: norm.ref }, key);
  const secId = String(sj?.data || "");
  if (!secId) throw new Error("Không resolve được tài khoản Douyin từ link (kiểm tra lại link hoặc RapidAPI key).");
  let nickname = "";
  let avatar = "";
  try {
    const pj = await apiGet(DOUYIN_HOST, "/api/v1/douyin/web/handler_user_profile", { sec_user_id: secId }, key);
    nickname = String(pj?.data?.user?.nickname || "");
    avatar = firstAvatar(pj?.data?.user);
  } catch {
    /* nickname là tuỳ chọn — bỏ qua nếu lỗi */
  }
  return { platform: "douyin", secId, handle: nickname || secId.slice(0, 12), nickname: nickname || "Tài khoản Douyin", avatar };
}
