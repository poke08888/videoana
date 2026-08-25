/**
 * server/studio/routes.ts — API Xưởng. Mỏng: kiểm tra đầu vào, quyền sở hữu, gọi pipeline/store.
 * Không gọi model, không chạy ffmpeg ở đây (trừ sinh kịch bản AI — một lượt Gemini nhanh, chấp nhận).
 */
import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { requireEditor, verifyToken } from "../auth.js";
import { STUDIO, ensureProjectDirs, projectDir, incomingDir, musicDir } from "./config.js";
import { createProject, getProject, listProjects, updateProject, deleteProject, addAsset, listAssets, replaceShots, listShots, getShot, updateShot, getRender, todaySpendUsd, totalDiskBytes, type Project } from "./store.js";
import { requestKeyframes, requestClips, requestAssemble, setApproved, syllablesPerSecFor, makeEngines } from "./pipeline.js";
import { generateScriptAI, validateScript } from "./script.js";
import { estimateProject } from "./pricing.js";
import { maxSyllablesFor, countSyllables } from "./text.js";
import { queueStatus } from "./queue.js";

export const studioRouter = Router();
const upload = multer({ dest: incomingDir(), limits: { fileSize: 20 * 1024 * 1024, files: 11 } });

const ownerEmail = (req: any) => String(req?.user?.email || "").toLowerCase().trim();
const isAdmin = (req: any) => req?.user?.role === "Quản trị";
function resolveKey(reqKey?: string): string | null {
  const k = (reqKey || "").trim(); if (k.length >= 10) return k;
  const env = (process.env.GEMINI_API_KEY || "").trim(); return env.length >= 10 ? env : null;
}
async function owned(req: Request, res: Response, id: string): Promise<Project | null> {
  const p = await getProject(id);
  if (!p || (!isAdmin(req) && p.owner !== ownerEmail(req))) { res.status(404).json({ ok: false, message: "Không tìm thấy dự án." }); return null; }
  return p;
}
const rel = (p: Project, abs: string | null) => (abs ? path.relative(projectDir(p.id), abs).split(path.sep).join("/") : null);
async function projectPayload(p: Project) {
  const shots = (await listShots(p.id)).map((s) => ({ ...s, image_rel: rel(p, s.image_path), clip_rel: rel(p, s.clip_path), syllables: countSyllables(s.dialog) }));
  const assets = (await listAssets(p.id)).map((a) => ({ ...a, rel: rel(p, a.path) }));
  const r = await getRender(p.id);
  const render = r ? { ...r, mp4_rel: rel(p, r.mp4_path), cover_rel: rel(p, r.cover_path), srt_rel: rel(p, r.srt_path) } : null;
  return { project: p, shots, assets, render, maxSyllables: maxSyllablesFor(syllablesPerSecFor(p), p.clip_len) };
}
const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

studioRouter.get("/health", requireEditor, async (_req, res) => {
  const engines = makeEngines(resolveKey() || "");
  res.json({ ok: true, engines: STUDIO.engines, voices: engines.voice.voices(), voiceDefault: STUDIO.voiceDefault, queue: queueStatus(), spendTodayUsd: await todaySpendUsd(), budgetUsd: STUDIO.dailyBudgetUsd, diskBytes: await totalDiskBytes(), maxDiskGb: STUDIO.maxDiskGb, models: { image: STUDIO.imageModel, draft: STUDIO.videoModelDraft, final: STUDIO.videoModelFinal } });
});
studioRouter.get("/music", requireEditor, (_req, res) => {
  const files = fs.readdirSync(musicDir()).filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f)).sort();
  res.json({ ok: true, files });
});

studioRouter.get("/projects", requireEditor, async (req, res) => {
  res.json({ ok: true, projects: await listProjects(isAdmin(req) ? null : ownerEmail(req)) });
});

studioRouter.post("/projects", requireEditor, upload.fields([{ name: "products", maxCount: 10 }, { name: "background", maxCount: 1 }]), async (req, res) => {
  try {
    const b = req.body || {};
    const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
    const products = files.products || [];
    if (!products.length) return res.status(400).json({ ok: false, message: "Cần ít nhất 1 ảnh sản phẩm." });
    const ratio = ["9:16", "16:9", "1:1"].includes(b.ratio) ? b.ratio : "9:16";
    const clipLen = [4, 6, 8].includes(Number(b.clipLen)) ? Number(b.clipLen) : 8;
    const p = await createProject({ owner: ownerEmail(req), name: String(b.name || "Dự án mới").slice(0, 120), industry: String(b.industry || "other"), ratio, clipLen, tier: b.tier === "final" ? "final" : "draft", scriptSource: String(b.scriptSource || "ai") });
    const root = ensureProjectDirs(p.id);
    const move = async (f: Express.Multer.File, kind: "product" | "background", i: number) => {
      const ext = (path.extname(f.originalname) || ".jpg").toLowerCase();
      const dest = path.join(root, "assets", `${kind}_${i}${ext}`);
      fs.renameSync(f.path, dest);
      await addAsset(p.id, kind, dest, f.mimetype || "image/jpeg");
    };
    for (let i = 0; i < products.length; i++) await move(products[i], "product", i);
    if (files.background?.[0]) await move(files.background[0], "background", 0);
    res.json({ ok: true, project: await getProject(p.id) });
  } catch (e: any) { console.error("[xuong] tạo dự án:", e); res.status(500).json({ ok: false, message: "Lỗi tạo dự án." }); }
});

studioRouter.get("/projects/:id", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  res.json({ ok: true, ...(await projectPayload(p)) });
});
studioRouter.delete("/projects/:id", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  await deleteProject(p.id);
  fs.rmSync(projectDir(p.id), { recursive: true, force: true });
  res.json({ ok: true });
});
studioRouter.patch("/projects/:id", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const b = req.body || {};
  await updateProject(p.id, { name: b.name, caption: b.caption, hashtags: Array.isArray(b.hashtags) ? b.hashtags.join(" ") : b.hashtags, cover_idx: b.cover_idx, voice: b.voice, voice_rate: b.voice_rate, music: b.music, transition: b.transition });
  res.json({ ok: true });
});

studioRouter.post("/projects/:id/script", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const b = req.body || {};
  const maxSyllables = maxSyllablesFor(syllablesPerSecFor(p), p.clip_len);
  try {
    if (b.source === "manual") {
      const v = validateScript({ shots: b.shots, caption: b.caption ?? p.caption, hashtags: b.hashtags ?? String(p.hashtags || "").split(/\s+/).filter(Boolean) }, { maxSyllables });
      if (!v.ok) return res.status(400).json({ ok: false, message: v.errors.join(" ") });
      const shots = await replaceShots(p.id, v.script.shots);
      await updateProject(p.id, { script_source: "manual", caption: v.script.caption, hashtags: v.script.hashtags.join(" "), cover_idx: v.script.cover_idx, stage: "script" });
      return res.json({ ok: true, shots, caption: v.script.caption, hashtags: v.script.hashtags });
    }
    const apiKey = resolveKey(b.apiKey);
    if (!apiKey) return res.status(400).json({ ok: false, message: "Chưa có API key Gemini." });
    const assets = await listAssets(p.id);
    const refs = [...assets.filter((a) => a.kind === "product"), ...assets.filter((a) => a.kind === "background")].map((a) => ({ path: a.path, mimeType: a.mime }));
    const script = await generateScriptAI({ apiKey, model: String(b.model || STUDIO.scriptModel), refs, productName: p.name, industry: p.industry, shots: b.count === undefined || b.count === null || b.count === "" || b.count === "auto" ? "auto" as const : Math.min(8, Math.max(1, num(b.count, 4))), clipLen: p.clip_len, maxSyllables, hasBackground: assets.some((a) => a.kind === "background"), notes: b.notes ? String(b.notes).slice(0, 2000) : undefined });
    const shots = await replaceShots(p.id, script.shots);
    await updateProject(p.id, { script_source: "ai", caption: script.caption, hashtags: script.hashtags.join(" "), cover_idx: script.cover_idx, stage: "script" });
    res.json({ ok: true, shots, caption: script.caption, hashtags: script.hashtags });
  } catch (e: any) { res.status(502).json({ ok: false, message: e?.message || "Lỗi sinh kịch bản." }); }
});

studioRouter.put("/projects/:id/shots", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const maxSyllables = maxSyllablesFor(syllablesPerSecFor(p), p.clip_len);
  const v = validateScript({ shots: req.body?.shots, caption: p.caption, hashtags: [] }, { maxSyllables });
  if (!v.ok) return res.status(400).json({ ok: false, message: v.errors.join(" ") });
  res.json({ ok: true, shots: await replaceShots(p.id, v.script.shots) });
});

studioRouter.post("/projects/:id/keyframes", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const ids = Array.isArray(req.body?.shotIds) ? req.body.shotIds.map(String) : undefined;
  res.json({ ok: true, count: await requestKeyframes(p.id, ids) });
});
studioRouter.post("/shots/:id/approve", requireEditor, async (req, res) => {
  const s = await getShot(req.params.id); if (!s) return res.status(404).json({ ok: false });
  const p = await owned(req, res, s.project_id); if (!p) return;
  await setApproved(s.id, req.body?.approved ? 1 : 0);
  res.json({ ok: true });
});
studioRouter.post("/shots/:id/regenerate", requireEditor, async (req, res) => {
  const s = await getShot(req.params.id); if (!s) return res.status(404).json({ ok: false });
  const p = await owned(req, res, s.project_id); if (!p) return;
  if (typeof req.body?.image_prompt === "string") await updateShot(s.id, { image_prompt: req.body.image_prompt.slice(0, 2000) });
  await requestKeyframes(p.id, [s.id]);
  res.json({ ok: true });
});
studioRouter.post("/projects/:id/clips", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const r = await requestClips(p.id, req.body?.tier === "final" ? "final" : "draft");
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});
studioRouter.post("/projects/:id/assemble", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const b = req.body || {};
  const r = await requestAssemble(p.id, { voice: b.voice, voiceRate: num(b.voiceRate, 1), music: b.music || null, transition: b.transition });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});
studioRouter.get("/projects/:id/estimate", requireEditor, async (req, res) => {
  const p = await owned(req, res, req.params.id); if (!p) return;
  const shots = await listShots(p.id);
  const approved = shots.filter((s) => s.approved === 1);
  const tier = req.query.tier === "final" ? "final" : "draft";
  const est = estimateProject({ shots: (approved.length || shots.length) || 1, clipLen: p.clip_len, videoModel: STUDIO.engines.video === "fake" ? "fake" : tier === "final" ? STUDIO.videoModelFinal : STUDIO.videoModelDraft, imageModel: STUDIO.engines.image === "fake" ? "fake" : STUDIO.imageModel, voiceEngine: STUDIO.engines.voice, dialogChars: shots.reduce((a, s) => a + s.dialog.length, 0) });
  res.json({ ok: true, estimate: est, spentUsd: p.cost_usd });
});

// File tĩnh: <img>/<video> không gửi header → chấp nhận ?t=<jwt>. Chặn thoát thư mục.
studioRouter.get("/file/:projectId/*", async (req, res) => {
  const tok = String(req.query.t || "") || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = tok ? verifyToken(tok) : null;
  if (!user) return res.status(401).end();
  const p = await getProject(req.params.projectId);
  if (!p || (user.role !== "Quản trị" && p.owner !== user.email.toLowerCase().trim())) return res.status(404).end();
  const root = path.resolve(projectDir(p.id));
  const target = path.resolve(root, String((req.params as any)[0] || ""));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) return res.status(404).end();
  res.sendFile(target);
});
