import { test, before, after } from "node:test";
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
const origMinVideos = STYLE.minVideos;
after(() => { (STYLE as any).minVideos = origMinVideos; });
before(async () => {
  process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); await initStyleTables();
  sample = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sp-")), "s.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=90x160:d=2:r=24", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", sample], { nice: false });
});
const deps = (): StyleDeps => ({ engine: fakeStyleEngine(), measure: measureVideo, download: async (_l, _p, dir) => { const d = path.join(dir, `dl_${Math.random().toString(36).slice(2)}.mp4`); fs.copyFileSync(sample, d); return { path: d }; } });
/** Không còn thư mục tạm của các video này. (Không dùng readdir().length === 0 vì queue.test.ts chạy song song cùng STYLE_TMP_DIR.) */
const assertNoTmpDirs = (ids: string[]) => { fs.mkdirSync(STYLE.tmpDir, { recursive: true }); const left = fs.readdirSync(STYLE.tmpDir).filter((f) => ids.includes(f)); assert.equal(left.length, 0, `thư mục tạm từng video phải bị xoá: ${left.join(",")}`); };
const vids = (n: number) => Array.from({ length: n }, (_, i) => ({ awemeId: `a${i}`, link: `https://www.tiktok.com/@x/video/a${i}`, title: `t${i}`, cover: "", views: 100 - i, likes: 1, createTime: Math.floor(Date.now() / 1000) - 86400, isExemplar: i < 2 }));

test("runStyleVideo: đo + phân tích + timeline cho mẫu chuẩn, xoá file tạm, đủ video → finalize done", { timeout: 120_000 }, async () => {
  (STYLE as any).minVideos = 2;
  const p = await createProfile({ owner: "k@nerman.asia", platform: "tiktok", handle: "x", nickname: "X", avatar: "", videos: vids(3), exemplarIds: ["a0", "a1"] });
  const d = deps();
  for (let i = 0; i < 3; i++) { const v = await claimVideo(); assert.ok(v, `claim lần ${i}`); assert.equal(v!.profile_id, p.id, "claim phải lấy video của profile này"); const r = await runStyleVideo(v!, d); assert.ok(r.ok, `video ${i} lỗi`); }
  const rows = await listVideos(p.id);
  assert.equal(rows.filter((r) => r.status === "done").length, 3);
  const ex = rows.find((r) => r.is_exemplar === 1)!; assert.ok(ex.timeline && JSON.parse(ex.timeline).length >= 1, "mẫu chuẩn phải có timeline");
  const other = rows.find((r) => r.is_exemplar === 0)!; assert.equal(other.timeline, null);
  assert.ok(JSON.parse(rows[0].measure!).duration > 1.5, "measure phải có duration");
  assert.ok(JSON.parse(rows[0].analysis!).text.captionStyle === "sentence", "analysis từ fake engine");
  assertNoTmpDirs(rows.map((r) => r.id));
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
  const v = (await claimVideo())!; assert.equal(v.profile_id, p.id, "claim đúng profile"); const r = await runStyleVideo(v, d); assert.equal(r.ok, false);
  const row = (await listVideos(p.id))[0]; assert.equal(row.status, "failed"); assert.match(row.error || "", /riêng tư/);
  const prof = (await getProfile(p.id))!; assert.equal(prof.status, "failed"); assert.match(prof.message || "", /0\/1/);
});

test("recoverStyleInterrupted đưa processing → pending", async () => {
  const p = await createProfile({ owner: "c@nerman.asia", platform: "tiktok", handle: "z", nickname: "Z", avatar: "", videos: vids(1), exemplarIds: [] });
  const v = (await listVideos(p.id))[0]; await updateVideo(v.id, { status: "processing" });
  await recoverStyleInterrupted();
  assert.equal((await listVideos(p.id))[0].status, "pending");
  await updateVideo(v.id, { status: "failed", error: "dọn test" }); // không để pending rơi sang test sau
});

test("aggregateNow chạy lại trên phiếu có sẵn, không đụng video", { timeout: 60_000 }, async () => {
  (STYLE as any).minVideos = 1;
  const p = await createProfile({ owner: "d@nerman.asia", platform: "tiktok", handle: "w", nickname: "W", avatar: "", videos: vids(1), exemplarIds: ["a0"] });
  const d = deps(); const v = (await claimVideo())!; assert.equal(v.profile_id, p.id, "claim đúng profile");
  const r = await runStyleVideo(v, d); assert.ok(r.ok, "runStyleVideo phải ok");
  const before = (await getProfile(p.id))!.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  await aggregateNow(p.id, d);
  const after = (await getProfile(p.id))!; assert.equal(after.status, "done"); assert.notEqual(after.updated_at, before);
});

// ---- Fix review ----
const fakeAnalysis = async (title: string) => JSON.stringify(await fakeStyleEngine().analyze({ videoPath: "", mimeType: "video/mp4", measure: null, meta: { title, platform: "TikTok", nickname: "R" } }));
const uniq = (n: number, tag: string) => vids(n).map((x, i) => ({ ...x, awemeId: `${tag}${i}`, link: `https://www.tiktok.com/@${tag}/video/${i}`, isExemplar: false }));

test("race finalize: 2 lời gọi đồng thời chỉ tổng hợp (narrate) đúng 1 lần", async () => {
  (STYLE as any).minVideos = 1;
  const p = await createProfile({ owner: "race@nerman.asia", platform: "tiktok", handle: "race", nickname: "R", avatar: "", videos: uniq(1, "race"), exemplarIds: [] });
  const v = (await listVideos(p.id))[0]; await updateVideo(v.id, { status: "done", analysis: await fakeAnalysis("r"), frames: "[]" });
  const d = deps(); let narrates = 0; const nar = d.engine.narrate.bind(d.engine);
  d.engine = { ...d.engine, narrate: async (a) => { narrates++; await new Promise((r) => setTimeout(r, 10)); return nar(a); } };
  await Promise.all([finalizeProfileIfDone(p.id, d), finalizeProfileIfDone(p.id, d)]);
  assert.equal(narrates, 1, "chỉ 1 worker được tổng hợp");
  assert.equal((await getProfile(p.id))!.status, "done", "profile phải done");
});

test("phân loại billing: lỗi tải 403 không phải billing; lỗi engine quota là billing", { timeout: 60_000 }, async () => {
  (STYLE as any).minVideos = 1;
  const p = await createProfile({ owner: "bill@nerman.asia", platform: "tiktok", handle: "bill", nickname: "B", avatar: "", videos: uniq(2, "bill"), exemplarIds: [] });
  const d1 = deps(); d1.download = async () => { throw new Error("Tải video TikTok lỗi HTTP 403"); };
  const v1 = (await claimVideo())!; assert.equal(v1.profile_id, p.id, "claim đúng profile");
  const r1 = await runStyleVideo(v1, d1); assert.equal(r1.ok, false); assert.equal(r1.kind, undefined);
  const d2 = deps(); d2.engine = { ...d2.engine, analyze: async () => { throw new Error("RESOURCE_EXHAUSTED quota"); } };
  const v2 = (await claimVideo())!; assert.equal(v2.profile_id, p.id, "claim đúng profile");
  const r2 = await runStyleVideo(v2, d2); assert.equal(r2.ok, false); assert.equal(r2.kind, "billing");
  assertNoTmpDirs([v1.id, v2.id]);
});

test("không kẹt aggregating: cluster+narrate lỗi vẫn done; analysis hỏng JSON bị bỏ qua", async () => {
  (STYLE as any).minVideos = 1;
  const p = await createProfile({ owner: "stuck@nerman.asia", platform: "tiktok", handle: "stuck", nickname: "S", avatar: "", videos: uniq(2, "stuck"), exemplarIds: [] });
  const [a, b] = await listVideos(p.id);
  await updateVideo(a.id, { status: "done", analysis: await fakeAnalysis("ok"), frames: "[]" });
  await updateVideo(b.id, { status: "done", analysis: "{not json" });
  const d = deps(); d.engine = { ...d.engine, cluster: async () => { throw new Error("cluster hỏng"); }, narrate: async () => { throw new Error("narrate hỏng"); } };
  assert.equal(await finalizeProfileIfDone(p.id, d), true, "phải claim được");
  const prof = (await getProfile(p.id))!; assert.equal(prof.status, "done", prof.message || "");
  assert.equal(JSON.parse(prof.profile!).videos.used, 1);
  // Hạ ngưỡng không đạt → failed có message, không kẹt aggregating
  (STYLE as any).minVideos = 5;
  await aggregateNow(p.id, d);
  const p2 = (await getProfile(p.id))!; assert.equal(p2.status, "failed"); assert.match(p2.message || "", /1\/2/);
});

test("aggregateNow khi đang aggregating → báo lỗi rõ", async () => {
  const p = await createProfile({ owner: "agg@nerman.asia", platform: "tiktok", handle: "agg", nickname: "A", avatar: "", videos: uniq(1, "agg"), exemplarIds: [] });
  const v = (await listVideos(p.id))[0]; await updateVideo(v.id, { status: "failed", error: "x" });
  const { updateProfile } = await import("./store.js"); await updateProfile(p.id, { status: "aggregating" });
  await assert.rejects(aggregateNow(p.id, deps()), /đang tổng hợp/);
  await updateProfile(p.id, { status: "failed" });
});

test("recoverStyleInterrupted(deps): profile running mà mọi video done → finalize thành done", async () => {
  (STYLE as any).minVideos = 1;
  const p = await createProfile({ owner: "rec@nerman.asia", platform: "tiktok", handle: "rec", nickname: "R", avatar: "", videos: uniq(1, "rec"), exemplarIds: [] });
  const v = (await listVideos(p.id))[0]; await updateVideo(v.id, { status: "done", analysis: await fakeAnalysis("rec"), frames: "[]" });
  assert.equal((await getProfile(p.id))!.status, "running");
  await recoverStyleInterrupted(deps());
  assert.equal((await getProfile(p.id))!.status, "done");
});
