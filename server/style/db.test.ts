import { test, before } from "node:test";
import assert from "node:assert/strict";
import { connectDB, allQuery, runQuery } from "../db.js";
import { createProfile, claimVideo } from "./store.js";
import { initStyleTables } from "./db.js";

before(async () => { process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); });

test("initStyleTables tạo 2 bảng + index, chạy lại không lỗi", async () => {
  await initStyleTables(); await initStyleTables();
  const names = (await allQuery<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table','index')")).map((r) => r.name);
  assert.ok(names.includes("style_profiles"), "thiếu style_profiles");
  assert.ok(names.includes("style_videos"), "thiếu style_videos");
  assert.ok(names.includes("idx_style_videos_profile"), "thiếu index");
  assert.ok(names.includes("idx_style_videos_status"), "thiếu index idx_style_videos_status");
});

test("claimVideo công bằng: profile tạo trước được lấy trước dù profile sau có view cao hơn", async () => {
  await initStyleTables();
  const mk = (tag: string, views: number) => [{ awemeId: `${tag}1`, link: `https://www.tiktok.com/@f/video/${tag}1`, title: "", cover: "", views, likes: 0, createTime: 1, isExemplar: false }];
  const a = await createProfile({ owner: "f@nerman.asia", platform: "tiktok", handle: "fa", nickname: "A", avatar: "", videos: mk("fa", 10), exemplarIds: [] });
  const b = await createProfile({ owner: "f@nerman.asia", platform: "tiktok", handle: "fb", nickname: "B", avatar: "", videos: mk("fb", 1_000_000), exemplarIds: [] });
  // created_at theo ms có thể trùng → ghi rõ thứ tự tạo.
  await runQuery("UPDATE style_profiles SET created_at = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", a.id]);
  await runQuery("UPDATE style_profiles SET created_at = ? WHERE id = ?", ["2026-01-01T00:00:01.000Z", b.id]);
  const first = await claimVideo();
  assert.ok(first, "phải claim được 1 video");
  assert.equal(first!.profile_id, a.id, `video đầu phải thuộc profile tạo trước, được ${first!.profile_id}`);
  const second = await claimVideo();
  assert.equal(second?.profile_id, b.id, "video thứ hai thuộc profile sau");
});
