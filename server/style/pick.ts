/**
 * server/style/pick.ts — chọn video để phân tích style (spec §2, §3 bước 1).
 * Top `count` theo view trong cửa sổ 90 ngày; thiếu thì nới 180 → 365; vẫn thiếu thì lấy tất cả.
 * Top `exemplars` view cao nhất trong tập đã chọn = mẫu chuẩn.
 */
import type { AccountVideo } from "../account.js";
import { STYLE } from "./config.js";
import type { PickedVideo } from "./types.js";

export function pickStyleVideos(videos: AccountVideo[], nowSec: number, opts: { count?: number; exemplars?: number } = {}) {
  const count = Math.max(1, opts.count ?? STYLE.pickCount);
  const exemplars = Math.max(1, opts.exemplars ?? STYLE.exemplarCount);
  const byViews = (a: AccountVideo, b: AccountVideo) => (b.stats?.views || 0) - (a.stats?.views || 0);
  let windowDays = STYLE.windowsDays[STYLE.windowsDays.length - 1];
  let pool: AccountVideo[] = [];
  for (const w of STYLE.windowsDays) {
    pool = videos.filter((v) => v.createTime > 0 && nowSec - v.createTime <= w * 86400);
    windowDays = w;
    if (pool.length >= count) break;
  }
  if (pool.length < count) pool = [...videos];
  const chosen = [...pool].sort(byViews).slice(0, count);
  const exemplarIds = chosen.slice(0, Math.min(exemplars, chosen.length)).map((v) => v.awemeId);
  const ex = new Set(exemplarIds);
  const out: PickedVideo[] = chosen.map((v) => ({
    awemeId: v.awemeId, link: v.link, title: String(v.desc || "").slice(0, 120), cover: "",
    views: v.stats?.views || 0, likes: v.stats?.likes || 0, createTime: v.createTime, isExemplar: ex.has(v.awemeId),
  }));
  const note = windowDays === STYLE.windowsDays[0]
    ? `Lấy ${out.length} video view cao nhất trong ${windowDays} ngày gần đây.`
    : `Kênh không đủ ${count} video trong ${STYLE.windowsDays[0]} ngày — đã nới cửa sổ lên ${windowDays} ngày (${out.length} video). Video cũ hơn ${STYLE.recentDays} ngày được tính trọng số ${String(STYLE.oldWeight).replace(".", ",")} khi tổng hợp.`;
  return { videos: out, exemplarIds, windowDays, note };
}
