/**
 * server/studio/queue.ts — hàng đợi RIÊNG của Xưởng (không dùng chung queue.ts của mổ xẻ).
 * Cùng khuôn: poll 3s, claim bằng UPDATE … WHERE status='pending' (nguyên tử), giới hạn song song.
 * Khác: ngân sách ngày, trần đĩa, retry_after, tạm dừng cả hàng đợi khi lỗi billing.
 */
import fs from "node:fs";
import { STUDIO } from "./config.js";
import { getShot, getProject, runQueryChanges, todaySpendUsd, totalDiskBytes, type Shot, type Project } from "./store.js";
import { allQuery } from "../db.js";
import { runShotImage, runShotClip, runAssemble, recoverInterrupted } from "./pipeline.js";
import type { Engines } from "./engines/types.js";

let active = 0, ffActive = 0, claiming = false, pausedUntil = 0, pauseReason = "";
let timer: ReturnType<typeof setInterval> | null = null;

export const queueStatus = () => ({ active, ffActive, pausedUntil, pauseReason, concurrency: STUDIO.concurrency, ffmpegConcurrency: STUDIO.ffmpegConcurrency });
export function pauseQueue(ms: number, reason: string) { pausedUntil = Date.now() + ms; pauseReason = reason; console.warn(`[xuong] Tạm dừng hàng đợi ${Math.round(ms / 60000)} phút: ${reason}`); }
export function stopStudioQueue() { if (timer) clearInterval(timer); timer = null; }

async function guardsOk(): Promise<boolean> {
  if (Date.now() < pausedUntil) return false;
  const spend = await todaySpendUsd();
  if (STUDIO.dailyBudgetUsd > 0 && spend >= STUDIO.dailyBudgetUsd) { pauseQueue(10 * 60_000, `đã tiêu $${spend.toFixed(2)} ≥ trần ngày $${STUDIO.dailyBudgetUsd}`); return false; }
  const bytes = await totalDiskBytes();
  if (STUDIO.maxDiskGb > 0 && bytes >= STUDIO.maxDiskGb * 1e9) { pauseQueue(10 * 60_000, `đĩa Xưởng ${(bytes / 1e9).toFixed(1)}GB ≥ trần ${STUDIO.maxDiskGb}GB`); return false; }
  try { const st = fs.statfsSync(STUDIO.dataDir); if (st.bavail * st.bsize < 1e9) { pauseQueue(10 * 60_000, "ổ đĩa còn < 1GB"); return false; } } catch { /* thư mục chưa có → bỏ qua */ }
  return true;
}

const NOW = () => new Date().toISOString();

type Claimed = { shot: Shot; field: "image" | "clip" };
async function claimShot(field: "image" | "clip"): Promise<Claimed | null> {
  const extra = field === "clip" ? " AND approved = 1" : "";
  const row = await allQuery<Shot>(`SELECT * FROM studio_shots WHERE ${field}_status = 'pending'${extra} AND (retry_after IS NULL OR retry_after <= ?) ORDER BY updated ASC LIMIT 1`, [NOW()]);
  if (!row.length) return null;
  const n = await runQueryChanges(`UPDATE studio_shots SET ${field}_status = 'processing', updated = ? WHERE id = ? AND ${field}_status = 'pending'`, [NOW(), row[0].id]);
  if (n !== 1) return null;
  const shot = await getShot(row[0].id);
  return shot ? { shot, field } : null;
}
async function claimAssemble(): Promise<Project | null> {
  const row = await allQuery<Project>("SELECT * FROM studio_projects WHERE assemble_status = 'pending' ORDER BY updated ASC LIMIT 1");
  if (!row.length) return null;
  const n = await runQueryChanges("UPDATE studio_projects SET assemble_status = 'processing', updated = ? WHERE id = ? AND assemble_status = 'pending'", [NOW(), row[0].id]);
  return n === 1 ? (await getProject(row[0].id)) || null : null;
}

function track(p: Promise<{ ok: boolean; kind?: string }>, ff: boolean) {
  active++; if (ff) ffActive++;
  p.then((r) => { if (r?.kind === "billing") pauseQueue(30 * 60_000, "lỗi thanh toán/key"); })
   .catch((e) => console.error("[xuong] lỗi job:", e))
   .finally(() => { active--; if (ff) ffActive--; });
}

export function startStudioQueue(engines: Engines, opts: { intervalMs?: number } = {}) {
  stopStudioQueue();
  console.log(`[xuong] Hàng đợi Xưởng: ${STUDIO.concurrency} model song song, ${STUDIO.ffmpegConcurrency} ffmpeg, trần $${STUDIO.dailyBudgetUsd}/ngày.`);
  timer = setInterval(async () => {
    if (claiming) return;
    claiming = true;
    try {
      if (!(await guardsOk())) return;
      // Ghép trước (rẻ, giải phóng dự án chờ), rồi ảnh, rồi clip.
      while (ffActive < STUDIO.ffmpegConcurrency && active < STUDIO.concurrency) {
        const p = await claimAssemble(); if (!p) break; track(runAssemble(p, engines), true);
      }
      while (active < STUDIO.concurrency) {
        const c = (await claimShot("image")) || (await claimShot("clip"));
        if (!c) break;
        track(c.field === "image" ? runShotImage(c.shot, engines) : runShotClip(c.shot, engines), false);
      }
    } catch (e) { console.error("[xuong] vòng lặp hàng đợi:", e); }
    finally { claiming = false; }
  }, opts.intervalMs ?? 3000);
}

/** Gọi lúc khởi động server: phục hồi rồi chạy hàng đợi. */
export async function bootStudioQueue(engines: Engines) {
  await recoverInterrupted();
  startStudioQueue(engines);
}
