/** server/style/validate.ts — ép phiếu Gemini về đúng enum (spec §5). Không throw; ghi warnings. */
import * as T from "./types.js";
import type { StyleAnalysis, StyleTimelineShot } from "./types.js";

type RO = readonly string[];
export function emptyStyle(): StyleAnalysis {
  return {
    structure: { hookType: "other", hookText: "", hookVisual: "", layout: "other", hasLoop: false, transitions: [], cutSync: "none" },
    visual: { shooting: "mixed", angles: [], shotSizes: [], talkingHeadRatio: 0, brollRatio: 0, punchIn: false, frame: "none", grade: { tone: "neutral", saturation: "mid", contrast: "mid", preset: "" }, quality: "clean" },
    text: { captionStyle: "none", font: { family: "", weight: "bold", sizeRel: "med" }, color: "", stroke: false, shadow: false, box: false, position: "varies", highlight: "none", stickers: [], animIn: "none", animOut: "none" },
    audio: { music: { genre: "", source: "none", levelVsVoice: "under" }, voice: { mode: "none", gender: "mixed", pace: "normal" }, sfx: [], sfxDensity: "none", beatSync: false },
    content: { genre: "other", persona: "other", openingFormula: "", closingFormula: "", cta: "", productPresentation: [] },
    brand: { watermark: { has: false, position: "none" }, intro: false, outro: false, mainColors: [], recurringOpeningFrame: false },
    notes: { oddities: [] }, estimated: false, warnings: [],
  };
}
export function validateStyle(raw: any): StyleAnalysis {
  const out = emptyStyle(); const w = out.warnings; const r = raw || {};
  const en = <L extends RO>(list: L, v: any, d: L[number], name: string): L[number] => { if (v === undefined || v === null || v === "") return d; const s = String(v); if ((list as RO).includes(s)) return s as L[number]; w.push(`${name}: "${s}" không hợp lệ → ${d}`); return d; };
  const ens = <L extends RO>(list: L, v: any, name: string): L[number][] => { const arr = Array.isArray(v) ? v.map(String) : []; const ok = arr.filter((x) => (list as RO).includes(x)); if (ok.length !== arr.length) w.push(`${name}: bỏ ${arr.length - ok.length} giá trị lạ`); return [...new Set(ok)] as L[number][]; };
  const bool = (v: any) => v === true || v === "true" || v === 1;
  const str = (v: any, max = 300) => String(v ?? "").trim().slice(0, max);
  const strs = (v: any) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, 12) : []);
  const ratio = (v: any) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
  const timed = <L extends RO>(list: L, v: any, name: string) => (Array.isArray(v) ? v : []).filter((x) => Number.isFinite(Number(x?.at))).map((x) => ({ at: Math.round(Number(x.at) * 100) / 100, type: en(list, x?.type, "other" as L[number], name) }));
  for (const layer of ["structure", "visual", "text", "audio", "content", "brand"] as const) if (!r[layer] || typeof r[layer] !== "object") w.push(`thiếu lớp ${layer}`);
  const s = r.structure || {}, v = r.visual || {}, t = r.text || {}, a = r.audio || {}, c = r.content || {}, b = r.brand || {};
  out.structure = { hookType: en(T.HOOK_TYPES, s.hookType, "other", "structure.hookType"), hookText: str(s.hookText), hookVisual: str(s.hookVisual), layout: en(T.LAYOUTS, s.layout, "other", "structure.layout"), hasLoop: bool(s.hasLoop), transitions: timed(T.TRANSITIONS, s.transitions, "structure.transitions"), cutSync: en(T.CUT_SYNCS, s.cutSync, "none", "structure.cutSync") };
  const g = v.grade || {};
  out.visual = { shooting: en(T.SHOOTINGS, v.shooting, "mixed", "visual.shooting"), angles: ens(T.ANGLES, v.angles, "visual.angles"), shotSizes: ens(T.SHOT_SIZES, v.shotSizes, "visual.shotSizes"), talkingHeadRatio: ratio(v.talkingHeadRatio), brollRatio: ratio(v.brollRatio), punchIn: bool(v.punchIn), frame: en(T.FRAMES, v.frame, "none", "visual.frame"),
    grade: { tone: en(T.TONES, g.tone, "neutral", "visual.grade.tone"), saturation: en(T.LEVELS, g.saturation, "mid", "visual.grade.saturation"), contrast: en(T.LEVELS, g.contrast, "mid", "visual.grade.contrast"), preset: str(g.preset, 60) }, quality: en(T.QUALITIES, v.quality, "clean", "visual.quality") };
  const f = t.font || {};
  out.text = { captionStyle: en(T.CAPTION_STYLES, t.captionStyle, "none", "text.captionStyle"), font: { family: str(f.family, 60), weight: en(T.WEIGHTS, f.weight, "bold", "text.font.weight"), sizeRel: en(T.SIZE_RELS, f.sizeRel, "med", "text.font.sizeRel") }, color: str(t.color, 60), stroke: bool(t.stroke), shadow: bool(t.shadow), box: bool(t.box),
    position: en(T.POSITIONS, t.position, "varies", "text.position"), highlight: en(T.HIGHLIGHTS, t.highlight, "none", "text.highlight"), stickers: ens(T.STICKERS, t.stickers, "text.stickers"), animIn: en(T.ANIMS, t.animIn, "none", "text.animIn"), animOut: en(T.ANIMS, t.animOut, "none", "text.animOut") };
  const mu = a.music || {}, vo = a.voice || {};
  out.audio = { music: { genre: str(mu.genre, 60), source: en(T.MUSIC_SOURCES, mu.source, "none", "audio.music.source"), levelVsVoice: en(T.LEVEL_VS, mu.levelVsVoice, "under", "audio.music.levelVsVoice") }, voice: { mode: en(T.VOICE_MODES, vo.mode, "none", "audio.voice.mode"), gender: en(T.GENDERS, vo.gender, "mixed", "audio.voice.gender"), pace: en(T.PACES, vo.pace, "normal", "audio.voice.pace") },
    sfx: timed(T.SFX_TYPES, a.sfx, "audio.sfx"), sfxDensity: en(T.DENSITIES, a.sfxDensity, "none", "audio.sfxDensity"), beatSync: bool(a.beatSync) };
  out.content = { genre: en(T.GENRES, c.genre, "other", "content.genre"), persona: en(T.PERSONAS, c.persona, "other", "content.persona"), openingFormula: str(c.openingFormula), closingFormula: str(c.closingFormula), cta: str(c.cta), productPresentation: ens(T.PRESENTATIONS, c.productPresentation, "content.productPresentation") };
  const wm = b.watermark || {};
  out.brand = { watermark: { has: bool(wm.has), position: en(T.WATERMARK_POS, wm.position, "none", "brand.watermark.position") }, intro: bool(b.intro), outro: bool(b.outro), mainColors: strs(b.mainColors), recurringOpeningFrame: bool(b.recurringOpeningFrame) };
  out.notes = { oddities: strs(r.notes?.oddities) };
  out.estimated = bool(r.estimated);
  return out;
}
/** Ghép timeline theo cuts đã đo: model chỉ điền nội dung, code quyết from/to (spec §5). */
export function validateTimeline(raw: any, cuts: number[], duration: number): StyleTimelineShot[] {
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < duration), duration];
  const items: any[] = Array.isArray(raw?.timeline) ? raw.timeline : Array.isArray(raw) ? raw : [];
  const str = (v: any) => String(v ?? "").trim().slice(0, 200);
  return bounds.slice(1).map((to, i) => { const it = items[i] || {}; return { from: bounds[i], to, shot: str(it.shot), textOnScreen: str(it.textOnScreen), textAnim: (T.ANIMS as readonly string[]).includes(String(it.textAnim)) ? it.textAnim : "none", sfx: str(it.sfx), music: str(it.music), voice: str(it.voice) }; });
}
