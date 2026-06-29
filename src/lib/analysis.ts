import type { Analysis, AdminUser, FormState, HistoryEntry, Level, Perms } from "../types";

const LEVEL_LABELS: Record<Level, string> = { ok: "Đạt", mid: "Một phần", low: "Yếu" };

/** Chuẩn hoá object analysis (từ AI hoặc mẫu) về đúng shape render được. */
export function decorate(raw: any, f: Partial<FormState>): Analysis {
  const a: Analysis = { ...raw };
  a.subtitle = a.subtitle || ((f.product || "Sản phẩm") + " — " + (f.title || "Phiếu mổ xẻ"));
  a.meta = Object.assign(
    { platform: f.platform || "TikTok / Douyin", duration: "≈45 giây · dọc 9:16", genre: f.genre || "Reviewer độc thoại", product: f.product || "Sản phẩm", face: "Creator", cta: "Kêu gọi mua ngay" },
    raw.meta || {}
  );
  if (f.platform) a.meta.platform = f.platform;
  if (f.product) a.meta.product = f.product;
  if (f.genre) a.meta.genre = f.genre;

  a.verdict = (raw.verdict || []).slice(0, 4);

  a.acts = (raw.acts || []).map((act: any, i: number) => {
    act.no = String(i + 1).padStart(2, "0");
    if (!act.beats || !act.beats.length) {
      act.beats = [{ ts: (act.range || "0:00").split(/[–-]/)[0].trim(), vi: act.title || "", note: act.summary || "" }];
    }
    act.beats = act.beats.map((b: any) => {
      b.size = b.size || "Cận (CU)";
      b.angle = b.angle || "Ngang tầm mắt";
      b.move = b.move || "Tĩnh";
      b.matrix = [
        { k: "Hành động", en: "ACTION", v: b.action || "—" },
        { k: "Bối cảnh", en: "SETTING", v: b.setting || "—" },
        { k: "Âm thanh", en: "SOUND", v: b.sound || "—" },
        { k: "Trang phục", en: "WARDROBE", v: b.wardrobe || "—" },
        { k: "Diễn viên", en: "CAST", v: b.cast || "—" },
      ];
      return b;
    });
    return act;
  });

  a.checklist = (raw.checklist || []).map((r: any) => {
    const lv = ((r.level || "ok") as string).toLowerCase() as Level;
    const safe: Level = lv === "ok" || lv === "mid" || lv === "low" ? lv : "ok";
    return { ...r, level: safe, isOk: safe === "ok", isMid: safe === "mid", isLow: safe === "low", levelLabel: LEVEL_LABELS[safe] };
  });

  a.quotes = a.quotes || [];
  a.visuals = a.visuals || [];
  a.newAngles = a.newAngles || [];
  a.steals = a.steals || [];
  a.formulaVisual = a.formulaVisual || "";
  a.formulaScript = a.formulaScript || "";
  a.verdictText = a.verdictText || "";
  return a;
}

export function scoreOf(a: Analysis): number {
  const map: Record<Level, number> = { ok: 1, mid: 0.5, low: 0 };
  if (!a.checklist.length) return 0;
  const s = a.checklist.reduce((t, r) => t + (map[r.level] || 0), 0);
  return Math.round((s / a.checklist.length) * 100);
}

export function slug(s: string): string {
  return (
    (s || "phieu-mo-xe")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "phieu-mo-xe"
  );
}

const THUMBS = [
  "linear-gradient(150deg,#3a2a16,#7a4a10)",
  "linear-gradient(150deg,#2a5a44,#3c7a5e)",
  "linear-gradient(150deg,#5a3a16,#b06a16)",
];

export function makeEntry(a: Analysis, f: Partial<FormState>, date: string): HistoryEntry {
  return {
    id: "e" + Math.random().toString(36).slice(2, 8),
    title: f.title || "Phiếu mổ xẻ video",
    platform: f.platform || "TikTok / Douyin",
    product: f.product || "",
    date: date || "Hôm nay",
    score: scoreOf(a),
    analysis: a,
    thumb: THUMBS[Math.floor(Math.random() * THUMBS.length)],
  };
}

export function presetPerms(role: string): Perms {
  const P: Record<string, Perms> = {
    "Quản trị": { analyze: true, export: true, history: true, manage: true },
    "Biên tập": { analyze: true, export: true, history: true, manage: false },
    "Cộng tác": { analyze: true, export: true, history: false, manage: false },
    Khách: { analyze: false, export: false, history: false, manage: false },
  };
  return { ...(P[role] || P["Khách"]) };
}

export function seedUsers(): AdminUser[] {
  const av = [
    "linear-gradient(150deg,#3c7a5e,#2a5a44)",
    "linear-gradient(150deg,#b06a16,#7a4a10)",
    "linear-gradient(150deg,#9e3a3a,#6a2424)",
    "linear-gradient(150deg,#3a2a16,#5a4326)",
    "linear-gradient(150deg,#2f6b8a,#1e4a60)",
  ];
  return [
    { name: "Brand Manager", email: "ban@nonelab.asia", role: "Quản trị", count: 42, active: true },
    { name: "Linh Trần", email: "linh@nonelab.asia", role: "Biên tập", count: 28, active: true },
    { name: "Minh Phạm", email: "minh@nonelab.asia", role: "Biên tập", count: 17, active: true },
    { name: "Hà Nguyễn", email: "ha@nonelab.asia", role: "Khách", count: 5, active: false },
    { name: "Tuấn Đỗ", email: "tuan@agency.vn", role: "Cộng tác", count: 9, active: true },
  ].map((u, i) => ({ ...u, avBg: av[i % av.length], perms: presetPerms(u.role) }));
}
