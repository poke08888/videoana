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

// Task 3: resolveAccount tests
import { resolveAccount, type ApiGet } from "./account.js";

const fakeTikTok: ApiGet = async (_h, path) => {
  if (path === "/v1/user/@nerman") return { user: { sec_uid: "MS4wSEC", nickname: "Nerman", avatar_168x168: { url_list: ["http://a/av.webp"] } } };
  throw new Error("unexpected " + path);
};
const fakeDouyin: ApiGet = async (_h, path, params) => {
  if (path === "/api/v1/douyin/web/get_sec_user_id") return { data: "MS4wDYSEC" };
  if (path === "/api/v1/douyin/web/handler_user_profile") { assert.equal(params.sec_user_id, "MS4wDYSEC"); return { data: { user: { nickname: "抖音号", avatar_larger: { url_list: ["http://a/dy.webp"] } } } }; }
  throw new Error("unexpected " + path);
};

test("resolveAccount TikTok -> sec_uid + nickname", async () => {
  const acc = await resolveAccount("https://www.tiktok.com/@nerman", "K", fakeTikTok);
  assert.deepEqual({ p: acc.platform, s: acc.secId, h: acc.handle, n: acc.nickname }, { p: "tiktok", s: "MS4wSEC", h: "nerman", n: "Nerman" });
});
test("resolveAccount Douyin -> sec_user_id + nickname từ profile", async () => {
  const acc = await resolveAccount("https://www.douyin.com/user/xyz", "K", fakeDouyin);
  assert.equal(acc.platform, "douyin");
  assert.equal(acc.secId, "MS4wDYSEC");
  assert.equal(acc.nickname, "抖音号");
});
test("resolveAccount TikTok không tồn tại -> ném lỗi", async () => {
  const empty: ApiGet = async () => ({ user: {} });
  await assert.rejects(() => resolveAccount("@ghost", "K", empty), /Không tìm thấy/);
});
test("resolveAccount input rác -> ném lỗi", async () => {
  await assert.rejects(() => resolveAccount("has space", "K", fakeTikTok), /không hợp lệ/i);
});

// Task 4: fetchAccountVideos tests
import { fetchAccountVideos, type Account } from "./account.js";

const AW = (id: string, ct: number, likes: number) => ({ aweme_id: id, desc: "v" + id, create_time: ct, statistics: { play_count: likes * 10, digg_count: likes, comment_count: 0, share_count: 0, collect_count: 0 } });

test("fetchAccountVideos TikTok: phân trang qua offset=max_cursor trước, dừng khi hết has_more", async () => {
  const acc: Account = { platform: "tiktok", secId: "SEC", handle: "nerman", nickname: "Nerman", avatar: "" };
  const pages: Record<string, any> = {
    "0": { aweme_list: [AW("1", 100, 10), AW("2", 90, 20)], has_more: 1, max_cursor: "50" },
    "50": { aweme_list: [AW("3", 80, 30)], has_more: 0, max_cursor: "0" },
  };
  const apiGet: ApiGet = async (host, path, params) => {
    assert.equal(host, "tokapi-mobile-version.p.rapidapi.com");
    assert.equal(path, "/v1/post/user/SEC/posts");
    // TikTok (tokapi) phân trang qua `offset` = max_cursor trang trước, KHÔNG dùng param max_cursor.
    assert.equal(params.max_cursor, undefined);
    return pages[params.offset];
  };
  const out = await fetchAccountVideos(acc, { count: 100, key: "K", apiGet });
  assert.deepEqual(out.map((v) => v.awemeId), ["1", "2", "3"]);
  assert.equal(out[0].link, "https://www.tiktok.com/@nerman/video/1");
  assert.equal(out[0].createTime, 100);
  assert.equal(out[0].stats.likes, 10);
});

test("fetchAccountVideos: tôn trọng count (cắt sớm)", async () => {
  const acc: Account = { platform: "tiktok", secId: "SEC", handle: "n", nickname: "N", avatar: "" };
  const apiGet: ApiGet = async () => ({ aweme_list: [AW("1", 1, 1), AW("2", 1, 1), AW("3", 1, 1)], has_more: 1, max_cursor: "9" });
  const out = await fetchAccountVideos(acc, { count: 2, key: "K", apiGet });
  assert.equal(out.length, 2);
});

test("fetchAccountVideos Douyin: đọc data.aweme_list + link douyin", async () => {
  const acc: Account = { platform: "douyin", secId: "DSEC", handle: "dy", nickname: "DY", avatar: "" };
  const apiGet: ApiGet = async (host, path, params) => {
    assert.equal(host, "douyin-api6.p.rapidapi.com");
    assert.equal(path, "/api/v1/douyin/web/fetch_user_post_videos");
    assert.equal(params.sec_user_id, "DSEC");
    return { data: { aweme_list: [AW("11", 5, 5)], has_more: 0, max_cursor: "0" } };
  };
  const out = await fetchAccountVideos(acc, { count: 100, key: "K", apiGet });
  assert.equal(out[0].link, "https://www.douyin.com/video/11");
  assert.equal(out[0].stats.source, "Douyin");
});

test("fetchAccountVideos: dedup theo aweme_id", async () => {
  const acc: Account = { platform: "tiktok", secId: "S", handle: "n", nickname: "N", avatar: "" };
  let call = 0;
  const apiGet: ApiGet = async () => (call++ === 0
    ? { aweme_list: [AW("1", 1, 1)], has_more: 1, max_cursor: "7" }
    : { aweme_list: [AW("1", 1, 1), AW("2", 1, 1)], has_more: 0, max_cursor: "0" });
  const out = await fetchAccountVideos(acc, { count: 100, key: "K", apiGet });
  assert.deepEqual(out.map((v) => v.awemeId), ["1", "2"]);
});
