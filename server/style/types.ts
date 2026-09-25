/**
 * server/style/types.ts — enum + type của module Style kênh. Enum cố định để bước tổng hợp đếm được.
 * Trường text tự do đánh dấu (*) trong spec §5 là string thường.
 */
export const HOOK_TYPES = ["text-big", "question", "curiosity-scene", "result-first", "talk-direct", "other"] as const;
export const LAYOUTS = ["hook-problem-content-cta", "vlog", "list", "story", "other"] as const;
export const TRANSITIONS = ["hard", "zoom", "whip", "jump", "match", "fade", "other"] as const;
export const CUT_SYNCS = ["beat", "speech", "none"] as const;
export const SHOOTINGS = ["static", "handheld", "mixed"] as const;
export const ANGLES = ["eye", "low", "high"] as const;
export const SHOT_SIZES = ["ECU", "CU", "MCU", "MS", "FS", "WS"] as const;
export const FRAMES = ["none", "border", "split", "pip"] as const;
export const TONES = ["warm", "cool", "neutral"] as const;
export const LEVELS = ["low", "mid", "high"] as const;
export const QUALITIES = ["clean", "raw", "grainy"] as const;
export const CAPTION_STYLES = ["word-pop", "sentence", "none"] as const;
export const WEIGHTS = ["regular", "bold", "black"] as const;
export const SIZE_RELS = ["small", "med", "large"] as const;
export const POSITIONS = ["top-third", "center", "lower-third", "bottom", "varies"] as const;
export const HIGHLIGHTS = ["color", "emoji", "icon", "none"] as const;
export const STICKERS = ["arrow", "circle", "meme", "lower-third", "emoji", "other"] as const;
export const ANIMS = ["pop", "bounce", "typewriter", "fade", "none"] as const;
export const MUSIC_SOURCES = ["trending", "original", "none"] as const;
export const LEVEL_VS = ["under", "equal", "over"] as const;
export const VOICE_MODES = ["direct", "voiceover", "tts", "none"] as const;
export const GENDERS = ["male", "female", "mixed"] as const;
export const PACES = ["slow", "normal", "fast"] as const;
export const SFX_TYPES = ["whoosh", "ding", "pop", "boom", "other"] as const;
export const DENSITIES = ["none", "sparse", "dense"] as const;
export const GENRES = ["review", "compare", "story", "pov", "tutorial", "unbox", "comedy", "other"] as const;
export const PERSONAS = ["friendly", "expert", "sassy", "serious", "other"] as const;
export const PRESENTATIONS = ["handheld", "macro", "before-after", "demo", "none"] as const;
export const WATERMARK_POS = ["top-left", "top-right", "bottom-left", "bottom-right", "center", "none"] as const;

type E<T extends readonly string[]> = T[number];

export interface StyleMeasure {
  duration: number | null; width: number | null; height: number | null; aspect: string | null; fps: number | null;
  cuts: number[]; cutsPerMin: number | null; medianShotLen: number | null; shotLenP10: number | null; shotLenP90: number | null; cutsIn3s: number | null;
  loudness: { integratedLufs: number | null; first3sLufs: number | null };
  silenceStart: number | null;
  color: { y: number; u: number; v: number; saturation: number; contrast: number; tone: E<typeof TONES>; saturationLevel: E<typeof LEVELS>; contrastLevel: E<typeof LEVELS> } | null;
  loopLikely: boolean | null;
  frames: string[]; // data-URL JPEG
}

export interface StyleAnalysis {
  structure: { hookType: E<typeof HOOK_TYPES>; hookText: string; hookVisual: string; layout: E<typeof LAYOUTS>; hasLoop: boolean;
    transitions: { at: number; type: E<typeof TRANSITIONS> }[]; cutSync: E<typeof CUT_SYNCS> };
  visual: { shooting: E<typeof SHOOTINGS>; angles: E<typeof ANGLES>[]; shotSizes: E<typeof SHOT_SIZES>[]; talkingHeadRatio: number; brollRatio: number;
    punchIn: boolean; frame: E<typeof FRAMES>; grade: { tone: E<typeof TONES>; saturation: E<typeof LEVELS>; contrast: E<typeof LEVELS>; preset: string }; quality: E<typeof QUALITIES> };
  text: { captionStyle: E<typeof CAPTION_STYLES>; font: { family: string; weight: E<typeof WEIGHTS>; sizeRel: E<typeof SIZE_RELS> }; color: string;
    stroke: boolean; shadow: boolean; box: boolean; position: E<typeof POSITIONS>; highlight: E<typeof HIGHLIGHTS>; stickers: E<typeof STICKERS>[];
    animIn: E<typeof ANIMS>; animOut: E<typeof ANIMS> };
  audio: { music: { genre: string; source: E<typeof MUSIC_SOURCES>; levelVsVoice: E<typeof LEVEL_VS> };
    voice: { mode: E<typeof VOICE_MODES>; gender: E<typeof GENDERS>; pace: E<typeof PACES> };
    sfx: { at: number; type: E<typeof SFX_TYPES> }[]; sfxDensity: E<typeof DENSITIES>; beatSync: boolean };
  content: { genre: E<typeof GENRES>; persona: E<typeof PERSONAS>; openingFormula: string; closingFormula: string; cta: string; productPresentation: E<typeof PRESENTATIONS>[] };
  brand: { watermark: { has: boolean; position: E<typeof WATERMARK_POS> }; intro: boolean; outro: boolean; mainColors: string[]; recurringOpeningFrame: boolean };
  notes: { oddities: string[] };
  estimated: boolean;
  warnings: string[];
}

export interface StyleTimelineShot { from: number; to: number; shot: string; textOnScreen: string; textAnim: E<typeof ANIMS>; sfx: string; music: string; voice: string }

export interface PickedVideo { awemeId: string; link: string; title: string; cover: string; views: number; likes: number; createTime: number; isExemplar: boolean }

export interface Stat { median: number; p25: number; p75: number; n: number }
export interface LayerField { value: string; share: number; rule: "hard" | "soft" | "none" }
export interface StyleProfile {
  channel: { platform: string; handle: string; nickname: string; avatar: string };
  analyzedAt: string; model: string;
  videos: { total: number; used: number; failed: number; outliers: { videoId: string; reasons: string[] }[] };
  metrics: { duration: Stat; cutsPerMin: Stat; shotLen: Stat; loudness: Stat; talkingHeadRatio: Stat; brollRatio: Stat };
  layers: Record<"structure" | "visual" | "text" | "audio" | "content" | "brand", Record<string, LayerField>>;
  rules: { hard: string[]; soft: string[]; never: string[] };
  formulas: { opening: Formula[]; closing: Formula[]; cta: Formula[] };
  exemplars: { videoId: string; link: string; views: number; duration: number | null; timeline: StyleTimelineShot[] }[];
  evidence: Record<string, string[]>;
}
export interface Formula { text: string; count: number; examples: string[] }

export interface ProfileRow { id: string; owner: string; platform: string; handle: string; nickname: string; avatar: string; status: "running" | "aggregating" | "done" | "failed";
  picked_ids: string; exemplar_ids: string; profile: string | null; skill_md: string | null; message: string | null; created_at: string; updated_at: string }
export interface VideoRow { id: string; profile_id: string; aweme_id: string; link: string; title: string; cover: string; views: number; likes: number; create_time: number; is_exemplar: number;
  status: "pending" | "processing" | "done" | "failed"; measure: string | null; analysis: string | null; timeline: string | null; frames: string | null; warnings: string | null; error: string | null; updated_at: string }
