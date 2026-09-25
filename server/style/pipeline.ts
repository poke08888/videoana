/**
 * server/style/pipeline.ts — việc nền của Style kênh (spec §3 bước 3–4, §11).
 * runStyleVideo: tải → đo → phân tích → (mẫu chuẩn) timeline → lưu → xoá tạm → finalize nếu đủ.
 * finalizeProfileIfDone: khi hết pending/processing → aggregate → cluster → narrate → SKILL.md → done/failed.
 */
import fs from "node:fs";
import path from "node:path";
import { STYLE } from "./config.js";
import { measureVideo } from "./measure.js";
import { makeStyleEngine, type StyleEngine } from "./analyze.js";
import { aggregateProfile, type AggInput } from "./aggregate.js";
import { buildSkillMd } from "./skill.js";
import { getProfile, listVideos, updateProfile, updateVideo, findReusable, claimAggregation } from "./store.js";
import { downloadTikTok, resolveTokapiKey } from "../tiktok.js";
import { downloadDouyin, resolveDouyinKey } from "../douyin.js";
import { runQuery, allQuery } from "../db.js";
import type { StyleMeasure, StyleAnalysis, StyleTimelineShot, StyleProfile, VideoRow } from "./types.js";

export interface StyleDeps { engine: StyleEngine; measure: (path: string) => Promise<StyleMeasure>; download: (link: string, platform: string, dir: string) => Promise<{ path: string }> }

export function makeStyleDeps(apiKey: string): StyleDeps {
  return {
    engine: makeStyleEngine(apiKey), measure: measureVideo,
    download: async (link, platform, dir) => {
      if (platform === "douyin") { const k = resolveDouyinKey(undefined); if (!k) throw new Error("Chưa cấu hình DOUYIN_RAPIDAPI_KEY/TOKAPI_RAPIDAPI_KEY."); return downloadDouyin(link, k, dir); }
      const k = resolveTokapiKey(undefined); if (!k) throw new Error("Chưa cấu hình TOKAPI_RAPIDAPI_KEY."); return downloadTikTok(link, k, dir);
    },
  };
}
/** Chỉ áp cho lỗi từ deps.engine.* (lỗi tải/cấu hình khác không được làm dừng cả hàng đợi). */
const isBilling = (e: any) => /PERMISSION_DENIED|API key not valid|invalid.*key|\b401\b|quota|RESOURCE_EXHAUSTED|billing/i.test(String(e?.message || e));
const parse = <T>(s: string | null, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export async function runStyleVideo(v: VideoRow, deps: StyleDeps): Promise<{ ok: boolean; kind?: "billing" }> {
  const profile = await getProfile(v.profile_id);
  if (!profile) { await updateVideo(v.id, { status: "failed", error: "Profile không còn tồn tại." }); return { ok: false }; }
  // Tái dùng phiếu cùng link của cùng owner (spec §3 bước 3)
  const prior = await findReusable(profile.owner, v.link);
  // Mẫu chuẩn cần timeline: nếu phiếu cũ không có timeline thì KHÔNG tái dùng, đi đường thường để dựng timeline.
  if (prior && prior.id !== v.id && prior.analysis && !(v.is_exemplar && !prior.timeline)) {
    await updateVideo(v.id, { status: "done", measure: prior.measure, analysis: prior.analysis, timeline: v.is_exemplar ? prior.timeline : null, frames: prior.frames, warnings: prior.warnings, error: null });
    console.log(`[style] Tái dùng phiếu style cho link trùng: ${v.link}`);
    await finalizeProfileIfDone(v.profile_id, deps).catch((e) => console.error("[style] finalize (reuse):", e));
    return { ok: true };
  }
  // Thư mục tạm riêng từng video: 2 dòng cùng link (cùng awemeId) không giẫm file của nhau.
  const dir = path.join(STYLE.tmpDir, v.id);
  let stage: "download" | "measure" | "engine" = "download";
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const file = (await deps.download(v.link, profile.platform, dir)).path;
    stage = "measure";
    let measure: StyleMeasure | null = null;
    try { measure = await deps.measure(file); } catch (e) { console.warn(`[style] ffmpeg lỗi (${v.link}), Gemini tự ước lượng:`, String((e as any)?.message || e)); }
    stage = "engine";
    const analysis: StyleAnalysis = await deps.engine.analyze({ videoPath: file, mimeType: "video/mp4", measure, meta: { title: v.title, platform: profile.platform === "douyin" ? "Douyin" : "TikTok", nickname: profile.nickname } });
    let timeline: StyleTimelineShot[] | null = null;
    if (v.is_exemplar) {
      try { timeline = await deps.engine.timeline({ videoPath: file, mimeType: "video/mp4", cuts: measure?.cuts || [], duration: measure?.duration || 0 }); }
      catch (e) { analysis.warnings.push(`timeline lỗi: ${String((e as any)?.message || e)}`); }
    }
    const frames = measure?.frames || []; if (measure) measure = { ...measure, frames: [] }; // frames lưu cột riêng
    await updateVideo(v.id, { status: "done", measure: JSON.stringify(measure), analysis: JSON.stringify(analysis), timeline: timeline ? JSON.stringify(timeline) : null, frames: JSON.stringify(frames), warnings: JSON.stringify(analysis.warnings), error: null });
    console.log(`[style] Xong phiếu style: ${v.title || v.link}`);
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500);
    await updateVideo(v.id, { status: "failed", error: msg });
    console.error(`[style] Lỗi video ${v.link}: ${msg}`);
    await finalizeProfileIfDone(v.profile_id, deps).catch((err) => console.error("[style] finalize (sau lỗi):", err));
    return { ok: false, kind: stage === "engine" && isBilling(e) ? "billing" : undefined };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  await finalizeProfileIfDone(v.profile_id, deps).catch((e) => console.error("[style] finalize:", e));
  return { ok: true };
}

/** Dòng done có analysis hỏng JSON bị bỏ qua và tính là lỗi. */
function toAggInputs(rows: VideoRow[]): { inputs: AggInput[]; bad: number } {
  const inputs: AggInput[] = []; let bad = 0;
  for (const r of rows) {
    if (r.status !== "done" || !r.analysis) continue;
    let analysis: StyleAnalysis;
    try { analysis = JSON.parse(r.analysis) as StyleAnalysis; if (!analysis || typeof analysis !== "object") throw new Error("không phải object"); }
    catch { bad++; continue; }
    const measure = parse<StyleMeasure | null>(r.measure, null); const frames = parse<string[]>(r.frames, []);
    inputs.push({ videoId: r.aweme_id, link: r.link, views: r.views || 0, createTime: r.create_time || 0, measure: measure ? { ...measure, frames } : null, analysis, timeline: parse<StyleTimelineShot[] | null>(r.timeline, null), isExemplar: r.is_exemplar === 1 });
  }
  if (bad) console.warn(`[style] ${bad} phiếu có analysis hỏng JSON, bỏ qua khi tổng hợp.`);
  return { inputs, bad };
}

/** Gọi SAU khi đã claimAggregation (profile đang 'aggregating'). Không bao giờ để kẹt 'aggregating'. */
async function buildAndSave(profileId: string, deps: StyleDeps): Promise<void> {
  try {
    const p = await getProfile(profileId); if (!p) return;
    const rows = await listVideos(profileId);
    const { inputs, bad } = toAggInputs(rows); const failed = rows.filter((r) => r.status === "failed").length + bad;
    if (inputs.length < STYLE.minVideos) { await updateProfile(profileId, { status: "failed", message: `Chỉ ${inputs.length}/${rows.length} video phân tích được (cần ≥ ${STYLE.minVideos}). Bấm "Chạy lại video lỗi" hoặc hạ STYLE_MIN_VIDEOS.` }); return; }
    await updateProfile(profileId, { message: null });
    const agg = aggregateProfile(inputs, Math.floor(Date.now() / 1000), { platform: p.platform, handle: p.handle, nickname: p.nickname, avatar: p.avatar }, deps.engine.name === "fake" ? "fake" : STYLE.model);
    agg.videos.failed = failed;
    const cluster = async (kind: "opening" | "closing" | "cta") => { try { return await deps.engine.cluster({ kind, texts: agg.formulas[kind] }); } catch { return agg.formulas[kind].slice(0, 5).map((t) => ({ text: t, count: 1, examples: [t] })); } };
    const profile: StyleProfile = { ...agg, formulas: { opening: await cluster("opening"), closing: await cluster("closing"), cta: await cluster("cta") } };
    let narr = { overview: "", persona: "", howTo: "" };
    try { narr = await deps.engine.narrate({ profile }); } catch (e) { console.warn("[style] narrate lỗi, SKILL.md không có đoạn văn:", String((e as any)?.message || e)); }
    const fallback = "(AI chưa viết được đoạn này — xem số đo và quy tắc bên dưới.)";
    const skillMd = buildSkillMd(profile, { overview: narr.overview || fallback, persona: narr.persona || fallback, howTo: narr.howTo || fallback });
    await updateProfile(profileId, { status: "done", profile: JSON.stringify(profile), skill_md: skillMd, message: `Tổng hợp từ ${profile.videos.used}/${rows.length} video.` });
    console.log(`[style] Profile ${profileId} (${p.handle}) hoàn tất: ${profile.videos.used} video, ${profile.rules.hard.length} quy tắc cứng.`);
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500);
    console.error(`[style] Tổng hợp profile ${profileId} lỗi:`, msg);
    await updateProfile(profileId, { status: "failed", message: `Tổng hợp lỗi: ${msg}` }).catch((err) => console.error("[style] không ghi được trạng thái failed:", err));
  }
}

/** Gọi sau mỗi video. Chỉ tổng hợp khi không còn pending/processing, và chỉ 1 worker giành được quyền tổng hợp. */
export async function finalizeProfileIfDone(profileId: string, deps: StyleDeps): Promise<boolean> {
  const p = await getProfile(profileId); if (!p || p.status === "done" || p.status === "aggregating") return false;
  const rows = await listVideos(profileId);
  if (rows.some((r) => r.status === "pending" || r.status === "processing")) return false;
  if (!(await claimAggregation(profileId, ["running", "failed"]))) return false;
  await buildAndSave(profileId, deps); return true;
}
/** Kiểm tra + giành quyền tổng hợp tay. Ném lỗi "đang phân tích"/"đang tổng hợp" nếu chưa sẵn sàng. */
async function claimManualAggregation(profileId: string): Promise<void> {
  // Còn video chưa xong thì không tổng hợp tay: nếu profile thành 'done' giữa chừng, các video về sau
  // sẽ không bao giờ được finalize (finalizeProfileIfDone bỏ qua profile 'done').
  const busy = (await listVideos(profileId)).filter((r) => r.status === "pending" || r.status === "processing").length;
  if (busy > 0) throw new Error(`Còn ${busy} video đang phân tích — chờ xong rồi tổng hợp.`);
  if (!(await claimAggregation(profileId, ["running", "failed", "done"]))) throw new Error("Profile đang tổng hợp, thử lại sau.");
}
/** Tổng hợp lại theo yêu cầu người dùng (từ phiếu đã có) — CHỜ xong. Dùng cho test/tương thích. */
export async function aggregateNow(profileId: string, deps: StyleDeps): Promise<void> {
  await claimManualAggregation(profileId);
  await buildAndSave(profileId, deps);
}
/**
 * Như aggregateNow nhưng KHÔNG chờ: kiểm tra + claim đồng bộ (ném lỗi như aggregateNow), rồi chạy
 * buildAndSave nền. Route dùng hàm này để không vượt giới hạn ~100 s của Cloudflare; UI poll khi 'aggregating'.
 */
export async function startAggregateNow(profileId: string, deps: StyleDeps): Promise<void> {
  await claimManualAggregation(profileId);
  // buildAndSave tự bắt lỗi và ghi 'failed'; catch ở đây chỉ phòng lỗi bất ngờ để không thành unhandled rejection.
  void buildAndSave(profileId, deps).catch((e) => console.error(`[style] Tổng hợp nền profile ${profileId} lỗi:`, e));
}
/** Khi khởi động: video kẹt processing → pending; profile aggregating → running.
 *  Có deps: profile 'running' mà không còn video pending/processing → finalize ngay (tuần tự). */
export async function recoverStyleInterrupted(deps?: StyleDeps): Promise<void> {
  await runQuery("UPDATE style_videos SET status = 'pending' WHERE status = 'processing'");
  await runQuery("UPDATE style_profiles SET status = 'running' WHERE status = 'aggregating'");
  // Đang lấy danh sách video thì mất việc nền → failed, KHÔNG tự chạy lại (tránh gọi RapidAPI bất ngờ).
  await runQuery("UPDATE style_profiles SET status = 'failed', message = ?, updated_at = ? WHERE status = 'picking'", ["Máy chủ khởi động lại giữa lúc lấy video — bấm Chạy lại.", new Date().toISOString()]);
  if (!deps) return;
  const stuck = await allQuery<{ id: string }>("SELECT p.id FROM style_profiles p WHERE p.status = 'running' AND NOT EXISTS (SELECT 1 FROM style_videos v WHERE v.profile_id = p.id AND v.status IN ('pending','processing'))");
  for (const { id } of stuck) {
    try { await finalizeProfileIfDone(id, deps); } catch (e) { console.error(`[style] recover finalize ${id}:`, e); }
  }
}
