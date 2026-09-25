import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectDB } from "../db.js";
import { runFfmpeg } from "../studio/ffmpeg.js";
import { initStyleTables } from "./db.js";
import { createProfile, listVideos, getProfile, claimVideo, updateVideo } from "./store.js";
import { runStyleVideo, finalizeProfileIfDone, aggregateNow, recoverStyleInterrupted, type StyleDeps } from "./pipeline.js";
import { fakeStyleEngine } from "./analyze.js";
import { measureVideo } from "./measure.js";
import { STYLE } from "./config.js";

let sample = "";
before(async () => {
  process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); await initStyleTables();
  sample = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sp-")), "s.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=90x160:d=2:r=24", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", sample], { nice: false });
});
const deps = (): StyleDeps => ({ engine: fakeStyleEngine(), measure: measureVideo, download: async (_l, _p, dir) => { const d = path.join(dir, `dl_${Math.random().toString(36).slice(2)}.mp4`); fs.copyFileSync(sample, d); return { path: d }; } });
const vids = (n: number) => Array.from({ length: n }, (_, i) => ({ awemeId: `a${i}`, link: `https://www.tiktok.com/@x/video/a${i}`, title: `t${i}`, cover: "", views: 100 - i, likes: 1, createTime: Math.floor(Date.now() / 1000) - 86400, isExemplar: i < 2 }));

test("runStyleVideo: đo + phân tích + timeline cho mẫu chuẩn, xoá file tạm, đủ video → finalize done", { timeout: 120_000 }, async () => {
  (STYLE as any).minVideos = 2;
  const p = await createProfile({ owner: "k@nerman.asia", platform: "tiktok", handle: "x", nickname: "X", avatar: "", videos: vids(3), exemplarIds: ["a0", "a1"] });
  const d = deps();
  for (let i = 0; i < 3; i++) { const v = await claimVideo(); assert.ok(v, `claim lần ${i}`); const r = await runStyleVideo(v!, d); assert.ok(r.ok, `video ${i} lỗi`); }
  const rows = await listVideos(p.id);
  assert.equal(rows.filter((r) => r.status === "done").length, 3);
  const ex = rows.find((r) => r.is_exemplar === 1)!; assert.ok(ex.timeline && JSON.parse(ex.timeline).length >= 1, "mẫu chuẩn phải có timeline");
  const other = rows.find((r) => r.is_exemplar === 0)!; assert.equal(other.timeline, null);
  assert.ok(JSON.parse(rows[0].measure!).duration > 1.5, "measure phải có duration");
  assert.ok(JSON.parse(rows[0].analysis!).text.captionStyle === "sentence", "analysis từ fake engine");
  assert.equal(fs.readdirSync(STYLE.tmpDir).filter((f) => f.startsWith("dl_")).length, 0, "file tạm phải bị xoá");
  const prof = (await getProfile(p.id))!;
  assert.equal(prof.status, "done", prof.message || "");
  const profile = JSON.parse(prof.profile!);
  assert.equal(profile.videos.used, 3); assert.equal(profile.exemplars.length, 2);
  assert.ok(profile.formulas.opening[0].count >= 1 && typeof profile.formulas.opening[0].text === "string", "formulas phải qua cluster");
  assert.ok(prof.skill_md!.startsWith("---\nname: style-x"), prof.skill_md!.slice(0, 40));
});

test("tái dùng phiếu: link đã done ở profile khác cùng owner → không tải, không gọi engine", async () => {
  const p2 = await createProfile({ owner: "k@nerman.asia", platform: "tiktok", handle: "x", nickname: "X", avatar: "", videos: vids(1), exemplarIds: [] });
  let downloads = 0; const d = deps(); const dl = d.download; d.download = (...a) => { downloads++; return dl(...a); };
  const v = (await claimVideo())!; assert.equal(v.profile_id, p2.id);
  const r = await runStyleVideo(v, d); assert.ok(r.ok, "phải ok");
  assert.equal(downloads, 0);
  assert.equal((await listVideos(p2.id))[0].status, "done");
});

test("video lỗi tải → failed + error; dưới ngưỡng minVideos → profile failed có message", { timeout: 60_000 }, async () => {
  (STYLE as any).minVideos = 15;
  const p = await createProfile({ owner: "b@nerman.asia", platform: "tiktok", handle: "y", nickname: "Y", avatar: "", videos: [{ ...vids(1)[0], awemeId: "zz", link: "https://www.tiktok.com/@y/video/zz" }], exemplarIds: [] });
  const d = deps(); d.download = async () => { throw new Error("Video riêng tư"); };
  const v = (await claimVideo())!; const r = await runStyleVideo(v, d); assert.equal(r.ok, false);
  const row = (await listVideos(p.id))[0]; assert.equal(row.status, "failed"); assert.match(row.error || "", /riêng tư/);
  const prof = (await getProfile(p.id))!; assert.equal(prof.status, "failed"); assert.match(prof.message || "", /0\/1/);
});

test("recoverStyleInterrupted đưa processing → pending", async () => {
  const p = await createProfile({ owner: "c@nerman.asia", platform: "tiktok", handle: "z", nickname: "Z", avatar: "", videos: vids(1), exemplarIds: [] });
  const v = (await listVideos(p.id))[0]; await updateVideo(v.id, { status: "processing" });
  await recoverStyleInterrupted();
  assert.equal((await listVideos(p.id))[0].status, "pending");
});

test("aggregateNow chạy lại trên phiếu có sẵn, không đụng video", { timeout: 60_000 }, async () => {
  (STYLE as any).minVideos = 1;
  const p = await createProfile({ owner: "d@nerman.asia", platform: "tiktok", handle: "w", nickname: "W", avatar: "", videos: vids(1), exemplarIds: ["a0"] });
  const d = deps(); await runStyleVideo((await claimVideo())!, d);
  const before = (await getProfile(p.id))!.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  await aggregateNow(p.id, d);
  const after = (await getProfile(p.id))!; assert.equal(after.status, "done"); assert.notEqual(after.updated_at, before);
});
