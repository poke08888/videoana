/**
 * server/account.ts — phân tích tài khoản: resolve link→sec_id, lấy video theo
 * tài khoản (TikTok/Douyin), lọc theo like/view/ER/ngày. HTTP layer injectable
 * để test hermetic (không gọi API thật trong unit test).
 */
import { computeEngagement, type EngagementStats } from "./tiktok.js";

export type Platform = "tiktok" | "douyin";

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
