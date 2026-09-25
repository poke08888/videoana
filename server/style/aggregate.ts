/**
 * server/style/aggregate.ts — tổng hợp N phiếu style thành Style Profile (spec §6). Thuần code, chạy lại được.
 * Enum: tần suất có trọng số → hard ≥70 % · soft 40–69 % · never = 0 % ở trường phủ định.
 * Số: trung vị + P25–P75. Outlier: lệch ≥ STYLE.outlierLayers lớp so với mode → loại khỏi thống kê.
 */
import { STYLE } from "./config.js";
import type { StyleAnalysis, StyleMeasure, StyleTimelineShot, StyleProfile, Stat, LayerField } from "./types.js";

export interface AggInput { videoId: string; link: string; views: number; createTime: number; measure: StyleMeasure | null; analysis: StyleAnalysis; timeline: StyleTimelineShot[] | null; isExemplar: boolean }
type Layer = keyof StyleProfile["layers"];
const LAYERS: Layer[] = ["structure", "visual", "text", "audio", "content", "brand"];

const r2 = (n: number) => Math.round(n * 100) / 100;
const qtl = (s: number[], p: number) => { if (!s.length) return 0; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export function stat(xs: number[]): Stat { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return { median: r2(qtl(s, 0.5)), p25: r2(qtl(s, 0.25)), p75: r2(qtl(s, 0.75)), n: s.length }; }

/** Trường liệt kê theo lớp: tên → hàm lấy giá trị (string | string[] | boolean). */
const FIELDS: Record<Layer, Record<string, (a: StyleAnalysis) => string | string[] | boolean>> = {
  structure: { hookType: (a) => a.structure.hookType, layout: (a) => a.structure.layout, hasLoop: (a) => a.structure.hasLoop, transitions: (a) => [...new Set(a.structure.transitions.map((t) => t.type))], cutSync: (a) => a.structure.cutSync },
  visual: { shooting: (a) => a.visual.shooting, angles: (a) => a.visual.angles, shotSizes: (a) => a.visual.shotSizes, punchIn: (a) => a.visual.punchIn, frame: (a) => a.visual.frame, "grade.tone": (a) => a.visual.grade.tone, "grade.saturation": (a) => a.visual.grade.saturation, "grade.contrast": (a) => a.visual.grade.contrast, quality: (a) => a.visual.quality },
  text: { captionStyle: (a) => a.text.captionStyle, "font.weight": (a) => a.text.font.weight, "font.sizeRel": (a) => a.text.font.sizeRel, stroke: (a) => a.text.stroke, shadow: (a) => a.text.shadow, box: (a) => a.text.box, position: (a) => a.text.position, highlight: (a) => a.text.highlight, stickers: (a) => a.text.stickers, animIn: (a) => a.text.animIn, animOut: (a) => a.text.animOut, "font.family": (a) => a.text.font.family || "?", color: (a) => a.text.color || "?" },
  audio: { "music.source": (a) => a.audio.music.source, "music.levelVsVoice": (a) => a.audio.music.levelVsVoice, "music.genre": (a) => a.audio.music.genre || "?", "voice.mode": (a) => a.audio.voice.mode, "voice.gender": (a) => a.audio.voice.gender, "voice.pace": (a) => a.audio.voice.pace, sfxDensity: (a) => a.audio.sfxDensity, sfxTypes: (a) => [...new Set(a.audio.sfx.map((s) => s.type))], beatSync: (a) => a.audio.beatSync },
  content: { genre: (a) => a.content.genre, persona: (a) => a.content.persona, productPresentation: (a) => a.content.productPresentation },
  brand: { "watermark.has": (a) => a.brand.watermark.has, "watermark.position": (a) => a.brand.watermark.position, intro: (a) => a.brand.intro, outro: (a) => a.brand.outro, recurringOpeningFrame: (a) => a.brand.recurringOpeningFrame },
};
/** Câu tiếng Việt cho từng trường (dùng khi viết rules). */
const LABEL: Record<string, string> = {
  "structure.hookType": "Kiểu hook 3 s đầu", "structure.layout": "Bố cục", "structure.hasLoop": "Loop cuối", "structure.transitions": "Kiểu chuyển cảnh", "structure.cutSync": "Cắt theo",
  "visual.shooting": "Cách quay", "visual.angles": "Tầm máy", "visual.shotSizes": "Cỡ cảnh", "visual.punchIn": "Punch-in khi nhấn ý", "visual.frame": "Khung/split/PIP", "visual.grade.tone": "Tone màu", "visual.grade.saturation": "Bão hoà", "visual.grade.contrast": "Contrast", "visual.quality": "Chất hình",
  "text.captionStyle": "Kiểu caption", "text.font.weight": "Độ đậm chữ", "text.font.sizeRel": "Cỡ chữ", "text.stroke": "Viền chữ", "text.shadow": "Bóng chữ", "text.box": "Nền hộp chữ", "text.position": "Vị trí chữ", "text.highlight": "Nhấn từ khoá", "text.stickers": "Sticker/đồ hoạ", "text.animIn": "Chữ vào", "text.animOut": "Chữ ra", "text.font.family": "Font (phỏng đoán)", "text.color": "Màu chữ",
  "audio.music.source": "Nguồn nhạc", "audio.music.levelVsVoice": "Nhạc so với giọng", "audio.music.genre": "Thể loại nhạc", "audio.voice.mode": "Kiểu giọng", "audio.voice.gender": "Giới tính giọng", "audio.voice.pace": "Tốc độ nói", "audio.sfxDensity": "Mật độ SFX", "audio.sfxTypes": "Loại SFX", "audio.beatSync": "Beat sync",
  "content.genre": "Thể loại", "content.persona": "Persona", "content.productPresentation": "Cách trình bày sản phẩm",
  "brand.watermark.has": "Có watermark", "brand.watermark.position": "Vị trí watermark", "brand.intro": "Có intro", "brand.outro": "Có outro", "brand.recurringOpeningFrame": "Khung mở đầu lặp lại",
};
const norm = (v: string | string[] | boolean): string[] => (Array.isArray(v) ? (v.length ? v.map(String) : ["(không)"]) : [String(v)]);
const weightOf = (createTime: number, nowSec: number) => (nowSec - createTime <= STYLE.recentDays * 86400 ? 1 : STYLE.oldWeight);

function shares(inputs: AggInput[], nowSec: number, get: (a: StyleAnalysis) => string | string[] | boolean): Map<string, number> {
  const m = new Map<string, number>(); let total = 0;
  for (const v of inputs) { const w = weightOf(v.createTime, nowSec); total += w; for (const x of norm(get(v.analysis))) m.set(x, (m.get(x) || 0) + w); }
  for (const [k, n] of m) m.set(k, total ? n / total : 0);
  return m;
}
const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] || ["?", 0];

/** Số lớp video này lệch so với mode của tập (dùng captionStyle, persona, hookType, genre, voice.mode + cutsPerMin ngoài P10–P90). */
function deviations(v: AggInput, modes: Record<string, string>, cpmRange: [number, number]): string[] {
  const r: string[] = []; const a = v.analysis;
  const chk = (k: string, val: string, label: string) => { if (modes[k] && modes[k] !== val) r.push(`${label}: ${val} (kênh: ${modes[k]})`); };
  chk("text.captionStyle", a.text.captionStyle, "caption"); chk("content.persona", a.content.persona, "persona"); chk("structure.hookType", a.structure.hookType, "hook"); chk("content.genre", a.content.genre, "thể loại"); chk("audio.voice.mode", a.audio.voice.mode, "giọng");
  const cpm = v.measure?.cutsPerMin; if (cpm !== null && cpm !== undefined && (cpm < cpmRange[0] || cpm > cpmRange[1])) r.push(`nhịp cắt ${cpm}/phút ngoài P10–P90 [${cpmRange[0]}–${cpmRange[1]}]`);
  return r;
}

export function aggregateProfile(all: AggInput[], nowSec: number, channel: StyleProfile["channel"], model: string) {
  // 1. Mode sơ bộ trên toàn tập để phát hiện outlier
  const modeKeys = ["text.captionStyle", "content.persona", "structure.hookType", "content.genre", "audio.voice.mode"];
  const modes: Record<string, string> = {};
  for (const k of modeKeys) { const [layer, ...rest] = k.split("."); modes[k] = top(shares(all, nowSec, FIELDS[layer as Layer][rest.join(".")]))[0]; }
  const cpms = all.map((v) => v.measure?.cutsPerMin).filter((x): x is number => x !== null && x !== undefined).sort((a, b) => a - b);
  const cpmRange: [number, number] = [qtl(cpms, 0.1), qtl(cpms, 0.9)];
  const outliers: { videoId: string; reasons: string[] }[] = [];
  const used = all.filter((v) => { const d = deviations(v, modes, cpmRange); if (d.length >= STYLE.outlierLayers) { outliers.push({ videoId: v.videoId, reasons: d }); return false; } return true; });
  const base = used.length ? used : all;

  // 2. Số đo
  const num = (f: (v: AggInput) => number | null | undefined) => stat(base.map(f).filter((x): x is number => x !== null && x !== undefined));
  const metrics = { duration: num((v) => v.measure?.duration), cutsPerMin: num((v) => v.measure?.cutsPerMin), shotLen: num((v) => v.measure?.medianShotLen), loudness: num((v) => v.measure?.loudness.integratedLufs), talkingHeadRatio: num((v) => v.analysis.visual.talkingHeadRatio), brollRatio: num((v) => v.analysis.visual.brollRatio) };

  // 3. Enum theo lớp → hard/soft/never
  const layers = {} as StyleProfile["layers"]; const hard: string[] = [], soft: string[] = [], never: string[] = []; const evidence: Record<string, string[]> = {};
  const fmtShare = (s: number) => `${Math.round(s * 100)} %`;
  for (const layer of LAYERS) {
    layers[layer] = {};
    for (const [field, get] of Object.entries(FIELDS[layer])) {
      const key = `${layer}.${field}`; const sh = shares(base, nowSec, get); const [value, share] = top(sh);
      const rule: LayerField["rule"] = share >= STYLE.hardShare ? "hard" : share >= STYLE.softShare ? "soft" : "none";
      layers[layer][field] = { value, share: r2(share), rule };
      const label = LABEL[key] || key;
      if (rule === "hard" && value !== "?" && value !== "(không)") { hard.push(`${label}: ${value} (${fmtShare(share)} video).`); evidence[key] = base.filter((v) => norm(get(v.analysis)).includes(value)).slice(0, 3).map((v) => v.measure?.frames?.[1] || v.measure?.frames?.[0] || "").filter(Boolean); }
      else if (rule === "soft" && value !== "?" && value !== "(không)") soft.push(`${label}: thường ${value} (${fmtShare(share)} video).`);
      const neverVals = STYLE.neverFields[key]; if (neverVals) for (const nv of neverVals) if (!sh.has(nv)) never.push(`${label} = ${nv}: KHÔNG BAO GIỜ (0/${base.length} video).`);
    }
  }
  // 4. Câu số đo (đứng đầu quy tắc cứng)
  const m = metrics; const rng = (s: Stat, unit: string) => `${s.p25}–${s.p75} ${unit} (trung vị ${s.median})`;
  if (m.duration.n) hard.unshift(`Độ dài video: ${rng(m.duration, "s")}.`);
  if (m.cutsPerMin.n) hard.unshift(`Nhịp cắt: ${rng(m.cutsPerMin, "cut/phút")}; mỗi shot ${rng(m.shotLen, "s")}.`);
  if (m.loudness.n) soft.push(`Âm lượng tích hợp: ${rng(m.loudness, "LUFS")}.`);
  if (m.talkingHeadRatio.n) soft.push(`Tỉ lệ talking-head ${Math.round(m.talkingHeadRatio.median * 100)} % · b-roll ${Math.round(m.brollRatio.median * 100)} %.`);

  // 5. Câu thô cho công thức (pipeline sẽ gom bằng engine.cluster)
  const texts = (f: (a: StyleAnalysis) => string) => base.map((v) => f(v.analysis).trim()).filter(Boolean);
  const formulas = { opening: texts((a) => a.content.openingFormula || a.structure.hookText), closing: texts((a) => a.content.closingFormula), cta: texts((a) => a.content.cta) };

  const exemplars = all.filter((v) => v.isExemplar).map((v) => ({ videoId: v.videoId, link: v.link, views: v.views, duration: v.measure?.duration ?? null, timeline: v.timeline || [] }));
  return { channel, analyzedAt: new Date(nowSec * 1000).toISOString(), model, videos: { total: all.length, used: base.length, failed: 0, outliers }, metrics, layers, rules: { hard, soft, never }, formulas, exemplars, evidence };
}
