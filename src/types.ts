export type Level = "ok" | "mid" | "low";

export interface Beat {
  ts: string;
  frame?: string; // data-URL ảnh frame thật trích từ video (lưu kèm phiếu)
  vi: string;
  voiceover?: string; // voice-off/lời thoại nguyên văn trong cảnh
  note?: string;
  size?: string;
  angle?: string;
  move?: string;
  action?: string;
  setting?: string;
  sound?: string;
  wardrobe?: string;
  cast?: string;
  matrix?: { k: string; en: string; v: string }[];
}

export interface Act {
  range: string;
  title: string;
  summary: string;
  no?: string;
  beats: Beat[];
}

export interface ChecklistRow {
  crit: string;
  level: Level;
  note: string;
  isOk?: boolean;
  isMid?: boolean;
  isLow?: boolean;
  levelLabel?: string;
}

export interface Hook {
  quote?: string;
  type?: string;
  viewerFirst?: boolean;
  score?: number;
  note?: string;
}

/** Chỉ số tương tác thật lấy từ nền tảng (TikTok qua TokAPI). */
export interface EngagementStats {
  source: string; // "TikTok"
  awemeId?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

/** Chỉ số ads (TikTok Shop) + đánh giá hiệu quả so với cụm — đính kèm phiếu. */
export interface AdsReport {
  efficiencyScore: number; // 0–100 percentile trong cụm
  label: string; // tốt / khá / thấp
  orders: number;
  revenue: number;
  traffic: number;
  clicks: number;
  ctr: number;
  cvr: number;
  cost: number;
  cpm: number;
  cpc: number;
  roas: number;
  ctrTier: string;
  cvrTier: string;
  roasTier: string;
  link?: string;
}

export interface Analysis {
  subtitle: string;
  contentSummary?: string; // đoạn tóm tắt nội dung video (hiện dưới tiêu đề phiếu)
  sourceUrl?: string; // link video gốc (TikTok/YouTube) để đối chứng nội dung
  stats?: EngagementStats;
  ads?: AdsReport;
  eng?: { score: number; tier?: string; engagementRate?: number }; // điểm tương tác trong cụm campaign
  score?: number; // điểm nội dung tổng (0–100) — đính kèm khi mở phiếu để hiển thị trong phiếu
  meta: {
    platform: string;
    duration: string;
    genre: string;
    product: string;
    face: string;
    cta: string;
  };
  verdict: { label: string; big: string; note: string }[];
  hook?: Hook;
  acts: Act[];
  checklist: ChecklistRow[];
  formulaVisual: string;
  formulaScript: string;
  verdictText: string;
  quotes: string[];
  visuals: string[];
  objchuan?: { type: string; note: string };
  newAngles?: string[];
  steals?: { thuphap: string; at: string; why: string; how: string }[];
}

export interface FormState {
  title: string;
  platform: string;
  product: string;
  genre: string;
  notes: string;
  file: string; // tên file hiển thị
}

export type Screen = "dashboard" | "upload" | "report" | "history" | "admin" | "analyzing" | "error" | "auth" | "ads" | "campaign";

export interface HistoryEntry {
  id: string;
  title: string;
  platform: string;
  product: string;
  date: string;
  score: number;
  analysis: Analysis;
  thumb: string;
  status?: "pending" | "processing" | "completed" | "failed";
}

export type Perms = { analyze: boolean; export: boolean; history: boolean; manage: boolean };

export interface AdminUser {
  name: string;
  email: string;
  role: string;
  count: number;
  active: boolean;
  avBg: string;
  perms: Perms;
}

export interface User {
  name: string;
  email: string;
  role: string;
  perms: Perms;
}
