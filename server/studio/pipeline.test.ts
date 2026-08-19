import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { initStudioTables } from "./db.js";
import { createProject, addAsset, replaceShots, listShots, getProject, getRender, updateShot } from "./store.js";
import { ensureProjectDirs } from "./config.js";
import { fakeImageEngine } from "./engines/fake.js";
import { makeEngines, requestKeyframes, runShotImage, setApproved, requestClips, runShotClip, requestAssemble, runAssemble, recoverInterrupted } from "./pipeline.js";

before(async () => { await initStudioTables(); });

async function seed() {
  const p = await createProject({ owner: "a@x", name: "Gà rán", industry: "food", ratio: "9:16", clipLen: 4, tier: "draft", scriptSource: "manual" });
  const root = ensureProjectDirs(p.id);
  const prod = path.join(root, "assets", "prod.png");
  await fakeImageEngine().generate({ prompt: "", refs: [], aspectRatio: "9:16", size: "1K", outPath: prod });
  await addAsset(p.id, "product", prod, "image/png");
  await replaceShots(p.id, [
    { purpose: "hook", camera: "close", dialog: "Mở hộp ra thơm nức", image_prompt: "a", motion_prompt: "b", motion_level: "low" },
    { purpose: "cta", camera: "medium", dialog: "Đặt ngay giỏ hàng", image_prompt: "c", motion_prompt: "d", motion_level: "medium" },
  ]);
  return p;
}

test("trọn pipeline với engine giả: ảnh → duyệt → clip → ghép", { timeout: 120_000 }, async () => {
  const engines = makeEngines("");
  const p = await seed();
  assert.equal(await requestKeyframes(p.id), 2);
  for (const s of await listShots(p.id)) { const r = await runShotImage(s, engines); assert.ok(r.ok); }
  let shots = await listShots(p.id);
  assert.ok(shots.every((s) => s.image_status === "done" && s.image_path && fs.existsSync(s.image_path)));
  assert.equal((await getProject(p.id))!.stage, "review");

  // Chưa duyệt → không được render.
  assert.equal((await requestClips(p.id, "draft")).ok, false);
  await setApproved(shots[0].id, 1); await setApproved(shots[1].id, 1);
  const rc = await requestClips(p.id, "draft");
  assert.ok(rc.ok);
  for (const s of await listShots(p.id)) { const r = await runShotClip(s, engines); assert.ok(r.ok, JSON.stringify(r)); }
  shots = await listShots(p.id);
  assert.ok(shots.every((s) => s.clip_status === "done" && s.clip_path && fs.existsSync(s.clip_path)));

  const ra = await requestAssemble(p.id, { voice: "fake", voiceRate: 1, music: null, transition: "fade" });
  assert.ok(ra.ok);
  const out = await runAssemble((await getProject(p.id))!, engines);
  assert.ok(out.ok, JSON.stringify(out));
  const render = await getRender(p.id);
  assert.ok(render && fs.statSync(render.mp4_path).size > 1000);
  assert.ok(render!.cover_path && fs.existsSync(render!.cover_path));
  assert.equal((await getProject(p.id))!.stage, "done");
});

test("requestClips từ chối khi thoại vượt ngân sách âm tiết", async () => {
  const p = await seed();
  const [s] = await listShots(p.id);
  await updateShot(s.id, { image_status: "done", image_path: "/tmp/x.png", approved: 1, dialog: Array(40).fill("a").join(" ") }); // 40 > 4.5*4=18
  const r = await requestClips(p.id, "draft");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /Cảnh 1/);
});

test("recoverInterrupted: shot đang processing có file → done, không có file → pending; clip đã xong KHÔNG đụng", async () => {
  const p = await seed();
  const [s0, s1] = await listShots(p.id);
  const root = ensureProjectDirs(p.id);
  const done = path.join(root, "clips", "ok.mp4"); fs.writeFileSync(done, "x");
  await updateShot(s0.id, { clip_status: "processing", clip_path: done, approved: 1 });
  await updateShot(s1.id, { image_status: "processing", image_path: null });
  const before = fs.statSync(done).mtimeMs;
  await recoverInterrupted();
  const [a, b] = await listShots(p.id);
  assert.equal(a.clip_status, "done");
  assert.equal(fs.statSync(done).mtimeMs, before);
  assert.equal(b.image_status, "pending");
});
