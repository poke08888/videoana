import { test, before } from "node:test";
import assert from "node:assert/strict";
import { connectDB, allQuery } from "../db.js";
import { initStyleTables } from "./db.js";

before(async () => { process.env.ADMIN_INIT_PASSWORD = "x-test-x"; await connectDB(); });

test("initStyleTables tạo 2 bảng + index, chạy lại không lỗi", async () => {
  await initStyleTables(); await initStyleTables();
  const names = (await allQuery<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table','index')")).map((r) => r.name);
  assert.ok(names.includes("style_profiles"), "thiếu style_profiles");
  assert.ok(names.includes("style_videos"), "thiếu style_videos");
  assert.ok(names.includes("idx_style_videos_profile"), "thiếu index");
});
