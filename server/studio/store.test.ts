import { test, before } from "node:test";
import assert from "node:assert/strict";
import { initStudioTables } from "./db.js";
import { createProject, getProject, listProjects, updateProject, replaceShots, listShots, updateShot, recordCost, todaySpendUsd, addDiskBytes, totalDiskBytes, saveRender, getRender, runQueryChanges } from "./store.js";

before(async () => { await initStudioTables(); });

test("tạo/đọc/sửa project và cách ly theo owner", async () => {
  const p = await createProject({ owner: "a@x", name: "Gà rán", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "ai" });
  assert.match(p.id, /^p[a-z0-9]{8}$/);
  assert.equal((await getProject(p.id))?.stage, "script");
  await updateProject(p.id, { stage: "keyframe", caption: "Ngon" });
  assert.equal((await getProject(p.id))?.stage, "keyframe");
  assert.equal((await listProjects("a@x")).length, 1);
  assert.equal((await listProjects("b@x")).length, 0);
  assert.equal((await listProjects(null)).length, 1);
});

test("updateProject bỏ qua cột lạ (không SQL injection qua tên cột)", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  await updateProject(p.id, { "stage; DROP TABLE studio_projects": "x", stage: "review" } as any);
  assert.equal((await getProject(p.id))?.stage, "review");
});

test("replaceShots thay trọn bộ theo idx; updateShot sửa lẻ", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  const shots = await replaceShots(p.id, [
    { purpose: "hook", camera: "close", dialog: "Mở hộp", image_prompt: "a", motion_prompt: "b", motion_level: "low" },
    { purpose: "product", camera: "medium", dialog: "Giòn", image_prompt: "c", motion_prompt: "d", motion_level: "medium" },
  ]);
  assert.equal(shots.length, 2);
  assert.deepEqual(shots.map((s) => s.idx), [0, 1]);
  await updateShot(shots[1].id, { approved: 1, image_status: "done", image_path: "/tmp/x.png" });
  const again = await listShots(p.id);
  assert.equal(again[1].approved, 1);
  const only = await replaceShots(p.id, [{ purpose: "cta", camera: "wide", dialog: "Mua", image_prompt: "e", motion_prompt: "f", motion_level: "high" }]);
  assert.equal((await listShots(p.id)).length, 1);
  assert.equal(only[0].purpose, "cta");
});

test("recordCost ghi sổ cái + cộng dồn shot và project; todaySpendUsd gộp đúng", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  const [s] = await replaceShots(p.id, [{ purpose: "hook", camera: "close", dialog: "", image_prompt: "a", motion_prompt: "b", motion_level: "low" }]);
  const before = await todaySpendUsd();
  await recordCost({ projectId: p.id, shotId: s.id, kind: "image", model: "fake", usd: 0.134 });
  await recordCost({ projectId: p.id, shotId: s.id, kind: "video", model: "fake", usd: 0.4 });
  assert.equal((await getProject(p.id))?.cost_usd, 0.534);
  assert.equal((await listShots(p.id))[0].cost_usd, 0.534);
  assert.equal(Math.round(((await todaySpendUsd()) - before) * 1000), 534);
});

test("addDiskBytes / totalDiskBytes", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  const t0 = await totalDiskBytes();
  await addDiskBytes(p.id, 1000);
  await addDiskBytes(p.id, 500);
  assert.equal((await getProject(p.id))?.disk_bytes, 1500);
  assert.equal((await totalDiskBytes()) - t0, 1500);
});

test("saveRender/getRender", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  await saveRender({ project_id: p.id, mp4_path: "/r/a.mp4", cover_path: "/r/c.jpg", srt_path: "/r/s.srt", caption: "cap", hashtags: "#a #b", voice: "v", music: null, duration: 23.5, cost_usd: 0 });
  assert.equal((await getRender(p.id))?.duration, 23.5);
});

test("runQueryChanges trả số dòng ảnh hưởng (dùng để claim job)", async () => {
  const p = await createProject({ owner: "a@x", name: "X", industry: "food", ratio: "9:16", clipLen: 8, tier: "draft", scriptSource: "manual" });
  const [s] = await replaceShots(p.id, [{ purpose: "hook", camera: "close", dialog: "", image_prompt: "a", motion_prompt: "b", motion_level: "low" }]);
  await updateShot(s.id, { image_status: "pending" });
  assert.equal(await runQueryChanges("UPDATE studio_shots SET image_status='processing' WHERE id=? AND image_status='pending'", [s.id]), 1);
  assert.equal(await runQueryChanges("UPDATE studio_shots SET image_status='processing' WHERE id=? AND image_status='pending'", [s.id]), 0);
});
