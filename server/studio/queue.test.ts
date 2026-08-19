import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { initStudioTables } from "./db.js";
import { createProject, addAsset, replaceShots, listShots, recordCost } from "./store.js";
import { ensureProjectDirs, STUDIO } from "./config.js";
import { fakeImageEngine } from "./engines/fake.js";
import { makeEngines, requestKeyframes } from "./pipeline.js";
import { startStudioQueue, stopStudioQueue, queueStatus } from "./queue.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function seed(n = 2) {
  const p = await createProject({ owner: "a@x", name: "Q", industry: "food", ratio: "9:16", clipLen: 4, tier: "draft", scriptSource: "manual" });
  const prod = path.join(ensureProjectDirs(p.id), "assets", "p.png");
  await fakeImageEngine().generate({ prompt: "", refs: [], aspectRatio: "9:16", size: "1K", outPath: prod });
  await addAsset(p.id, "product", prod, "image/png");
  await replaceShots(p.id, Array.from({ length: n }, (_, i) => ({ purpose: "product", camera: "medium", dialog: `cảnh ${i}`, image_prompt: "a", motion_prompt: "b", motion_level: "medium" as const })));
  return p;
}
before(async () => { await initStudioTables(); });
after(() => stopStudioQueue());

test("hàng đợi tự nhặt shot pending và chạy xong ảnh", { timeout: 60_000 }, async () => {
  const p = await seed(2);
  await requestKeyframes(p.id);
  startStudioQueue(makeEngines(""), { intervalMs: 200 });
  for (let i = 0; i < 100; i++) { const s = await listShots(p.id); if (s.every((x) => x.image_status === "done")) break; await sleep(300); }
  stopStudioQueue();
  const shots = await listShots(p.id);
  assert.ok(shots.every((s) => s.image_status === "done" && fs.existsSync(s.image_path!)));
});

test("vượt ngân sách ngày → không nhặt việc", { timeout: 20_000 }, async () => {
  const p = await seed(1);
  await requestKeyframes(p.id);
  const saved = STUDIO.dailyBudgetUsd;
  STUDIO.dailyBudgetUsd = 0.5;
  await recordCost({ projectId: p.id, kind: "image", model: "fake", usd: 1 });
  startStudioQueue(makeEngines(""), { intervalMs: 100 });
  await sleep(1500);
  stopStudioQueue();
  STUDIO.dailyBudgetUsd = saved;
  assert.equal((await listShots(p.id))[0].image_status, "pending");
  assert.ok(queueStatus().pausedUntil > Date.now());
});
