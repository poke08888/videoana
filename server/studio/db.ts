/**
 * server/studio/db.ts — bảng của Xưởng. Không lưu nhị phân; chỉ đường dẫn file.
 * Gọi từ index.ts sau connectDB(). Migration cột thêm dùng addColumnIfMissing kiểu db.ts.
 */
import { runQuery } from "../db.js";

async function addColumnIfMissing(table: string, columnDef: string) {
  try { await runQuery(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`); } catch { /* đã có */ }
}

export async function initStudioTables() {
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_projects (
    id TEXT PRIMARY KEY, owner TEXT, name TEXT, industry TEXT,
    ratio TEXT DEFAULT '9:16', clip_len INTEGER DEFAULT 8, tier TEXT DEFAULT 'draft',
    script_source TEXT, autopsy_id TEXT, batch_id TEXT,
    stage TEXT DEFAULT 'script', assemble_status TEXT DEFAULT 'idle',
    voice TEXT, voice_rate REAL DEFAULT 1.0, music TEXT, transition TEXT DEFAULT 'fade',
    caption TEXT, hashtags TEXT, cover_idx INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0, disk_bytes INTEGER DEFAULT 0, message TEXT,
    created TEXT, updated TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_assets (
    id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, path TEXT, mime TEXT, created TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_shots (
    id TEXT PRIMARY KEY, project_id TEXT, idx INTEGER,
    purpose TEXT, camera TEXT, dialog TEXT, image_prompt TEXT, motion_prompt TEXT, motion_level TEXT DEFAULT 'medium',
    image_path TEXT, image_status TEXT DEFAULT 'idle', approved INTEGER DEFAULT 0,
    clip_path TEXT, clip_status TEXT DEFAULT 'idle', clip_tier TEXT, engine TEXT,
    attempts INTEGER DEFAULT 0, retry_after TEXT, cost_usd REAL DEFAULT 0, error TEXT, updated TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_renders (
    id TEXT PRIMARY KEY, project_id TEXT, mp4_path TEXT, cover_path TEXT, srt_path TEXT,
    caption TEXT, hashtags TEXT, voice TEXT, music TEXT, duration REAL, cost_usd REAL DEFAULT 0, created TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, shot_id TEXT, kind TEXT, model TEXT, usd REAL, created TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS studio_batches (
    id TEXT PRIMARY KEY, owner TEXT, name TEXT, config TEXT, status TEXT, created TEXT)`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_studio_shots_project ON studio_shots(project_id, idx)`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_studio_costs_created ON studio_costs(created)`);
  // Migration về sau thêm ở đây, SAU CREATE TABLE (bài học commit d84e0e6).
  await addColumnIfMissing("studio_projects", "cover_idx INTEGER DEFAULT 0");
}
