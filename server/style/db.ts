/** server/style/db.ts — bảng Style kênh (spec §8). Gọi sau connectDB(). */
import { runQuery } from "../db.js";

export async function initStyleTables() {
  await runQuery(`CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY, owner TEXT, platform TEXT, handle TEXT, nickname TEXT, avatar TEXT,
    status TEXT DEFAULT 'running', picked_ids TEXT, exemplar_ids TEXT,
    profile TEXT, skill_md TEXT, message TEXT, created_at TEXT, updated_at TEXT)`);
  await runQuery(`CREATE TABLE IF NOT EXISTS style_videos (
    id TEXT PRIMARY KEY, profile_id TEXT, aweme_id TEXT, link TEXT, title TEXT, cover TEXT,
    views INTEGER, likes INTEGER, create_time INTEGER, is_exemplar INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', measure TEXT, analysis TEXT, timeline TEXT, frames TEXT, warnings TEXT, error TEXT, updated_at TEXT)`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_style_videos_profile ON style_videos(profile_id)`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_style_videos_status ON style_videos(status)`);
  // Migration về sau thêm ở đây, SAU CREATE TABLE (bài học d84e0e6).
}
