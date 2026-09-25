/**
 * server/style/queue.ts — hàng đợi RIÊNG của Style kênh (khuôn studio/queue.ts): poll 3 s, claim nguyên tử, giới hạn song song,
 * tạm dừng 30 phút khi lỗi key/billing. Không dùng queue.ts của mổ xẻ (bảng khác).
 */
import { STYLE } from "./config.js";
import { claimVideo } from "./store.js";
import { runStyleVideo, recoverStyleInterrupted, type StyleDeps } from "./pipeline.js";

let active = 0, claiming = false, pausedUntil = 0, pauseReason = "";
let timer: ReturnType<typeof setInterval> | null = null;

export const styleQueueStatus = () => ({ active, pausedUntil, pauseReason, concurrency: STYLE.concurrency });
export function pauseStyleQueue(ms: number, reason: string) { pausedUntil = Date.now() + ms; pauseReason = reason; console.warn(`[style] Tạm dừng hàng đợi ${Math.round(ms / 60000)} phút: ${reason}`); }
export function stopStyleQueue() { if (timer) clearInterval(timer); timer = null; }

export function startStyleQueue(deps: StyleDeps, opts: { intervalMs?: number } = {}) {
  stopStyleQueue();
  console.log(`[style] Hàng đợi Style kênh: ${STYLE.concurrency} video song song, engine ${deps.engine.name}, model ${STYLE.model}.`);
  timer = setInterval(async () => {
    if (claiming || Date.now() < pausedUntil) return;
    claiming = true;
    try {
      while (active < STYLE.concurrency) {
        const v = await claimVideo(); if (!v) break;
        active++;
        runStyleVideo(v, deps)
          .then((r) => { if (r.kind === "billing") pauseStyleQueue(30 * 60_000, "lỗi key/quota Gemini"); })
          .catch((e) => console.error("[style] lỗi job:", e))
          .finally(() => { active--; });
      }
    } catch (e) { console.error("[style] vòng lặp hàng đợi:", e); }
    finally { claiming = false; }
  }, opts.intervalMs ?? 3000);
}
/** Gọi lúc khởi động server. */
export async function bootStyleQueue(deps: StyleDeps) { await recoverStyleInterrupted(); startStyleQueue(deps); }
