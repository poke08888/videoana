/**
 * server/adsAnalytics.ts — đọc bảng chỉ số ads (TikTok Shop) dạng phantichcontent.xlsx
 * → chuẩn hoá → chấm hiệu quả từng video so với chính cụm (percentile) → kết luận.
 *
 * Khung cột (khớp theo TÊN tiêu đề, không phụ thuộc vị trí cứng):
 *   STT | Thumbnail | Link Video | Video ID | Orders (SKU) | Revenue | Traffic |
 *   Clicks | (Revenue lặp) | CTR | CVR | Cost | CPM | CPC
 *
 * Lưu ý dữ liệu thật: cột Cost lẫn đơn vị ở phần lớn dòng → KHÔNG dùng trực tiếp.
 * Ta tính lại Cost = CPM × Traffic (CPM ở đơn vị nghìn đồng/1000 hiển thị), khớp
 * đúng với các dòng Cost còn chuẩn, nhờ đó ROAS = Revenue / Cost đáng tin.
 */

export interface AdsMetrics {
  stt: number | null;
  videoId: string;
  link: string;
  orders: number;
  revenue: number; // VND
  traffic: number; // lượt tiếp cận/hiển thị
  clicks: number;
  ctr: number; // %  = clicks/traffic
  cvr: number; // %  = orders/clicks
  cost: number; // VND, đã chuẩn hoá = CPM × Traffic
  cpm: number; // như file (nghìn đồng / 1000 hiển thị)
  cpc: number; // như file (nghìn đồng / click)
  roas: number; // revenue / cost (0 nếu thiếu)
}

export type Tier = "tốt" | "khá" | "thấp";

export interface ScoredVideo extends AdsMetrics {
  efficiencyScore: number; // 0–100, percentile tổng hợp trong cụm
  label: Tier; // xếp loại tổng thể
  ctrTier: Tier; // CTR so với cụm
  cvrTier: Tier; // CVR so với cụm
  roasTier: Tier; // ROAS so với cụm
}

export interface Cohort {
  count: number;
  items: ScoredVideo[];
  benchmarks: Record<string, { p25: number; median: number; p75: number; p90: number }>;
  /** Ngưỡng tercile dùng để phân loại tốt/khá/thấp cho từng chỉ số. */
  thresholds: Record<string, { lo: number; hi: number }>;
  summary: { tot: number; kha: number; thap: number; medianRoas: number; medianCtr: number; medianCvr: number };
}

// ── Tiện ích số ─────────────────────────────────────────────────────────────
const numOf = (s: any): number => {
  if (s == null) return 0;
  const m = String(s).replace(/[^0-9.\-]/g, "");
  const n = Number(m);
  return Number.isFinite(n) ? n : 0;
};
const pctOf = (s: any): number => numOf(s); // "1.39%" → 1.39 (đã strip ký tự %)

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[i];
}

/** Phần trăm số phần tử ≤ x (percentile rank 0..1) trong mảng đã sắp xếp. */
function rankOf(sorted: number[], x: number): number {
  if (!sorted.length) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

// ── Đọc bảng → AdsMetrics ────────────────────────────────────────────────────
/** Tìm chỉ số cột (0-based) theo tiêu đề chứa từ khoá; trả -1 nếu không có. */
function findCol(header: string[], ...keys: string[]): number {
  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase();
    if (keys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

/**
 * Parse lưới xlsx → danh sách video (bỏ dòng tiêu đề + dòng tổng).
 * Cost được tính lại; chỉ giữ dòng có Video ID hợp lệ.
 */
export function parseAdsGrid(grid: string[][]): AdsMetrics[] {
  if (!grid.length) return [];
  const H = grid[0];
  const cSTT = findCol(H, "stt");
  const cLink = findCol(H, "link");
  const cVid = findCol(H, "video id", "videoid");
  const cOrders = findCol(H, "order");
  const cRev = findCol(H, "revenue"); // lấy cột Revenue ĐẦU TIÊN
  const cTraf = findCol(H, "traffic");
  const cClicks = findCol(H, "click");
  const cCtr = findCol(H, "ctr");
  const cCvr = findCol(H, "cvr");
  const cCpm = findCol(H, "cpm");
  const cCpc = findCol(H, "cpc");

  const out: AdsMetrics[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const videoId = (cVid >= 0 ? row[cVid] : "").trim();
    // Bỏ dòng tổng / dòng không có ID video thật.
    if (!videoId || videoId.toUpperCase() === "N/A" || !/^\d{6,}$/.test(videoId)) continue;

    // Link trong file bị cắt số (mất độ chính xác) → dựng lại từ Video ID + @username.
    const rawLink = cLink >= 0 ? row[cLink].trim() : "";
    const userM = /@([A-Za-z0-9._]+)/.exec(rawLink);
    const link = userM ? `https://www.tiktok.com/@${userM[1]}/video/${videoId}` : rawLink;

    const traffic = numOf(row[cTraf]);
    const clicks = numOf(row[cClicks]);
    const cpm = numOf(row[cCpm]);
    const cpc = numOf(row[cCpc]);
    const revenue = numOf(row[cRev]);
    // Cost chuẩn hoá: ưu tiên CPM×Traffic; dự phòng CPC×Clicks×1000.
    let cost = cpm > 0 && traffic > 0 ? cpm * traffic : 0;
    if (cost <= 0 && cpc > 0 && clicks > 0) cost = cpc * clicks * 1000;
    const roas = cost > 0 ? Math.round((revenue / cost) * 100) / 100 : 0;

    out.push({
      stt: cSTT >= 0 && row[cSTT] ? Math.round(numOf(row[cSTT])) : null,
      videoId,
      link,
      orders: Math.round(numOf(row[cOrders])),
      revenue,
      traffic,
      clicks,
      ctr: pctOf(row[cCtr]),
      cvr: pctOf(row[cCvr]),
      cost: Math.round(cost),
      cpm,
      cpc,
      roas,
    });
  }
  return out;
}

// ── Chấm điểm so với cụm ──────────────────────────────────────────────────────
const METRIC_KEYS = ["roas", "revenue", "orders", "ctr", "cvr", "traffic"] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

// Dưới ngưỡng traffic này, ROAS/CVR tính từ quá ít lượt nên không đáng tin → bỏ
// khỏi thống kê và coi là trung tính khi chấm điểm.
const MIN_RELIABLE_TRAFFIC = 1000;
const reliableRoas = (it: AdsMetrics): boolean => it.traffic >= MIN_RELIABLE_TRAFFIC && it.roas > 0;

/** Lọc giá trị hợp lệ cho thống kê (bỏ 0, outlier CVR > 100%, ROAS từ traffic quá thấp). */
function valuesFor(items: AdsMetrics[], key: MetricKey): number[] {
  return items
    .filter((it) => !(key === "roas" && !reliableRoas(it)))
    .map((it) => it[key])
    .filter((v) => Number.isFinite(v) && v > 0 && !(key === "cvr" && v > 100))
    .sort((a, b) => a - b);
}

function tierFromRank(rank: number): Tier {
  if (rank >= 0.67) return "tốt";
  if (rank >= 0.34) return "khá";
  return "thấp";
}

/**
 * Dựng cụm: chấm điểm hiệu quả từng video (percentile tổng hợp có trọng số) +
 * gắn xếp loại CTR/CVR/ROAS riêng để phục vụ rút kết luận về nội dung.
 * Trọng số: ROAS 0.40 · Revenue 0.25 · CVR 0.20 · CTR 0.15 (đề cao hiệu quả chi phí).
 */
export function buildCohort(items: AdsMetrics[]): Cohort {
  const sorted: Record<string, number[]> = {};
  for (const k of METRIC_KEYS) sorted[k] = valuesFor(items, k);

  const benchmarks: Cohort["benchmarks"] = {};
  const thresholds: Cohort["thresholds"] = {};
  for (const k of METRIC_KEYS) {
    const s = sorted[k];
    benchmarks[k] = { p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75), p90: quantile(s, 0.9) };
    thresholds[k] = { lo: quantile(s, 0.34), hi: quantile(s, 0.67) };
  }

  const W: Record<string, number> = { roas: 0.4, revenue: 0.25, cvr: 0.2, ctr: 0.15 };
  const wsum = Object.values(W).reduce((a, b) => a + b, 0);
  const scored: ScoredVideo[] = items.map((it) => {
    // ROAS/CVR không đáng tin (traffic thấp / outlier) → coi trung tính (rank 0.5).
    const rRoas = reliableRoas(it) ? rankOf(sorted.roas, it.roas) : 0.5;
    const rCvr = it.cvr > 0 && it.cvr <= 100 ? rankOf(sorted.cvr, it.cvr) : 0.5;
    const ranks: Record<string, number> = {
      roas: rRoas,
      revenue: rankOf(sorted.revenue, it.revenue),
      cvr: rCvr,
      ctr: rankOf(sorted.ctr, it.ctr),
    };
    const blend = Object.entries(W).reduce((acc, [k, w]) => acc + w * ranks[k], 0) / wsum;
    return {
      ...it,
      efficiencyScore: Math.round(blend * 100),
      label: tierFromRank(blend),
      ctrTier: tierFromRank(rankOf(sorted.ctr, it.ctr)),
      cvrTier: tierFromRank(rCvr),
      roasTier: reliableRoas(it) ? tierFromRank(rRoas) : "khá",
    };
  });

  const tot = scored.filter((v) => v.label === "tốt").length;
  const kha = scored.filter((v) => v.label === "khá").length;
  const thap = scored.filter((v) => v.label === "thấp").length;

  return {
    count: scored.length,
    items: scored,
    benchmarks,
    thresholds,
    summary: {
      tot,
      kha,
      thap,
      medianRoas: benchmarks.roas.median,
      medianCtr: benchmarks.ctr.median,
      medianCvr: benchmarks.cvr.median,
    },
  };
}
