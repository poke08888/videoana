/**
 * server/tiktokSearch.ts — tìm video TikTok theo TỪ KHÓA qua RapidAPI tokapi
 * (/v1/search/post), lọc theo ngưỡng tương tác (like/view), phân trang tới khi đủ
 * số lượng mục tiêu. Dùng cho tính năng "Campaign": gom 1 rổ video theo chủ đề rồi
 * mổ xẻ tìm điểm chung của nhóm tương tác cao.
 */
import { computeEngagement, type EngagementStats } from "./tiktok.js";

const HOST = "tokapi-mobile-version.p.rapidapi.com";

export interface SearchVideo {
  awemeId: string;
  desc: string;
  author: string; // unique_id
  nickname: string;
  link: string;
  stats: EngagementStats;
}

async function searchPage(keyword: string, count: number, offset: number, key: string, extra?: Record<string, number | string>): Promise<any> {
  const u = new URL(`https://${HOST}/v1/search/post`);
  u.searchParams.set("keyword", keyword);
  u.searchParams.set("count", String(count));
  u.searchParams.set("offset", String(offset));
  for (const [k, v] of Object.entries(extra || {})) u.searchParams.set(k, String(v));
  const res = await fetch(u.toString(), { headers: { "x-rapidapi-key": key, "x-rapidapi-host": HOST } });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    throw new Error(`Tokapi search HTTP ${res.status}: ${b.slice(0, 160)}`);
  }
  return res.json();
}

/**
 * Các "luồng" search để nhân tập kết quả: API chỉ trả ~300 mục/luồng qua offset,
 * nhưng mỗi (sort_type, publish_time) trả tập KHÁC nhau. sort_type=1 = "nhiều like
 * nhất" (trả thẳng video like cao — chủ lực cho lọc theo like). Gộp dedup → nhiều
 * hơn hẳn so với chỉ dùng sort mặc định.
 */
const SEARCH_STREAMS: Record<string, number>[] = [
  { sort_type: 1 }, // nhiều like nhất (toàn thời gian)
  { sort_type: 1, publish_time: 180 },
  { sort_type: 1, publish_time: 90 },
  { sort_type: 1, publish_time: 30 },
  { sort_type: 1, publish_time: 7 },
  { sort_type: 0 }, // liên quan (mặc định) — mở rộng độ phủ
  { sort_type: 0, publish_time: 180 },
  { sort_type: 0, publish_time: 90 },
];

/** Báo cáo tương tác + xếp hạng trong cụm campaign (đính vào phiếu như .eng). */
export interface EngReport {
  score: number; // 0–100 percentile tương tác trong cụm
  tier: "tốt" | "khá" | "thấp";
  likes: number;
  views: number;
  comments: number;
  shares: number;
  saves: number;
  engagementRate: number; // % = (like+comment+share+save)/view
  link?: string;
}

function rankOf(sorted: number[], x: number): number {
  if (!sorted.length) return 0;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= x) lo = m + 1; else hi = m; }
  return lo / sorted.length;
}

/**
 * Chấm "điểm tương tác" mỗi video so với chính cụm: blend 60% percentile LIKE +
 * 40% percentile TỶ LỆ tương tác (chuẩn hoá theo view). Xếp loại theo tercile.
 */
export function rankEngagement(videos: SearchVideo[]): EngReport[] {
  const er = (s: EngagementStats) => (s.views > 0 ? ((s.likes + s.comments + s.shares + s.saves) / s.views) * 100 : 0);
  const likes = videos.map((v) => v.stats.likes).filter((x) => x > 0).sort((a, b) => a - b);
  const rates = videos.map((v) => er(v.stats)).filter((x) => x > 0).sort((a, b) => a - b);
  return videos.map((v) => {
    const rate = Math.round(er(v.stats) * 10) / 10;
    const blend = 0.6 * rankOf(likes, v.stats.likes) + 0.4 * rankOf(rates, rate);
    const tier: EngReport["tier"] = blend >= 0.67 ? "tốt" : blend >= 0.34 ? "khá" : "thấp";
    return {
      score: Math.round(blend * 100),
      tier,
      likes: v.stats.likes,
      views: v.stats.views,
      comments: v.stats.comments,
      shares: v.stats.shares,
      saves: v.stats.saves,
      engagementRate: rate,
      link: v.link,
    };
  });
}

export interface SearchOpts {
  keyword?: string; // 1 từ khóa (giữ tương thích cũ)
  keywords?: string[]; // NHIỀU từ khóa — gộp dedup chung 1 rổ (đòn bẩy mạnh nhất để tăng số lượng)
  key: string;
  minLikes?: number;
  minViews?: number;
  target?: number; // số video cần gom (sau lọc)
  maxPages?: number; // trần số trang để chặn chi phí API
  region?: string; // lọc theo vùng (vd 'VN' — chỉ video Việt Nam)
  shouldStop?: () => boolean; // trả true để dừng sớm (người dùng bấm "Dừng tìm")
}

/** Tách chuỗi keyword người dùng nhập (phẩy / xuống dòng / chấm phẩy) thành mảng sạch, dedup. */
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(input || "").split(/[,;\n]+/)) {
    const k = raw.trim();
    if (!k) continue;
    const low = k.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(k);
  }
  return out;
}

/**
 * Gom video theo MỘT HOẶC NHIỀU từ khóa, lọc theo min like/view, tới khi đủ
 * `target` hoặc cạn nguồn/đụng trần `maxPages`. Mỗi keyword quét đủ các luồng
 * (sort_type×publish_time); mọi keyword chia sẻ CHUNG tập dedup theo aweme_id,
 * ngân sách trang và target — nên gộp nhiều keyword vét được nhiều video hơn hẳn.
 */
export async function searchVideos(
  opts: SearchOpts,
  onProgress?: (found: number, scanned: number, page: number) => void
): Promise<{ videos: SearchVideo[]; scanned: number; pages: number; exhausted: boolean; perKeyword: Record<string, number> }> {
  const { key } = opts;
  const keywords = (opts.keywords && opts.keywords.length ? opts.keywords : [opts.keyword || ""]).map((k) => k.trim()).filter(Boolean);
  const minLikes = Math.max(0, opts.minLikes || 0);
  const minViews = Math.max(0, opts.minViews || 0);
  const target = Math.min(Math.max(1, opts.target || 50), 500);
  // Trần TỔNG số lệnh search trên mọi keyword × luồng (chặn chi phí). Mặc định rộng tay.
  const pageBudget = Math.min(opts.maxPages || 160, 800);
  const region = (opts.region || "").trim();
  const PAGE = 20;
  const PAGES_PER_STREAM = 20; // mỗi luồng API cạn ~16 trang

  const out: SearchVideo[] = [];
  const seen = new Set<string>();
  const perKeyword: Record<string, number> = {};
  let scanned = 0;
  let pages = 0;
  let stoppedEarly = false; // dừng vì đủ target / hết ngân sách (còn có thể nhiều hơn)

  outer: for (const keyword of keywords) {
    const before = out.length;
    for (const extra of SEARCH_STREAMS) {
      if (out.length >= target || pages >= pageBudget || opts.shouldStop?.()) {
        stoppedEarly = true;
        perKeyword[keyword] = out.length - before;
        break outer;
      }
      let offset = 0;
      const streamExtra: Record<string, number | string> = region ? { ...extra, region } : extra;
      for (let p = 0; p < PAGES_PER_STREAM && out.length < target && pages < pageBudget; p++) {
        if (opts.shouldStop?.()) { stoppedEarly = true; perKeyword[keyword] = out.length - before; break outer; }
        let j: any;
        try {
          j = await searchPage(keyword, PAGE, offset, key, streamExtra);
          pages++;
        } catch {
          break; // lỗi luồng này → sang luồng khác
        }
        const list: any[] = j.search_item_list || [];
        for (const it of list) {
          const aw = it.aweme_info;
          if (!aw || !aw.aweme_id || seen.has(aw.aweme_id)) continue;
          seen.add(aw.aweme_id);
          scanned++;
          const st = aw.statistics || {};
          const likes = Number(st.digg_count) || 0;
          const views = Number(st.play_count) || 0;
          if (likes < minLikes || views < minViews) continue;
          const author = aw.author?.unique_id || "";
          out.push({
            awemeId: String(aw.aweme_id),
            desc: String(aw.desc || ""),
            author,
            nickname: String(aw.author?.nickname || ""),
            link: author ? `https://www.tiktok.com/@${author}/video/${aw.aweme_id}` : "",
            stats: computeEngagement(st, String(aw.aweme_id)),
          });
          if (out.length >= target) break;
        }
        onProgress?.(out.length, scanned, pages);
        if (!list.length || !j.has_more) break; // luồng này cạn → sang luồng khác
        const nextCursor = Number(j.cursor);
        offset = Number.isFinite(nextCursor) && nextCursor > offset ? nextCursor : offset + PAGE;
      }
    }
    perKeyword[keyword] = out.length - before;
  }
  // exhausted = đã quét hết mọi keyword × luồng mà vẫn chưa đủ target (thực sự hết nguồn).
  return { videos: out, scanned, pages, exhausted: !stoppedEarly && out.length < target, perKeyword };
}
