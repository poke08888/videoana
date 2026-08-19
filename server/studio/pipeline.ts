/**
 * server/studio/pipeline.ts — 5 chặng + máy trạng thái. Mỗi cảnh độc lập: hỏng ở đâu chạy lại
 * đúng chỗ đó. Chi phí ghi sổ ngay khi API trả về. Không gọi ffmpeg/model ở request — queue gọi các run*.
 */
import fs from "node:fs";
import path from "node:path";
import { STUDIO, ensureProjectDirs, projectDir, frameSize } from "./config.js";
import { classifyError, retryDelayMs, humanKind } from "./errors.js";
import { countSyllables, maxSyllablesFor } from "./text.js";
import { getProject, listAssets, listShots, updateShot, updateProject, recordCost, addDiskBytes, saveRender, type Project, type Shot } from "./store.js";
import { allQuery, runQuery } from "../db.js";
import { nanoImageEngine } from "./engines/image.js";
import { veoVideoEngine } from "./engines/video.js";
import { edgeVoiceEngine } from "./engines/voice.js";
import { fptVoiceEngine } from "./engines/voiceFpt.js";
import { fakeImageEngine, fakeVideoEngine, fakeVoiceEngine, FAKE_SYLLABLES_PER_SEC } from "./engines/fake.js";
import { alignWords } from "./engines/align.js";
import type { Engines } from "./engines/types.js";
import { groupCues, shiftCues, toSrt, type SubCue } from "./subtitles.js";
import { assembleVideo, clipStarts, TRANSITIONS, type Transition } from "./assemble.js";
import { runFfmpeg, probeDuration } from "./ffmpeg.js";

export interface RunOutcome { ok: boolean; kind?: ReturnType<typeof classifyError>; message?: string }

export function makeEngines(apiKey: string): Engines {
  const e = STUDIO.engines;
  return {
    image: e.image === "fake" ? fakeImageEngine() : nanoImageEngine(apiKey),
    video: e.video === "fake" ? fakeVideoEngine() : veoVideoEngine(apiKey),
    voice: e.voice === "fake" ? fakeVoiceEngine() : e.voice === "fpt" ? fptVoiceEngine((process.env.FPT_TTS_API_KEY || "").trim()) : edgeVoiceEngine(),
  };
}

/** Nhịp preset theo engine giọng (GĐ 1). GĐ 1.5: lấy từ studio_voices. */
export function syllablesPerSecFor(_p: Project): number {
  return STUDIO.engines.voice === "fake" ? FAKE_SYLLABLES_PER_SEC : 4.8;
}

const fileSize = (p: string) => { try { return fs.statSync(p).size; } catch { return 0; } };
const mimeOf = (p: string) => (/\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg");

async function fail(shot: Shot, field: "image" | "clip", err: unknown): Promise<RunOutcome> {
  const kind = classifyError(err);
  const attempts = (shot.attempts || 0) + 1;
  const delay = retryDelayMs(kind, attempts - 1);
  const msg = `${humanKind(kind)} ${String((err as any)?.message || err).slice(0, 300)}`;
  if (delay !== null) {
    await updateShot(shot.id, { [`${field}_status`]: "pending", attempts, retry_after: new Date(Date.now() + delay).toISOString(), error: msg } as any);
  } else {
    await updateShot(shot.id, { [`${field}_status`]: "failed", attempts, retry_after: null, error: msg } as any);
  }
  console.error(`[xuong] ${field} shot ${shot.id} lỗi (${kind}, lần ${attempts}): ${msg}`);
  return { ok: false, kind, message: msg };
}

// ── Chặng 2: ảnh khoá ─────────────────────────────────────────────────────────
export async function requestKeyframes(projectId: string, shotIds?: string[]): Promise<number> {
  const shots = await listShots(projectId);
  const targets = shots.filter((s) => (!shotIds || shotIds.includes(s.id)) && s.image_status !== "processing");
  for (const s of targets) await updateShot(s.id, { image_status: "pending", image_path: null, approved: 0, clip_status: "idle", clip_path: null, clip_tier: null, attempts: 0, retry_after: null, error: null });
  await updateProject(projectId, { stage: "keyframe", message: null });
  return targets.length;
}

export async function runShotImage(shot: Shot, engines: Engines): Promise<RunOutcome> {
  const p = await getProject(shot.project_id);
  if (!p) return { ok: false, message: "Không thấy dự án." };
  await updateShot(shot.id, { image_status: "processing" });
  try {
    const assets = await listAssets(p.id);
    const refs = [...assets.filter((a) => a.kind === "product"), ...assets.filter((a) => a.kind === "background")].map((a) => ({ path: a.path, mimeType: a.mime }));
    const root = ensureProjectDirs(p.id);
    const outPath = path.join(root, "keyframes", `shot_${shot.idx}_${Date.now()}.png`);
    const prompt = `${shot.image_prompt}\nThe product must match the reference photos exactly (same packaging, text, colors). Place it in the reference background. Photorealistic, vertical ${p.ratio}, hands only, no faces, no overlaid text.`;
    const r = await engines.image.generate({ prompt, refs, aspectRatio: p.ratio, size: "2K", outPath });
    await updateShot(shot.id, { image_status: "done", image_path: r.path, error: null, retry_after: null });
    await recordCost({ projectId: p.id, shotId: shot.id, kind: "image", model: r.model, usd: r.costUsd });
    await addDiskBytes(p.id, fileSize(r.path));
    const all = await listShots(p.id);
    if (all.every((s) => s.image_status === "done")) await updateProject(p.id, { stage: "review" });
    return { ok: true };
  } catch (e) {
    return fail(shot, "image", e);
  }
}

// ── Chặng 3: chốt duyệt ───────────────────────────────────────────────────────
export const setApproved = (shotId: string, approved: 0 | 1) => updateShot(shotId, { approved });

// ── Chặng 4: clip ─────────────────────────────────────────────────────────────
export async function requestClips(projectId: string, tier: "draft" | "final"): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const p = await getProject(projectId);
  if (!p) return { ok: false, message: "Không thấy dự án." };
  const shots = (await listShots(projectId)).filter((s) => s.approved === 1 && s.image_status === "done" && s.image_path);
  if (!shots.length) return { ok: false, message: "Chưa có ảnh nào được duyệt." };
  const max = maxSyllablesFor(syllablesPerSecFor(p), p.clip_len);
  const over = shots.filter((s) => countSyllables(s.dialog) > max).map((s) => `Cảnh ${s.idx + 1}: ${countSyllables(s.dialog)}/${max} âm tiết`);
  if (over.length) return { ok: false, message: `Thoại quá dài, sửa trước khi render — ${over.join("; ")}` };
  let count = 0;
  for (const s of shots) {
    if (s.clip_status === "done" && s.clip_path && s.clip_tier === tier && fs.existsSync(s.clip_path)) continue;
    await updateShot(s.id, { clip_status: "pending", clip_tier: tier, attempts: 0, retry_after: null, error: null });
    count++;
  }
  await updateProject(projectId, { tier, stage: "clip", message: null });
  return { ok: true, count };
}

export async function runShotClip(shot: Shot, engines: Engines): Promise<RunOutcome> {
  const p = await getProject(shot.project_id);
  if (!p) return { ok: false, message: "Không thấy dự án." };
  if (!shot.approved || !shot.image_path) { await updateShot(shot.id, { clip_status: "idle" }); return { ok: false, message: "Shot chưa duyệt." }; }
  await updateShot(shot.id, { clip_status: "processing" });
  try {
    const tier = (shot.clip_tier as "draft" | "final") || p.tier;
    const outPath = path.join(ensureProjectDirs(p.id), "clips", `shot_${shot.idx}_${tier}_${Date.now()}.mp4`);
    const r = await engines.video.generate({ prompt: shot.motion_prompt || shot.image_prompt, firstFrame: { path: shot.image_path, mimeType: mimeOf(shot.image_path) }, durationSec: p.clip_len as 4 | 6 | 8, aspectRatio: p.ratio, tier, motionLevel: shot.motion_level, outPath });
    await updateShot(shot.id, { clip_status: "done", clip_path: r.path, clip_tier: tier, engine: r.model, error: null, retry_after: null });
    await recordCost({ projectId: p.id, shotId: shot.id, kind: "video", model: r.model, usd: r.costUsd });
    await addDiskBytes(p.id, fileSize(r.path));
    return { ok: true };
  } catch (e) {
    return fail(shot, "clip", e);
  }
}

// ── Chặng 5: ghép ─────────────────────────────────────────────────────────────
export async function requestAssemble(projectId: string, o: { voice?: string; voiceRate?: number; music?: string | null; transition?: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = await getProject(projectId);
  if (!p) return { ok: false, message: "Không thấy dự án." };
  const approved = (await listShots(projectId)).filter((s) => s.approved === 1);
  if (!approved.length) return { ok: false, message: "Chưa có cảnh nào được duyệt." };
  const notReady = approved.filter((s) => s.clip_status !== "done" || !s.clip_path);
  if (notReady.length) return { ok: false, message: `Còn ${notReady.length} cảnh chưa có clip.` };
  const transition = TRANSITIONS.includes(o.transition as Transition) ? (o.transition as Transition) : "fade";
  await updateProject(projectId, { voice: o.voice || p.voice || STUDIO.voiceDefault, voice_rate: o.voiceRate || p.voice_rate || 1, music: o.music ?? null, transition, stage: "assemble", assemble_status: "pending", message: null });
  return { ok: true };
}

export async function runAssemble(p: Project, engines: Engines): Promise<RunOutcome> {
  await updateProject(p.id, { assemble_status: "processing" });
  try {
    const shots = (await listShots(p.id)).filter((s) => s.approved === 1 && s.clip_status === "done" && s.clip_path);
    if (!shots.length) throw new Error("Không có cảnh nào để ghép.");
    const root = ensureProjectDirs(p.id);
    const renderDir = path.join(root, "render");
    const clips: { path: string; durationSec: number }[] = [];
    for (const s of shots) clips.push({ path: s.clip_path!, durationSec: await probeDuration(s.clip_path!) });
    const t = p.transition === "none" ? 0 : STUDIO.transitionSec;
    const starts = clipStarts(clips.map((c) => c.durationSec), t);

    const voices: ({ path: string; startSec: number } | null)[] = [];
    const cues: SubCue[] = [];
    let voiceCost = 0;
    for (let k = 0; k < shots.length; k++) {
      const s = shots[k];
      if (!s.dialog.trim()) { voices.push(null); continue; }
      const outPath = path.join(renderDir, `voice_${s.idx}.mp3`);
      const r = await engines.voice.synthesize({ text: s.dialog, voice: p.voice || STUDIO.voiceDefault, rate: p.voice_rate || 1, outPath });
      voiceCost += r.costUsd;
      if (r.durationSec > clips[k].durationSec + 0.3) console.warn(`[xuong] Cảnh ${s.idx + 1}: giọng ${r.durationSec.toFixed(1)}s dài hơn clip ${clips[k].durationSec}s.`);
      voices.push({ path: r.path, startSec: starts[k] });
      cues.push(...shiftCues(groupCues(alignWords(r.words, s.dialog, r.durationSec)), starts[k]));
    }
    if (voiceCost > 0) await recordCost({ projectId: p.id, kind: "voice", model: engines.voice.name, usd: voiceCost });

    const { width, height } = frameSize(p.ratio);
    const musicPath = p.music ? path.join(STUDIO.dataDir, "_music", path.basename(p.music)) : null;
    const outPath = path.join(renderDir, `final_${Date.now()}.mp4`);
    const res = await assembleVideo({ clips, voices, cues, musicPath: musicPath && fs.existsSync(musicPath) ? musicPath : null, transition: (p.transition as Transition) || "fade", width, height, font: STUDIO.subFont, outPath, assPath: path.join(renderDir, "subs.ass") });

    const coverSrc = (shots[Math.min(p.cover_idx || 0, shots.length - 1)] || shots[0]).image_path;
    const coverPath = path.join(renderDir, "cover.jpg");
    if (coverSrc && fs.existsSync(coverSrc)) await runFfmpeg(["-i", coverSrc, "-q:v", "3", "-y", coverPath]);
    const srtPath = path.join(renderDir, "subs.srt");
    fs.writeFileSync(srtPath, toSrt(cues));

    await saveRender({ project_id: p.id, mp4_path: res.outPath, cover_path: fs.existsSync(coverPath) ? coverPath : null, srt_path: srtPath, caption: p.caption, hashtags: p.hashtags, voice: p.voice, music: p.music, duration: res.durationSec, cost_usd: voiceCost });
    await addDiskBytes(p.id, fileSize(res.outPath) + fileSize(coverPath));
    await updateProject(p.id, { stage: "done", assemble_status: "done", message: null });
    return { ok: true };
  } catch (e) {
    const kind = classifyError(e);
    const message = `${humanKind(kind)} ${String((e as any)?.message || e).slice(0, 300)}`;
    await updateProject(p.id, { assemble_status: "failed", stage: "failed", message });
    console.error(`[xuong] ghép ${p.id} lỗi: ${message}`);
    return { ok: false, kind, message };
  }
}

// ── Phục hồi sau restart ──────────────────────────────────────────────────────
/** Đang 'processing' lúc tắt máy: có file thật → done (KHÔNG sinh lại); không có → pending. */
export async function recoverInterrupted(): Promise<void> {
  const rows = await listAllProcessing();
  for (const s of rows) {
    if (s.image_status === "processing") await updateShot(s.id, s.image_path && fs.existsSync(s.image_path) ? { image_status: "done" } : { image_status: "pending", retry_after: null });
    if (s.clip_status === "processing") await updateShot(s.id, s.clip_path && fs.existsSync(s.clip_path) ? { clip_status: "done" } : { clip_status: "pending", retry_after: null });
  }
  await updateProjectsProcessing();
}
const listAllProcessing = () => allQuery<Shot>("SELECT * FROM studio_shots WHERE image_status='processing' OR clip_status='processing'");
const updateProjectsProcessing = () => runQuery("UPDATE studio_projects SET assemble_status='pending' WHERE assemble_status='processing'");
