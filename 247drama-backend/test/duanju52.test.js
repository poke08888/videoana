const { test } = require("node:test");
const assert = require("node:assert");
const { createClient } = require("../util/duanju52");

function stub(payloads) {
  const calls = [];
  return {
    calls,
    httpGet: async (url, params) => {
      calls.push({ url, params });
      const p = payloads.shift();
      if (p instanceof Error) throw p;
      return p;
    },
  };
}

test("search chuẩn hoá dữ liệu hg", async () => {
  const s = stub([{ lists: [{ id: "111", title: "Phim A", desc: "mô tả A", book_pic: "http://x/a.jpg" }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "abc", 1);
  assert.deepStrictEqual(out, [{ sourceId: "111", name: "Phim A", description: "mô tả A", cover: "http://x/a.jpg" }]);
  assert.strictEqual(s.calls[0].params.key, "K");
  assert.strictEqual(s.calls[0].params.keyword, "abc");
});

test("search chuẩn hoá dữ liệu hm (tên field khác)", async () => {
  const s = stub([{ lists: [{ id: "222", name: "Phim B", introduction: "mô tả B", cover: "http://x/b.jpg" }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hm", "abc", 1);
  assert.deepStrictEqual(out, [{ sourceId: "222", name: "Phim B", description: "mô tả B", cover: "http://x/b.jpg" }]);
});

test("cache: gọi lại trong TTL không đụng mạng", async () => {
  const s = stub([{ lists: [{ id: "1", title: "A" }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0, cacheTtlMs: 1000, now: () => 0 });
  await c.search("hg", "x", 1);
  await c.search("hg", "x", 1);
  assert.strictEqual(s.calls.length, 1);
});

test("cache hết hạn -> gọi lại mạng", async () => {
  const s = stub([{ lists: [{ id: "1", title: "A" }] }, { lists: [{ id: "1", title: "A" }] }]);
  let t = 0;
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0, cacheTtlMs: 1000, now: () => t });
  await c.search("hg", "x", 1);
  t = 1001;
  await c.search("hg", "x", 1);
  assert.strictEqual(s.calls.length, 2);
});

test("detail trả số tập", async () => {
  const s = stub([{ title: "Phim C", desc: "d", book_pic: "c.jpg", lists: [{ video_id: 1 }, { video_id: 2 }, { video_id: 3 }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const d = await c.detail("hg", "333");
  assert.deepStrictEqual(d, { name: "Phim C", description: "d", cover: "c.jpg", episodeCount: 3 });
});

test("thiếu key -> ném lỗi rõ ràng, không gọi mạng", async () => {
  const s = stub([]);
  const c = createClient({ getKey: () => "", httpGet: s.httpGet, minIntervalMs: 0 });
  await assert.rejects(() => c.search("hg", "x", 1), /chưa cấu hình key 52api/);
  assert.strictEqual(s.calls.length, 0);
});

test("provider lạ -> ném lỗi", async () => {
  const c = createClient({ getKey: () => "K", httpGet: async () => ({}), minIntervalMs: 0 });
  await assert.rejects(() => c.search("xx", "x", 1), /provider/);
});
