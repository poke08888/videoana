/** server/style/store.ts — CRUD style_profiles / style_videos. Không logic nghiệp vụ. */
import { runQuery, getQuery, allQuery } from "../db.js";
import { runQueryChanges } from "../studio/store.js";
import type { ProfileRow, VideoRow, PickedVideo } from "./types.js";

export const newId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 10);
const NOW = () => new Date().toISOString();
const PROFILE_COLS = ["status", "profile", "skill_md", "message", "picked_ids", "exemplar_ids", "nickname", "avatar"];
const VIDEO_COLS = ["status", "measure", "analysis", "timeline", "frames", "warnings", "error", "cover", "title"];

async function patchRow(table: string, cols: string[], id: string, patch: Record<string, any>, tsCol: string) {
  const keys = Object.keys(patch).filter((k) => cols.includes(k));
  if (!keys.length) return;
  await runQuery(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, ${tsCol} = ? WHERE id = ?`, [...keys.map((k) => patch[k]), NOW(), id]);
}

/** Chèn danh sách video (pending) cho 1 profile — dùng chung cho createProfile và fillProfileVideos. */
async function insertVideos(profileId: string, videos: PickedVideo[], exemplarIds: string[], now: string) {
  const ex = new Set(exemplarIds);
  for (const v of videos) await runQuery("INSERT INTO style_videos (id, profile_id, aweme_id, link, title, cover, views, likes, create_time, is_exemplar, status, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)",
    [newId("sv"), profileId, v.awemeId, v.link, v.title, v.cover, v.views, v.likes, v.createTime, ex.has(v.awemeId) ? 1 : 0, now]);
}
export async function createProfile(a: { owner: string; platform: string; handle: string; nickname: string; avatar: string; videos: PickedVideo[]; exemplarIds: string[] }): Promise<ProfileRow> {
  const id = newId("sp"); const now = NOW();
  await runQuery("INSERT INTO style_profiles (id, owner, platform, handle, nickname, avatar, status, picked_ids, exemplar_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,'running',?,?,?,?)",
    [id, a.owner, a.platform, a.handle, a.nickname, a.avatar, JSON.stringify(a.videos.map((v) => v.awemeId)), JSON.stringify(a.exemplarIds), now, now]);
  await insertVideos(id, a.videos, a.exemplarIds, now);
  return (await getProfile(id))!;
}
/** Vỏ profile 'picking' tạo ngay khi bấm nút — video lấy nền rồi fillProfileVideos đổ vào. */
export async function createProfileShell(a: { owner: string; platform: string; handle: string; sourceUrl: string }): Promise<ProfileRow> {
  const id = newId("sp"); const now = NOW();
  await runQuery("INSERT INTO style_profiles (id, owner, platform, handle, nickname, avatar, status, picked_ids, exemplar_ids, source_url, created_at, updated_at) VALUES (?,?,?,?,?,'','picking','[]','[]',?,?,?)",
    [id, a.owner, a.platform, a.handle, a.handle, a.sourceUrl, now, now]);
  return (await getProfile(id))!;
}
/** Đổ video đã chọn vào profile 'picking' (nickname/handle rỗng thì giữ giá trị vỏ). Đổi status='running' SAU CÙNG để hàng đợi không thấy profile running rỗng. */
export async function fillProfileVideos(profileId: string, a: { nickname: string; avatar: string; handle: string; videos: PickedVideo[]; exemplarIds: string[] }): Promise<void> {
  const now = NOW();
  const n = await runQueryChanges("UPDATE style_profiles SET nickname = COALESCE(NULLIF(?, ''), nickname), avatar = ?, handle = COALESCE(NULLIF(?, ''), handle), picked_ids = ?, exemplar_ids = ?, updated_at = ? WHERE id = ? AND status = 'picking'",
    [a.nickname, a.avatar, a.handle, JSON.stringify(a.videos.map((v) => v.awemeId)), JSON.stringify(a.exemplarIds), now, profileId]);
  if (n !== 1) return; // profile đã bị xoá (hoặc không còn picking) trong lúc lấy video → không chèn video mồ côi
  await insertVideos(profileId, a.videos, a.exemplarIds, now);
  await updateProfile(profileId, { status: "running", message: null });
}
export const getProfile = (id: string) => getQuery<ProfileRow>("SELECT * FROM style_profiles WHERE id = ?", [id]);
export type ProfileListRow = Pick<ProfileRow, "id" | "owner" | "platform" | "handle" | "nickname" | "avatar" | "status" | "message" | "source_url" | "created_at" | "updated_at"> & { hasProfile: number; done: number; failed: number; total: number };
export function listProfiles(owner: string | null) {
  // Cột nhẹ: KHÔNG kéo profile/skill_md (JSON lớn, có ảnh base64) cho màn danh sách.
  const sql = `SELECT p.id, p.owner, p.platform, p.handle, p.nickname, p.avatar, p.status, p.message, p.source_url, p.created_at, p.updated_at, (p.profile IS NOT NULL) AS hasProfile, SUM(v.status='done') AS done, SUM(v.status='failed') AS failed, COUNT(v.id) AS total FROM style_profiles p LEFT JOIN style_videos v ON v.profile_id = p.id ${owner ? "WHERE p.owner = ?" : ""} GROUP BY p.id ORDER BY p.created_at DESC`;
  return allQuery<ProfileListRow>(sql, owner ? [owner] : []);
}
export const updateProfile = (id: string, patch: Partial<ProfileRow>) => patchRow("style_profiles", PROFILE_COLS, id, patch, "updated_at");
export async function deleteProfile(id: string) { await runQuery("DELETE FROM style_videos WHERE profile_id = ?", [id]); await runQuery("DELETE FROM style_profiles WHERE id = ?", [id]); }
export const listVideos = (profileId: string) => allQuery<VideoRow>("SELECT * FROM style_videos WHERE profile_id = ? ORDER BY views DESC", [profileId]);
export const getVideo = (id: string) => getQuery<VideoRow>("SELECT * FROM style_videos WHERE id = ?", [id]);
export const updateVideo = (id: string, patch: Partial<VideoRow>) => patchRow("style_videos", VIDEO_COLS, id, patch, "updated_at");
export const findReusable = (owner: string, link: string) => getQuery<VideoRow>("SELECT v.* FROM style_videos v JOIN style_profiles p ON p.id = v.profile_id WHERE v.link = ? AND v.status = 'done' AND p.owner = ? ORDER BY v.updated_at DESC LIMIT 1", [link, owner]);
/** Claim nguyên tử: pending → processing. Trả VideoRow hoặc null nếu có worker khác đã lấy.
 *  Công bằng: profile tạo trước chạy trước (FIFO theo profile), trong 1 profile mẫu chuẩn rồi view cao trước. */
export async function claimVideo(): Promise<VideoRow | null> {
  const row = await getQuery<VideoRow>("SELECT v.* FROM style_videos v JOIN style_profiles p ON p.id = v.profile_id WHERE v.status = 'pending' AND p.status <> 'picking' ORDER BY p.created_at ASC, v.is_exemplar DESC, v.views DESC LIMIT 1");
  if (!row) return null;
  const n = await runQueryChanges("UPDATE style_videos SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'", [NOW(), row.id]);
  return n === 1 ? (await getVideo(row.id)) || null : null;
}
/** Claim nguyên tử quyền tổng hợp: status ∈ fromStatuses → 'aggregating'. true nếu chính lời gọi này lấy được. */
export async function claimAggregation(profileId: string, fromStatuses: string[]): Promise<boolean> {
  if (!fromStatuses.length) return false;
  const n = await runQueryChanges(`UPDATE style_profiles SET status = 'aggregating', updated_at = ? WHERE id = ? AND status IN (${fromStatuses.map(() => "?").join(",")})`, [NOW(), profileId, ...fromStatuses]);
  return n === 1;
}
