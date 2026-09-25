import { test } from "node:test";
import assert from "node:assert/strict";
import { pickStyleVideos } from "./pick.js";
import type { AccountVideo } from "../account.js";

const DAY = 86400;
const NOW = 1_800_000_000;
const mk = (i: number, daysAgo: number, views: number): AccountVideo => ({
  awemeId: `v${i}`, desc: `video ${i}`, author: "a", nickname: "A", link: `https://www.tiktok.com/@a/video/v${i}`,
  createTime: NOW - daysAgo * DAY, stats: { source: "TikTok", views, likes: views / 10, comments: 1, shares: 1, saves: 1 },
});

test("đủ video trong 90 ngày → lấy top view, 5 mẫu chuẩn là 5 view cao nhất, windowDays=90", () => {
  const vids = Array.from({ length: 60 }, (_, i) => mk(i, (i % 80) + 1, 1000 * (60 - i)));
  const r = pickStyleVideos(vids, NOW);
  assert.equal(r.videos.length, 30);
  assert.equal(r.windowDays, 90);
  assert.equal(r.exemplarIds.length, 5);
  assert.deepEqual(r.exemplarIds, ["v0", "v1", "v2", "v3", "v4"]);
  assert.ok(r.videos.every((v, i, a) => i === 0 || a[i - 1].views >= v.views), "phải xếp giảm dần theo view");
  assert.equal(r.videos.filter((v) => v.isExemplar).length, 5);
});

test("thiếu video trong 90 ngày → nới 180 rồi 365, ghi note", () => {
  const recent = Array.from({ length: 10 }, (_, i) => mk(i, 5, 100));
  const older = Array.from({ length: 25 }, (_, i) => mk(100 + i, 150, 500));
  const r = pickStyleVideos([...recent, ...older], NOW);
  assert.equal(r.windowDays, 180);
  assert.equal(r.videos.length, 30);
  assert.match(r.note, /180 ngày/);
});

test("kênh quá ít video → trả tất cả, windowDays=365, exemplars ≤ số video", () => {
  const r = pickStyleVideos([mk(1, 400, 10), mk(2, 400, 20), mk(3, 2, 5)], NOW);
  assert.equal(r.videos.length, 3);
  assert.equal(r.windowDays, 365);
  assert.equal(r.exemplarIds.length, 3);
});
