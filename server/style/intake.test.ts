import { test, before } from "node:test";
import assert from "node:assert/strict";
import { connectDB, allQuery } from "../db.js";
import { initStyleTables } from "./db.js";
import { getProfile, listVideos, createProfileShell, listProfiles } from "./store.js";
import { startProfileFromUrl, runIntake, type PickDeps } from "./intake.js";
import { recoverStyleInterrupted } from "./pipeline.js";
import { STYLE } from "./config.js";

const NOW = Math.floor(Date.now() / 1000);
const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ awemeId: `i${i}`, desc: `d${i}`, author: "h", nickname: "H", link: `https://www.tiktok.com/@h/video/i${i}`, createTime: NOW - (i + 1) * 86400, stats: { source: "TikTok" as const, views: 9000 - i * 10, likes: 1, comments: 0, shares: 0, saves: 0 } }));
const deps = (over: Partial<PickDeps> = {}): PickDeps => ({ resolveAccount: async () => ({ platform: "tiktok", secId: "s", handle: "h", nickname: "Kênh H", avatar: "a.jpg" }), fetchAccountVideos: async () => mk(40), rapidKey: () => "k", ...over });
before(async () => { process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); await initStyleTables(); });

test("URL sai → ném lỗi, không tạo profile", async () => {
  const before = (await allQuery<{ n: number }>("SELECT COUNT(*) AS n FROM style_profiles"))[0].n;
  await assert.rejects(() => startProfileFromUrl({ owner: "k@nerman.asia", url: "!!!", deps: deps() }), /không hợp lệ/);
  const after = (await allQuery<{ n: number }>("SELECT COUNT(*) AS n FROM style_profiles"))[0].n;
  assert.equal(after, before, "URL sai không được tạo profile");
});

test("runIntake: 40 video → running, 30 video, 5 mẫu chuẩn, nickname từ account", async () => {
  const p = await createProfileShell({ owner: "k@nerman.asia", platform: "tiktok", handle: "h", sourceUrl: "https://www.tiktok.com/@h" });
  assert.equal(p.status, "picking"); assert.equal(p.source_url, "https://www.tiktok.com/@h");
  await runIntake(p.id, { url: "https://www.tiktok.com/@h", platform: "tiktok", deps: deps() });
  const g = (await getProfile(p.id))!;
  assert.equal(g.status, "running", g.message || "");
  assert.equal(g.nickname, "Kênh H"); assert.equal(g.avatar, "a.jpg");
  const rows = await listVideos(p.id);
  assert.equal(rows.length, STYLE.pickCount);
  assert.equal(rows.filter((r) => r.is_exemplar === 1).length, STYLE.exemplarCount);
  assert.equal(JSON.parse(g.exemplar_ids).length, STYLE.exemplarCount);
  assert.equal(JSON.parse(g.picked_ids).length, STYLE.pickCount);
  const listed = (await listProfiles(null)).find((x) => x.id === p.id);
  assert.equal(listed?.source_url, "https://www.tiktok.com/@h", "listProfiles phải trả source_url");
  for (const r of rows) await allQuery("UPDATE style_videos SET status = 'failed' WHERE id = ?", [r.id]);
});

test("runIntake: chỉ 3 video → failed nêu ngưỡng", async () => {
  const p = await createProfileShell({ owner: "k@nerman.asia", platform: "tiktok", handle: "h", sourceUrl: "h" });
  await runIntake(p.id, { url: "h", platform: "tiktok", deps: deps({ fetchAccountVideos: async () => mk(3) }) });
  const g = (await getProfile(p.id))!;
  assert.equal(g.status, "failed"); assert.match(g.message || "", /cần ≥/);
  assert.equal((await listVideos(p.id)).length, 0, "không chèn video khi thiếu");
});

test("runIntake: resolve ném lỗi → failed kèm nội dung lỗi; thiếu key → failed", async () => {
  const p = await createProfileShell({ owner: "k@nerman.asia", platform: "tiktok", handle: "h", sourceUrl: "h" });
  await runIntake(p.id, { url: "h", platform: "tiktok", deps: deps({ resolveAccount: async () => { throw new Error("Kênh riêng tư XYZ"); } }) });
  const g = (await getProfile(p.id))!;
  assert.equal(g.status, "failed"); assert.match(g.message || "", /Kênh riêng tư XYZ/);
  const p2 = await createProfileShell({ owner: "k@nerman.asia", platform: "tiktok", handle: "h", sourceUrl: "h" });
  await runIntake(p2.id, { url: "h", platform: "tiktok", deps: deps({ rapidKey: () => null }) });
  const g2 = (await getProfile(p2.id))!;
  assert.equal(g2.status, "failed"); assert.match(g2.message || "", /RapidAPI/);
  const p3 = await createProfileShell({ owner: "k@nerman.asia", platform: "tiktok", handle: "h", sourceUrl: "h" });
  await runIntake(p3.id, { url: "h", platform: "tiktok", deps: deps({ fetchAccountVideos: async () => [] }) });
  assert.match((await getProfile(p3.id))!.message || "", /không có video công khai/);
});

test("startProfileFromUrl trả ngay {profileId, handle}, profile 'picking' trước khi nền xong", async () => {
  let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  const r = await startProfileFromUrl({ owner: "k@nerman.asia", url: "https://www.tiktok.com/@abc", deps: deps({ fetchAccountVideos: async () => { await gate; return mk(3); } }) });
  assert.equal(r.handle, "abc");
  assert.equal((await getProfile(r.profileId))!.status, "picking", "chưa lấy xong video thì phải là picking");
  release();
  for (let i = 0; i < 50 && (await getProfile(r.profileId))!.status === "picking"; i++) await new Promise((x) => setTimeout(x, 20));
  assert.equal((await getProfile(r.profileId))!.status, "failed", "3 video → failed sau khi nền chạy xong");
});

test("recoverStyleInterrupted: picking → failed", async () => {
  const p = await createProfileShell({ owner: "k@nerman.asia", platform: "tiktok", handle: "h", sourceUrl: "h" });
  await recoverStyleInterrupted();
  const g = (await getProfile(p.id))!;
  assert.equal(g.status, "failed"); assert.match(g.message || "", /Chạy lại/);
});
