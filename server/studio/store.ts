/**
 * server/studio/store.ts — CRUD có kiểu cho bảng studio_*. Trường giữ snake_case như cột.
 * updateX chỉ nhận cột trong whitelist — không bao giờ nội suy tên cột từ đầu vào.
 */
import { db, runQuery, allQuery, getQuery } from "../db.js";

export interface Project {
  id: string; owner: string; name: string; industry: string; ratio: "9:16" | "16:9" | "1:1"; clip_len: number;
  tier: "draft" | "final"; script_source: string; autopsy_id: string | null; batch_id: string | null;
  stage: "script" | "keyframe" | "review" | "clip" | "assemble" | "done" | "failed";
  assemble_status: "idle" | "pending" | "processing" | "done" | "failed";
  voice: string | null; voice_rate: number; music: string | null; transition: string;
  caption: string | null; hashtags: string | null; cover_idx: number;
  cost_usd: number; disk_bytes: number; message: string | null; created: string; updated: string;
}
export interface Asset { id: string; project_id: string; kind: "product" | "background" | "style"; path: string; mime: string; created: string }
export interface Shot {
  id: string; project_id: string; idx: number;
  purpose: string; camera: string; dialog: string; image_prompt: string; motion_prompt: string; motion_level: "low" | "medium" | "high";
  image_path: string | null; image_status: "idle" | "pending" | "processing" | "done" | "failed"; approved: number;
  clip_path: string | null; clip_status: "idle" | "pending" | "processing" | "done" | "failed"; clip_tier: string | null; engine: string | null;
  attempts: number; retry_after: string | null; cost_usd: number; error: string | null; updated: string;
}
export interface ShotInput { purpose: string; camera: string; dialog: string; image_prompt: string; motion_prompt: string; motion_level: "low" | "medium" | "high" }
export interface RenderRow {
  id?: string; project_id: string; mp4_path: string; cover_path: string | null; srt_path: string | null;
  caption: string | null; hashtags: string | null; voice: string | null; music: string | null; duration: number; cost_usd: number; created?: string;
}

export const newId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

export function runQueryChanges(sql: string, params: any[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (this: any, err: any) { if (err) reject(err); else resolve(this.changes || 0); });
  });
}

const PROJECT_COLS = ["name", "industry", "ratio", "clip_len", "tier", "script_source", "autopsy_id", "batch_id", "stage", "assemble_status", "voice", "voice_rate", "music", "transition", "caption", "hashtags", "cover_idx", "message"];
const SHOT_COLS = ["idx", "purpose", "camera", "dialog", "image_prompt", "motion_prompt", "motion_level", "image_path", "image_status", "approved", "clip_path", "clip_status", "clip_tier", "engine", "attempts", "retry_after", "error"];

async function patchRow(table: string, cols: string[], id: string, patch: Record<string, any>) {
  const keys = Object.keys(patch).filter((k) => cols.includes(k));
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  await runQuery(`UPDATE ${table} SET ${set}, updated = ? WHERE id = ?`, [...keys.map((k) => patch[k]), now(), id]);
}

export async function createProject(a: { owner: string; name: string; industry: string; ratio: Project["ratio"]; clipLen: number; tier: Project["tier"]; scriptSource: string }): Promise<Project> {
  const id = newId("p");
  const t = now();
  await runQuery(
    "INSERT INTO studio_projects (id, owner, name, industry, ratio, clip_len, tier, script_source, stage, assemble_status, created, updated) VALUES (?,?,?,?,?,?,?,?, 'script','idle', ?, ?)",
    [id, a.owner.toLowerCase().trim(), a.name, a.industry, a.ratio, a.clipLen, a.tier, a.scriptSource, t, t]
  );
  return (await getProject(id))!;
}
export const getProject = (id: string) => getQuery<Project>("SELECT * FROM studio_projects WHERE id = ?", [id]);
export function listProjects(owner: string | null): Promise<Project[]> {
  return owner === null
    ? allQuery<Project>("SELECT * FROM studio_projects ORDER BY created DESC")
    : allQuery<Project>("SELECT * FROM studio_projects WHERE owner = ? ORDER BY created DESC", [owner.toLowerCase().trim()]);
}
export const updateProject = (id: string, patch: Partial<Project>) => patchRow("studio_projects", PROJECT_COLS, id, patch);
export async function deleteProject(id: string) {
  for (const t of ["studio_shots", "studio_assets", "studio_renders", "studio_costs"]) await runQuery(`DELETE FROM ${t} WHERE project_id = ?`, [id]);
  await runQuery("DELETE FROM studio_projects WHERE id = ?", [id]);
}

export async function addAsset(projectId: string, kind: Asset["kind"], path: string, mime: string): Promise<Asset> {
  const id = newId("a");
  await runQuery("INSERT INTO studio_assets (id, project_id, kind, path, mime, created) VALUES (?,?,?,?,?,?)", [id, projectId, kind, path, mime, now()]);
  return (await getQuery<Asset>("SELECT * FROM studio_assets WHERE id = ?", [id]))!;
}
export const listAssets = (projectId: string) => allQuery<Asset>("SELECT * FROM studio_assets WHERE project_id = ? ORDER BY created ASC", [projectId]);

export async function replaceShots(projectId: string, inputs: ShotInput[]): Promise<Shot[]> {
  await runQuery("DELETE FROM studio_shots WHERE project_id = ?", [projectId]);
  const t = now();
  for (let i = 0; i < inputs.length; i++) {
    const s = inputs[i];
    await runQuery(
      "INSERT INTO studio_shots (id, project_id, idx, purpose, camera, dialog, image_prompt, motion_prompt, motion_level, updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [newId("s"), projectId, i, s.purpose, s.camera, s.dialog || "", s.image_prompt || "", s.motion_prompt || "", s.motion_level || "medium", t]
    );
  }
  return listShots(projectId);
}
export const listShots = (projectId: string) => allQuery<Shot>("SELECT * FROM studio_shots WHERE project_id = ? ORDER BY idx ASC", [projectId]);
export const getShot = (id: string) => getQuery<Shot>("SELECT * FROM studio_shots WHERE id = ?", [id]);
export const updateShot = (id: string, patch: Partial<Shot>) => patchRow("studio_shots", SHOT_COLS, id, patch);

export async function recordCost(a: { projectId: string; shotId?: string; kind: "image" | "video" | "voice" | "script"; model: string; usd: number }) {
  await runQuery("INSERT INTO studio_costs (project_id, shot_id, kind, model, usd, created) VALUES (?,?,?,?,?,?)", [a.projectId, a.shotId || null, a.kind, a.model, a.usd, now()]);
  await runQuery("UPDATE studio_projects SET cost_usd = ROUND(cost_usd + ?, 4) WHERE id = ?", [a.usd, a.projectId]);
  if (a.shotId) await runQuery("UPDATE studio_shots SET cost_usd = ROUND(cost_usd + ?, 4) WHERE id = ?", [a.usd, a.shotId]);
}
export async function todaySpendUsd(): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const r = await getQuery<{ s: number }>("SELECT COALESCE(SUM(usd),0) AS s FROM studio_costs WHERE created >= ?", [day]);
  return Number(r?.s || 0);
}
export async function totalDiskBytes(): Promise<number> {
  const r = await getQuery<{ s: number }>("SELECT COALESCE(SUM(disk_bytes),0) AS s FROM studio_projects");
  return Number(r?.s || 0);
}
export const addDiskBytes = (projectId: string, bytes: number) => runQuery("UPDATE studio_projects SET disk_bytes = disk_bytes + ? WHERE id = ?", [bytes, projectId]);

export async function saveRender(r: RenderRow): Promise<RenderRow> {
  await runQuery("DELETE FROM studio_renders WHERE project_id = ?", [r.project_id]);
  const id = newId("r");
  await runQuery(
    "INSERT INTO studio_renders (id, project_id, mp4_path, cover_path, srt_path, caption, hashtags, voice, music, duration, cost_usd, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, r.project_id, r.mp4_path, r.cover_path, r.srt_path, r.caption, r.hashtags, r.voice, r.music, r.duration, r.cost_usd, now()]
  );
  return (await getRender(r.project_id))!;
}
export const getRender = (projectId: string) => getQuery<RenderRow>("SELECT * FROM studio_renders WHERE project_id = ?", [projectId]);
