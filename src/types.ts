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

export interface Analysis {
  subtitle: string;
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

export type Screen = "dashboard" | "upload" | "report" | "history" | "admin" | "analyzing" | "error" | "auth";

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
