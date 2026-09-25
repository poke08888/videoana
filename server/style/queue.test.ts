import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connectDB } from "../db.js";
import { initStyleTables } from "./db.js";
import { createProfile, listVideos } from "./store.js";
import { startStyleQueue, stopStyleQueue, styleQueueStatus } from "./queue.js";
import type { StyleDeps } from "./pipeline.js";
import { fakeStyleEngine } from "./analyze.js";
import { STYLE } from "./config.js";

before(async () => { process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); await initStyleTables(); });
const ORIG = { minVideos: STYLE.minVideos, concurrency: STYLE.concurrency };
after(() => { stopStyleQueue(); (STYLE as any).minVideos = ORIG.minVideos; (STYLE as any).concurrency = ORIG.concurrency; });

test("hàng đợi nhận việc pending, chạy song song ≤ concurrency, xong hết → profile done", { timeout: 30_000 }, async () => {
  (STYLE as any).minVideos = 1; (STYLE as any).concurrency = 2;
  let peak = 0, running = 0;
  const deps: StyleDeps = { engine: fakeStyleEngine(), measure: async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 300)); running--; return { duration: 5, width: 90, height: 160, aspect: "9:16", fps: 24, cuts: [2], cutsPerMin: 12, medianShotLen: 2.5, shotLenP10: 2, shotLenP90: 3, cutsIn3s: 1, loudness: { integratedLufs: -14, first3sLufs: -13 }, silenceStart: null, color: null, loopLikely: false, frames: [] }; }, download: async () => ({ path: "/dev/null" }) };
  const vids = Array.from({ length: 5 }, (_, i) => ({ awemeId: `q${i}`, link: `https://www.tiktok.com/@q/video/q${i}`, title: "", cover: "", views: 10 - i, likes: 0, createTime: 1, isExemplar: false }));
  const p = await createProfile({ owner: "q@nerman.asia", platform: "tiktok", handle: "q", nickname: "Q", avatar: "", videos: vids, exemplarIds: [] });
  startStyleQueue(deps, { intervalMs: 50 });
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000) { const rows = await listVideos(p.id); if (rows.every((r) => r.status === "done")) break; await new Promise((r) => setTimeout(r, 100)); }
  stopStyleQueue();
  assert.equal((await listVideos(p.id)).filter((r) => r.status === "done").length, 5);
  assert.ok(peak <= 2, `peak=${peak}`); assert.ok(peak >= 2, "phải chạy song song");
  assert.equal(styleQueueStatus().concurrency, 2);
});
