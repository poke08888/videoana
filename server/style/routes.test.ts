import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { connectDB, runQuery } from "../db.js";
import { signToken } from "../auth.js";
import { initStyleTables } from "./db.js";
import { makeStyleRouter } from "./routes.js";
import { fakeStyleEngine } from "./analyze.js";
import { listVideos, updateVideo } from "./store.js";
import { STYLE } from "./config.js";
import type { StyleDeps } from "./pipeline.js";

let base = "", server: any, admin = "", editor = "", guest = "";
const NOW = Math.floor(Date.now() / 1000);
const vids = Array.from({ length: 40 }, (_, i) => ({ awemeId: `r${i}`, desc: `d${i}`, author: "h", nickname: "H", link: `https://www.tiktok.com/@h/video/r${i}`, createTime: NOW - (i + 1) * 86400, stats: { source: "TikTok" as const, views: 5000 - i * 10, likes: 1, comments: 0, shares: 0, saves: 0 } }));
before(async () => {
  process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); await initStyleTables();
  await runQuery("INSERT OR IGNORE INTO users (email,password,salt,name,role,count,active,perms) VALUES ('e@nerman.asia','x','y','E','Biên tập',0,1,'{}')");
  await runQuery("INSERT OR IGNORE INTO users (email,password,salt,name,role,count,active,perms) VALUES ('g@nerman.asia','x','y','G','Khách',0,1,'{}')");
  admin = signToken({ email: "k@nerman.asia", role: "Quản trị" }); editor = signToken({ email: "e@nerman.asia", role: "Biên tập" }); guest = signToken({ email: "g@nerman.asia", role: "Khách" });
  const style: StyleDeps = { engine: fakeStyleEngine(), measure: async () => ({ duration: 5, width: 90, height: 160, aspect: "9:16", fps: 24, cuts: [], cutsPerMin: 0, medianShotLen: 5, shotLenP10: 5, shotLenP90: 5, cutsIn3s: 0, loudness: { integratedLufs: null, first3sLufs: null }, silenceStart: null, color: null, loopLikely: null, frames: [] }), download: async () => ({ path: "/dev/null" }) };
  const app = express(); app.use(express.json());
  app.use("/api/style", makeStyleRouter({ style, resolveAccount: async () => ({ platform: "tiktok", secId: "s", handle: "h", nickname: "H", avatar: "" }), fetchAccountVideos: async () => vids, rapidKey: () => "k" }));
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());
const H = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const j = (r: Response) => r.json() as Promise<any>;

test("Khách bị 403; Biên tập được", async () => {
  assert.equal((await fetch(`${base}/api/style/profiles`, { headers: H(guest) })).status, 403);
  assert.equal((await fetch(`${base}/api/style/profiles`, { headers: H(editor) })).status, 200);
});
test("pick → 30 video + 5 mẫu chuẩn; link sai → 400", async () => {
  const r = await j(await fetch(`${base}/api/style/pick`, { method: "POST", headers: H(editor), body: JSON.stringify({ url: "https://www.tiktok.com/@h" }) }));
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.videos.length, 30); assert.equal(r.exemplarIds.length, 5); assert.equal(r.account.handle, "h"); assert.equal(r.windowDays, 90);
  assert.equal((await fetch(`${base}/api/style/pick`, { method: "POST", headers: H(editor), body: JSON.stringify({ url: "!!!" }) })).status, 400);
});
test("create → profile running + videos pending; owner-scoping; aggregate; retry-failed; zip; delete", { timeout: 30_000 }, async () => {
  (STYLE as any).minVideos = 1;
  const pick = await j(await fetch(`${base}/api/style/pick`, { method: "POST", headers: H(editor), body: JSON.stringify({ url: "https://www.tiktok.com/@h", count: 3, exemplars: 1 }) }));
  const c = await j(await fetch(`${base}/api/style/create`, { method: "POST", headers: H(editor), body: JSON.stringify({ account: pick.account, videos: pick.videos, exemplarIds: pick.exemplarIds }) }));
  assert.ok(c.ok && c.profileId, JSON.stringify(c));
  const g = await j(await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(editor) }));
  assert.equal(g.profile.status, "running"); assert.equal(g.videos.length, 3); assert.equal(g.videos.filter((v: any) => v.status === "pending").length, 3);
  // người khác (không admin) không thấy; admin thấy
  const other = signToken({ email: "e2@nerman.asia", role: "Biên tập" }); await runQuery("INSERT OR IGNORE INTO users (email,password,salt,name,role,count,active,perms) VALUES ('e2@nerman.asia','x','y','E2','Biên tập',0,1,'{}')");
  assert.equal((await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(other) })).status, 404);
  assert.equal((await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(admin) })).status, 200);
  // giả lập worker: 2 done (analysis fake), 1 failed
  const rows = await listVideos(c.profileId); const { fakeStyleEngine: F } = await import("./analyze.js"); const a = await F().analyze({ videoPath: "", mimeType: "", measure: null, meta: { title: "", platform: "TikTok", nickname: "" } });
  for (const r of rows.slice(0, 2)) await updateVideo(r.id, { status: "done", analysis: JSON.stringify(a), measure: null, frames: "[]" });
  await updateVideo(rows[2].id, { status: "failed", error: "x" });
  const ag = await j(await fetch(`${base}/api/style/profile/${c.profileId}/aggregate`, { method: "POST", headers: H(editor) }));
  assert.ok(ag.ok, JSON.stringify(ag));
  const g2 = await j(await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(editor) }));
  assert.equal(g2.profile.status, "done"); assert.equal(g2.profile.profile.videos.used, 2);
  const rt = await j(await fetch(`${base}/api/style/profile/${c.profileId}/retry-failed`, { method: "POST", headers: H(editor) }));
  assert.equal(rt.requeued, 1);
  assert.equal((await listVideos(c.profileId)).filter((r) => r.status === "pending").length, 1);
  const z = await fetch(`${base}/api/style/profile/${c.profileId}/skill.zip?t=${editor}`);
  assert.equal(z.status, 200); assert.match(z.headers.get("content-disposition") || "", /style-h\.zip/); assert.ok((await z.arrayBuffer()).byteLength > 200, "zip phải có nội dung");
  assert.equal((await fetch(`${base}/api/style/profile/${c.profileId}`, { method: "DELETE", headers: H(other) })).status, 404);
  assert.equal((await j(await fetch(`${base}/api/style/profile/${c.profileId}`, { method: "DELETE", headers: H(editor) }))).ok, true);
  assert.equal((await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(editor) })).status, 404);
});

test("aggregate khi còn video pending → 409, không đổi trạng thái", async () => {
  const pick = await j(await fetch(`${base}/api/style/pick`, { method: "POST", headers: H(editor), body: JSON.stringify({ url: "https://www.tiktok.com/@h", count: 2, exemplars: 1 }) }));
  const c = await j(await fetch(`${base}/api/style/create`, { method: "POST", headers: H(editor), body: JSON.stringify({ account: pick.account, videos: pick.videos, exemplarIds: pick.exemplarIds }) }));
  const r = await fetch(`${base}/api/style/profile/${c.profileId}/aggregate`, { method: "POST", headers: H(editor) });
  assert.equal(r.status, 409);
  assert.match((await j(r)).message || "", /đang phân tích/);
  const g = await j(await fetch(`${base}/api/style/profile/${c.profileId}`, { headers: H(editor) }));
  assert.equal(g.profile.status, "running");
  for (const v of await listVideos(c.profileId)) await updateVideo(v.id, { status: "failed", error: "dọn" });
});
