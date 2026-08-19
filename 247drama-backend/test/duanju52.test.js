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

test("topCategories chuẩn hoá dữ liệu với cell_id + sub_cell", async () => {
  const s = stub([{
    lists: [
      {
        cell_id: "100",
        cell_name: "Hành động",
        sub_cell: [
          { cell_id: "101", cell_name: "Võ thuật" },
          { cell_id: "102", cell_name: "Chiến tranh" }
        ]
      }
    ]
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [
    {
      cellId: "100",
      name: "Hành động",
      subs: [
        { cellId: "101", name: "Võ thuật" },
        { cellId: "102", name: "Chiến tranh" }
      ]
    }
  ]);
  assert.strictEqual(s.calls[0].params.type, "top");
});

test("topCategories chấp nhận cellId + subs (field khác)", async () => {
  const s = stub([{
    lists: [
      {
        cellId: "200",
        name: "Tình cảm",
        subs: [
          { cellId: "201", name: "Lãng mạn" }
        ]
      }
    ]
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [
    {
      cellId: "200",
      name: "Tình cảm",
      subs: [
        { cellId: "201", name: "Lãng mạn" }
      ]
    }
  ]);
});

test("topCategories lists rỗng -> trả mảng rỗng", async () => {
  const s = stub([{ lists: [] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, []);
});

test("topCategories không có lists -> trả mảng rỗng", async () => {
  const s = stub([{}]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, []);
});

test("topList chuẩn hoá dữ liệu", async () => {
  const s = stub([{
    lists: [
      { id: "333", title: "Phim D", desc: "mô tả D", book_pic: "http://x/d.jpg" }
    ]
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topList("100", "101", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "333", name: "Phim D", description: "mô tả D", cover: "http://x/d.jpg" }
  ]);
  assert.strictEqual(s.calls[0].params.type, "list");
  assert.strictEqual(s.calls[0].params.cell_id, "100");
  assert.strictEqual(s.calls[0].params.sub_cell_id, "101");
  assert.strictEqual(s.calls[0].params.page, 1);
});

test("topList mặc định sub_cell_id rỗng", async () => {
  const s = stub([{ lists: [{ id: "444", name: "X" }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  await c.topList("100");
  assert.strictEqual(s.calls[0].params.sub_cell_id, "");
  assert.strictEqual(s.calls[0].params.page, 1);
});

test("topList lists rỗng -> trả mảng rỗng", async () => {
  const s = stub([{ lists: [] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topList("100");
  assert.deepStrictEqual(out, []);
});

test("phần tử null trong lists -> bỏ qua, không ném lỗi", async () => {
  const s = stub([{
    lists: [
      { id: "555", title: "Phim E", desc: "e" },
      null,
      { id: "666", title: "Phim F", desc: "f" }
    ]
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "x", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "555", name: "Phim E", description: "e", cover: "" },
    { sourceId: "666", name: "Phim F", description: "f", cover: "" }
  ]);
});

test("phần tử không phải object trong lists -> bỏ qua", async () => {
  const s = stub([{
    lists: [
      { id: "777", title: "Phim G" },
      "không phải object",
      { id: "888", title: "Phim H" }
    ]
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "x", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "777", name: "Phim G", description: "", cover: "" },
    { sourceId: "888", name: "Phim H", description: "", cover: "" }
  ]);
});

test("book_id: 0 phải ra sourceId '0' chứ không phải rỗng", async () => {
  const s = stub([{ lists: [{ book_id: 0, name: "Phim Zero", introduction: "z" }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hm", "x", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "0", name: "Phim Zero", description: "z", cover: "" }
  ]);
});

test("id: 0 phải ra sourceId '0'", async () => {
  const s = stub([{ lists: [{ id: 0, title: "Phim Zero", desc: "z" }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "x", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "0", name: "Phim Zero", description: "z", cover: "" }
  ]);
});
