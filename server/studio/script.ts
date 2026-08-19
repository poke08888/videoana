/**
 * server/studio/script.ts — Phiếu kịch bản: 4 nguồn (AI/mổ xẻ/mẫu/nhập tay) đổ về CÙNG schema.
 * GĐ 1: nguồn AI (Gemini nhìn ảnh) + nhập tay. Ràng buộc: âm tiết thoại ≤ nhịp × clip_len (spec 3.3a).
 */
import fs from "node:fs";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { extractJSON } from "../gemini.js";
import { StudioError } from "./errors.js";
import { countSyllables } from "./text.js";
import type { FileRef } from "./engines/types.js";

export const PURPOSES = ["hook", "packaging", "product", "label", "interaction", "cta"] as const;
export const CAMERAS = ["wide", "medium", "close"] as const;
export const MOTIONS = ["low", "medium", "high"] as const;
/** Cảnh mà nhãn/bao bì phải đọc được → ép biên độ thấp (bench Bước 0). */
export const LOW_MOTION_PURPOSES = new Set<string>(["packaging", "label"]);
export interface ScriptShot { purpose: (typeof PURPOSES)[number]; camera: (typeof CAMERAS)[number]; dialog: string; image_prompt: string; motion_prompt: string; motion_level: (typeof MOTIONS)[number] }
export interface Script { shots: ScriptShot[]; caption: string; hashtags: string[]; cover_idx: number }

const pick = <T extends readonly string[]>(list: T, v: any, d: T[number]): T[number] => (list as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : d;

export function validateScript(raw: any, o: { maxSyllables: number }): { ok: true; script: Script } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const shotsIn: any[] = Array.isArray(raw?.shots) ? raw.shots : [];
  if (shotsIn.length < 1 || shotsIn.length > 8) errors.push(`Cần 1–8 cảnh, nhận ${shotsIn.length}.`);
  const shots: ScriptShot[] = shotsIn.slice(0, 8).map((s, i) => {
    const dialog = String(s?.dialog || "").trim();
    const n = countSyllables(dialog);
    if (n > o.maxSyllables) errors.push(`Cảnh ${i + 1}: thoại ${n} âm tiết, vượt ngưỡng ${o.maxSyllables}.`);
    return {
      purpose: pick(PURPOSES, s?.purpose, "product"),
      camera: pick(CAMERAS, s?.camera, "medium"),
      dialog,
      image_prompt: String(s?.image_prompt || "").trim(),
      motion_prompt: String(s?.motion_prompt || "").trim(),
      // Cảnh khoe bao bì/nhãn LUÔN bị ép về biên độ thấp, không cho AI lẫn người chọn khác.
      // Bench Bước 0: chữ trên nhãn hỏng khi sản phẩm tiến sát camera và xoay; biên độ thấp
      // là chốt chặn hiệu quả hơn cả việc đổi sang model đắt gấp 3.
      motion_level: LOW_MOTION_PURPOSES.has(pick(PURPOSES, s?.purpose, "product"))
        ? "low"
        : pick(MOTIONS, s?.motion_level, "medium"),
    };
  });
  if (errors.length) return { ok: false, errors };
  const hashtags = (Array.isArray(raw?.hashtags) ? raw.hashtags : []).map((h: any) => String(h).trim()).filter(Boolean).slice(0, 8);
  const cover = Number(raw?.cover_idx);
  return { ok: true, script: { shots, caption: String(raw?.caption || "").trim(), hashtags, cover_idx: Number.isInteger(cover) && cover >= 0 && cover < shots.length ? cover : 0 } };
}

export function buildScriptPrompt(a: { productName: string; industry: string; shots: number; clipLen: number; maxSyllables: number; hasBackground: boolean; notes?: string; autopsy?: string }): string {
  return `Bạn là biên kịch video review TikTok Shop của Nonelab. Nhìn các ảnh đính kèm: ảnh sản phẩm${a.hasBackground ? " và ảnh bối cảnh cuối cùng" : ""}.
Sản phẩm: "${a.productName}". Ngành hàng: ${a.industry}.${a.notes ? `\nGhi chú của người dùng: ${a.notes}` : ""}${a.autopsy ? `\nKhung từ Phiếu mổ xẻ video bùng nổ (bám theo nhịp và công thức này):\n${a.autopsy}` : ""}

Viết kịch bản đúng ${a.shots} cảnh, mỗi cảnh là một clip ${a.clipLen} giây, quay dọc 9:16, CHỈ CÓ BÀN TAY tương tác với sản phẩm, KHÔNG có mặt người, không chữ chèn.
Quy tắc:
- Cảnh 1 luôn là hook (purpose "hook"). Có ít nhất một cảnh "interaction" (tay bóc/cầm/chấm/rót). Cảnh cuối là "cta".
- Mỗi "dialog" (lời đọc tiếng Việt, tự nhiên như người thật nói) TỐI ĐA ${a.maxSyllables} âm tiết. Không vượt.
- "image_prompt": tiếng Anh, mô tả một khung hình tĩnh photorealistic: sản phẩm ĐÚNG như ảnh tham chiếu (giữ nguyên bao bì, chữ, màu), đặt trong bối cảnh tham chiếu, ánh sáng, góc máy (${CAMERAS.join("/")}), bàn tay nếu có.
  TUYỆT ĐỐI KHÔNG trích, chép hay viết lại bất kỳ chữ nào in trên nhãn vào image_prompt. Chỉ viết "reproduce the label exactly as in the reference image". Prompt mà khẳng định nội dung nhãn sẽ ĐÈ LÊN ảnh tham chiếu và model in sai chữ lên sản phẩm.
- "motion_prompt": tiếng Anh, mô tả chuyển động trong ${a.clipLen}s bắt đầu từ đúng khung hình đó (camera + hành động tay).
- "motion_level": "low" cho cảnh nhìn rõ nhãn/chữ trên bao bì (packaging/label), "medium" mặc định, "high" chỉ khi hành động mạnh.
- "camera": một trong ${CAMERAS.join(", ")}. "purpose": một trong ${PURPOSES.join(", ")}.
- "caption": caption đăng TikTok Shop tiếng Việt ≤ 150 ký tự. "hashtags": 5–8 hashtag. "cover_idx": chỉ số cảnh (từ 0) làm ảnh bìa.

Trả về DUY NHẤT một JSON:
{"shots":[{"purpose":"hook","camera":"close","dialog":"...","image_prompt":"...","motion_prompt":"...","motion_level":"medium"}],"caption":"...","hashtags":["#..."],"cover_idx":0}`;
}

export async function generateScriptAI(a: { apiKey: string; model: string; refs: FileRef[]; productName: string; industry: string; shots: number; clipLen: number; maxSyllables: number; hasBackground: boolean; notes?: string; autopsy?: string }): Promise<Script> {
  const ai = new GoogleGenAI({ apiKey: a.apiKey });
  const parts: any[] = a.refs.map((r) => ({ inlineData: { data: fs.readFileSync(r.path).toString("base64"), mimeType: r.mimeType } }));
  parts.push(buildScriptPrompt(a));
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await ai.models.generateContent({ model: a.model, contents: createUserContent(parts), config: { responseMimeType: "application/json", temperature: 0.8 } });
    const json = extractJSON((resp.text ?? "").trim());
    const v = validateScript(json, { maxSyllables: a.maxSyllables });
    if (v.ok) return v.script;
    lastErrors = v.errors;
    parts[parts.length - 1] = buildScriptPrompt(a) + `\n\nLần trước bị lỗi, hãy sửa: ${v.errors.join(" ")}`;
  }
  throw new StudioError("other", `Kịch bản AI không đạt sau 2 lần: ${lastErrors.join(" ")}`);
}
