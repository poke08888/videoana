/**
 * server/style/routes.ts — API Style kênh (spec §9). Mỏng: kiểm đầu vào, quyền sở hữu, gọi store/pipeline.
 * Phụ thuộc ngoài (RapidAPI, engine) tiêm qua deps để test hermetic.
 */
import { Router, type Request, type Response } from "express";
import { requireEditor, verifyToken } from "../auth.js";
import { normalizeAccountInput, type Account, type AccountVideo } from "../account.js";
import { STYLE } from "./config.js";
import { pickStyleVideos } from "./pick.js";
import { createProfile, getProfile, listProfiles, listVideos, updateVideo, updateProfile, deleteProfile } from "./store.js";
import { aggregateNow, type StyleDeps } from "./pipeline.js";
import { buildSkillZip } from "./zip.js";
import { styleQueueStatus } from "./queue.js";
import type { ProfileRow, PickedVideo, StyleProfile } from "./types.js";

export interface RouterDeps {
  style: StyleDeps;
  resolveAccount: (input: string, key: string) => Promise<Account>;
  fetchAccountVideos: (account: Account, opts: { count: number; key: string }) => Promise<AccountVideo[]>;
  rapidKey: (platform: "tiktok" | "douyin") => string | null;
}
const ownerEmail = (req: any) => String(req?.user?.email || "").toLowerCase().trim();
const isAdmin = (req: any) => req?.user?.role === "Quản trị";
const parse = <T>(s: string | null, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export function makeStyleRouter(deps: RouterDeps): Router {
  const r = Router();
  async function owned(req: Request, res: Response, id: string): Promise<ProfileRow | null> {
    const p = await getProfile(id);
    if (!p || (!isAdmin(req) && p.owner !== ownerEmail(req))) { res.status(404).json({ ok: false, message: "Không tìm thấy profile." }); return null; }
    return p;
  }
  /** Ảnh/zip mở bằng <a href> không gửi header → chấp nhận token trên query `t`. */
  const authQuery = (req: Request, res: Response, next: () => void) => { const t = String(req.query.t || ""); const p = t ? verifyToken(t) : null; if (!p) return res.status(401).json({ ok: false }); (req as any).user = p; next(); };

  r.get("/health", requireEditor, (_req, res) => res.json({ ok: true, engine: STYLE.engine, model: STYLE.model, queue: styleQueueStatus(), minVideos: STYLE.minVideos }));

  r.post("/pick", requireEditor, async (req, res) => {
    try {
      const url = String(req.body?.url || "").trim();
      const norm = normalizeAccountInput(url);
      if (!norm) return res.status(400).json({ ok: false, message: "Link kênh không hợp lệ (tiktok.com/@ten hoặc douyin.com/user/...)." });
      const key = deps.rapidKey(norm.platform);
      if (!key) return res.status(400).json({ ok: false, message: "Chưa cấu hình RapidAPI key (TOKAPI_RAPIDAPI_KEY)." });
      let account: Account;
      try { account = await deps.resolveAccount(url, key); } catch (e: any) { return res.status(400).json({ ok: false, message: e?.message || "Không resolve được kênh." }); }
      const all = await deps.fetchAccountVideos(account, { count: 100, key });
      if (!all.length) return res.status(400).json({ ok: false, message: "Kênh không có video công khai (riêng tư hoặc bị chặn)." });
      const count = Math.min(Math.max(1, Number(req.body?.count) || STYLE.pickCount), 100);
      const exemplars = Math.min(Math.max(1, Number(req.body?.exemplars) || STYLE.exemplarCount), count);
      const picked = pickStyleVideos(all, Math.floor(Date.now() / 1000), { count, exemplars });
      res.json({ ok: true, account, ...picked, fetched: all.length });
    } catch (e: any) { console.error("[style] pick:", e); res.status(500).json({ ok: false, message: "Lỗi hệ thống khi lấy video kênh." }); }
  });

  r.post("/create", requireEditor, async (req, res) => {
    try {
      const account = req.body?.account; const incoming: any[] = Array.isArray(req.body?.videos) ? req.body.videos : []; const exemplarIds: string[] = Array.isArray(req.body?.exemplarIds) ? req.body.exemplarIds.map(String) : [];
      if (!account?.platform || !account?.handle) return res.status(400).json({ ok: false, message: "Thiếu thông tin kênh." });
      const videos: PickedVideo[] = incoming.filter((v) => v && v.awemeId && v.link).slice(0, 100).map((v) => ({ awemeId: String(v.awemeId), link: String(v.link), title: String(v.title || "").slice(0, 120), cover: String(v.cover || ""), views: Number(v.views) || 0, likes: Number(v.likes) || 0, createTime: Number(v.createTime) || 0, isExemplar: exemplarIds.includes(String(v.awemeId)) }));
      if (!videos.length) return res.status(400).json({ ok: false, message: "Chưa chọn video nào." });
      const p = await createProfile({ owner: ownerEmail(req), platform: account.platform, handle: String(account.handle), nickname: String(account.nickname || account.handle), avatar: String(account.avatar || ""), videos, exemplarIds: exemplarIds.filter((id) => videos.some((v) => v.awemeId === id)) });
      res.json({ ok: true, profileId: p.id, count: videos.length });
    } catch (e: any) { console.error("[style] create:", e); res.status(500).json({ ok: false, message: "Lỗi hệ thống khi tạo profile." }); }
  });

  r.get("/profiles", requireEditor, async (req, res) => res.json({ ok: true, profiles: (await listProfiles(isAdmin(req) ? null : ownerEmail(req))).map((p) => ({ ...p, profile: undefined, skill_md: undefined, hasProfile: !!p.profile })) }));

  r.get("/profile/:id", requireEditor, async (req, res) => {
    const p = await owned(req, res, req.params.id); if (!p) return;
    const videos = (await listVideos(p.id)).map((v) => ({ ...v, measure: parse(v.measure, null), analysis: parse(v.analysis, null), timeline: parse(v.timeline, null), frames: parse<string[]>(v.frames, []).slice(0, 2), warnings: parse(v.warnings, []) }));
    res.json({ ok: true, profile: { ...p, profile: parse<StyleProfile | null>(p.profile, null) }, videos });
  });

  r.post("/profile/:id/aggregate", requireEditor, async (req, res) => {
    const p = await owned(req, res, req.params.id); if (!p) return;
    try { await aggregateNow(p.id, deps.style); res.json({ ok: true }); }
    catch (e: any) {
      const msg = e?.message || "Tổng hợp lỗi.";
      // Chưa sẵn sàng (đang tổng hợp / còn video đang phân tích) → 409, không phải lỗi hệ thống.
      if (/đang tổng hợp|đang phân tích/.test(msg)) return res.status(409).json({ ok: false, message: msg });
      res.status(500).json({ ok: false, message: msg });
    }
  });

  r.post("/profile/:id/retry-failed", requireEditor, async (req, res) => {
    const p = await owned(req, res, req.params.id); if (!p) return;
    const failed = (await listVideos(p.id)).filter((v) => v.status === "failed");
    for (const v of failed) await updateVideo(v.id, { status: "pending", error: null });
    if (failed.length) await updateProfile(p.id, { status: "running", message: null });
    res.json({ ok: true, requeued: failed.length });
  });

  r.get("/profile/:id/skill.zip", authQuery, async (req, res) => {
    const p = await owned(req, res, req.params.id); if (!p) return;
    const profile = parse<StyleProfile | null>(p.profile, null);
    if (!profile || !p.skill_md) return res.status(409).json({ ok: false, message: "Profile chưa tổng hợp xong." });
    const { name, buffer } = buildSkillZip(profile, p.skill_md);
    res.setHeader("Content-Type", "application/zip"); res.setHeader("Content-Disposition", `attachment; filename="${name}"`); res.send(buffer);
  });

  r.delete("/profile/:id", requireEditor, async (req, res) => { const p = await owned(req, res, req.params.id); if (!p) return; await deleteProfile(p.id); res.json({ ok: true }); });
  return r;
}
