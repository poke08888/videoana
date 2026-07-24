import { test } from "node:test";
import assert from "node:assert/strict";
import { engagementRate, filterAccountVideos, type AccountVideo, normalizeAccountInput } from "./account.js";

const V = (o: Partial<AccountVideo> & { likes: number; views: number; createTime?: number; comments?: number; shares?: number; saves?: number }): AccountVideo => ({
  awemeId: o.awemeId || "1", desc: o.desc || "", author: "a", nickname: "n", link: "http://x/1",
  createTime: o.createTime ?? 0,
  stats: { source: "TikTok", views: o.views, likes: o.likes, comments: o.comments ?? 0, shares: o.shares ?? 0, saves: o.saves ?? 0 },
});

test("engagementRate: views=0 -> 0", () => {
  assert.equal(engagementRate({ source: "TikTok", views: 0, likes: 5, comments: 0, shares: 0, saves: 0 }), 0);
});

test("engagementRate: tính đúng %", () => {
  // (10+2+3+5)/1000*100 = 2
  assert.equal(engagementRate({ source: "TikTok", views: 1000, likes: 10, comments: 2, shares: 3, saves: 5 }), 2);
});

test("filter minLikes/minViews (biên: đúng ngưỡng thì GIỮ)", () => {
  const vids = [V({ likes: 100, views: 1000 }), V({ awemeId: "2", likes: 99, views: 1000 }), V({ awemeId: "3", likes: 100, views: 999 })];
  const out = filterAccountVideos(vids, { minLikes: 100, minViews: 1000 }, 0);
  assert.deepEqual(out.map((v) => v.awemeId), ["1"]);
});

test("filter minER (%)", () => {
  const vids = [V({ likes: 30, views: 1000 }), V({ awemeId: "2", likes: 10, views: 1000 })]; // ER 3% vs 1%
  const out = filterAccountVideos(vids, { minER: 2 }, 0);
  assert.deepEqual(out.map((v) => v.awemeId), ["1"]);
});

test("filter sinceDays: bỏ video cũ hơn cutoff", () => {
  const now = 1_700_000_000; // giây
  const vids = [V({ createTime: now - 5 * 86400, likes: 1, views: 1 }), V({ awemeId: "2", createTime: now - 40 * 86400, likes: 1, views: 1 })];
  const out = filterAccountVideos(vids, { sinceDays: 30 }, now);
  assert.deepEqual(out.map((v) => v.awemeId), ["1"]);
});

test("filter sinceDays=0: không lọc theo ngày", () => {
  const vids = [V({ createTime: 1, likes: 1, views: 1 })];
  assert.equal(filterAccountVideos(vids, { sinceDays: 0 }, 9_999_999).length, 1);
});

test("filter rỗng: giữ nguyên", () => {
  const vids = [V({ likes: 0, views: 0 }), V({ awemeId: "2", likes: 5, views: 9 })];
  assert.equal(filterAccountVideos(vids, {}, 0).length, 2);
});

test("filter sinceDays: video createTime=0 (không rõ ngày) -> GIỮ", () => {
  const now = 1_700_000_000;
  const vids = [V({ createTime: 0, likes: 1, views: 1 })];
  assert.equal(filterAccountVideos(vids, { sinceDays: 30 }, now).length, 1);
});

test("normalize: link TikTok @handle", () => {
  assert.deepEqual(normalizeAccountInput("https://www.tiktok.com/@nerman.official"), { platform: "tiktok", ref: "nerman.official" });
});
test("normalize: TikTok có query/đuôi", () => {
  assert.deepEqual(normalizeAccountInput("tiktok.com/@abc_123/video/999?is=1"), { platform: "tiktok", ref: "abc_123" });
});
test("normalize: bare @handle -> tiktok", () => {
  assert.deepEqual(normalizeAccountInput("@shop.cool"), { platform: "tiktok", ref: "shop.cool" });
});
test("normalize: bare handle không @ -> tiktok", () => {
  assert.deepEqual(normalizeAccountInput("shopcool"), { platform: "tiktok", ref: "shopcool" });
});
test("normalize: Douyin user url -> giữ nguyên url có https", () => {
  const r = normalizeAccountInput("https://www.douyin.com/user/MS4wLjABAAAAxyz");
  assert.equal(r?.platform, "douyin");
  assert.equal(r?.ref, "https://www.douyin.com/user/MS4wLjABAAAAxyz");
});
test("normalize: Douyin thiếu scheme -> thêm https", () => {
  const r = normalizeAccountInput("v.douyin.com/abc/");
  assert.equal(r?.platform, "douyin");
  assert.equal(r?.ref, "https://v.douyin.com/abc/");
});
test("normalize: rác -> null", () => {
  assert.equal(normalizeAccountInput("   "), null);
  assert.equal(normalizeAccountInput("has space"), null);
});
