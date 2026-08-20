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

test("search chuẩn hoá dữ liệu hg (data trả thẳng là mảng, không nằm trong lists)", async () => {
  const s = stub([[{ id: "111", title: "Phim A", intro: "mô tả A", cover: "http://x/a.jpg" }]]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "abc", 1);
  assert.deepStrictEqual(out, [{ sourceId: "111", name: "Phim A", description: "mô tả A", cover: "http://x/a.jpg" }]);
  assert.strictEqual(s.calls[0].params.key, "K");
  assert.strictEqual(s.calls[0].params.keyword, "abc");
});

test("search chuẩn hoá dữ liệu hm (tên field khác, vẫn data trả thẳng là mảng)", async () => {
  const s = stub([[{ id: "222", name: "Phim B", introduction: "mô tả B", cover: "http://x/b.jpg" }]]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hm", "abc", 1);
  assert.deepStrictEqual(out, [{ sourceId: "222", name: "Phim B", description: "mô tả B", cover: "http://x/b.jpg" }]);
});

test("search đọc mô tả từ field intro (tên field thật của 52api)", async () => {
  const s = stub([[{ id: "999", title: "Phim Intro", intro: "mô tả từ intro", cover: "http://x/i.jpg" }]]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "x", 1);
  assert.deepStrictEqual(out, [{ sourceId: "999", name: "Phim Intro", description: "mô tả từ intro", cover: "http://x/i.jpg" }]);
});

test("search vẫn đọc được nếu provider đổi lại thành { lists: [...] } (phòng hờ)", async () => {
  const s = stub([{ lists: [{ id: "1", title: "A", intro: "d" }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "x", 1);
  assert.deepStrictEqual(out, [{ sourceId: "1", name: "A", description: "d", cover: "" }]);
});

test("cache: gọi lại trong TTL không đụng mạng", async () => {
  const s = stub([[{ id: "1", title: "A" }]]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0, cacheTtlMs: 1000, now: () => 0 });
  await c.search("hg", "x", 1);
  await c.search("hg", "x", 1);
  assert.strictEqual(s.calls.length, 1);
});

test("cache hết hạn -> gọi lại mạng", async () => {
  const s = stub([[{ id: "1", title: "A" }], [{ id: "1", title: "A" }]]);
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

test("topCategories gom mục con từ sub_lists/panel_lists/items (dữ liệu thật rút gọn)", async () => {
  const s = stub([{
    lists: [
      {
        cell_id: "human",
        cell_name: "真人剧",
        sub_lists: [
          {
            panel_lists: [
              {
                row_name: "综合",
                items: [
                  { panel_id: "", panel_name: "总榜" },
                  { panel_id: "gender_female", panel_name: "女频" },
                  { panel_id: "gender_male", panel_name: "男频" },
                ],
              },
            ],
          },
        ],
      },
    ],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [
    {
      cellId: "human",
      name: "真人剧",
      subs: [
        { cellId: "", name: "总榜" },
        { cellId: "gender_female", name: "女频" },
        { cellId: "gender_male", name: "男频" },
      ],
    },
  ]);
  assert.strictEqual(s.calls[0].params.type, "top");
});

test("topCategories gom phẳng items từ nhiều sub_lists và nhiều panel_lists", async () => {
  const s = stub([{
    lists: [
      {
        cell_id: "c1",
        cell_name: "Cat1",
        sub_lists: [
          {
            panel_lists: [
              { row_name: "r1", items: [{ panel_id: "a", panel_name: "A" }] },
              { row_name: "r2", items: [{ panel_id: "b", panel_name: "B" }] },
            ],
          },
          {
            panel_lists: [{ row_name: "r3", items: [{ panel_id: "c", panel_name: "C" }] }],
          },
        ],
      },
    ],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [
    {
      cellId: "c1",
      name: "Cat1",
      subs: [
        { cellId: "a", name: "A" },
        { cellId: "b", name: "B" },
        { cellId: "c", name: "C" },
      ],
    },
  ]);
});

test("topCategories danh mục không có sub_lists -> mục con rỗng", async () => {
  const s = stub([{
    lists: [{ cell_id: "100", cell_name: "Hành động" }],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [{ cellId: "100", name: "Hành động", subs: [] }]);
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

test("topList chuẩn hoá dữ liệu, không gửi page, dùng panel_id cho mục con", async () => {
  const s = stub([{
    lists: [{ id: "333", name: "Phim D", desc: "mô tả D", cover: "http://x/d.jpg" }],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topList("human", "gender_female");
  assert.deepStrictEqual(out, [{ sourceId: "333", name: "Phim D", description: "mô tả D", cover: "http://x/d.jpg" }]);
  assert.strictEqual(s.calls[0].params.type, "list");
  assert.strictEqual(s.calls[0].params.cell_id, "human");
  assert.strictEqual(s.calls[0].params.panel_id, "gender_female");
  assert.strictEqual("page" in s.calls[0].params, false);
});

test("topList mặc định panel_id rỗng, vẫn không gửi page", async () => {
  const s = stub([{ lists: [{ id: "444", name: "X" }] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  await c.topList("100");
  assert.strictEqual(s.calls[0].params.panel_id, "");
  assert.strictEqual("page" in s.calls[0].params, false);
});

test("topList lists rỗng -> trả mảng rỗng", async () => {
  const s = stub([{ lists: [] }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topList("100");
  assert.deepStrictEqual(out, []);
});

test("phần tử null trong data (search) -> bỏ qua, không ném lỗi", async () => {
  const s = stub([[
    { id: "555", title: "Phim E", intro: "e" },
    null,
    { id: "666", title: "Phim F", intro: "f" },
  ]]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "x", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "555", name: "Phim E", description: "e", cover: "" },
    { sourceId: "666", name: "Phim F", description: "f", cover: "" },
  ]);
});

test("phần tử không phải object trong data (search) -> bỏ qua", async () => {
  const s = stub([[
    { id: "777", title: "Phim G" },
    "không phải object",
    { id: "888", title: "Phim H" },
  ]]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "x", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "777", name: "Phim G", description: "", cover: "" },
    { sourceId: "888", name: "Phim H", description: "", cover: "" },
  ]);
});

test("book_id: 0 phải ra sourceId '0' chứ không phải rỗng", async () => {
  const s = stub([[{ book_id: 0, name: "Phim Zero", introduction: "z" }]]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hm", "x", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "0", name: "Phim Zero", description: "z", cover: "" },
  ]);
});

test("id: 0 phải ra sourceId '0'", async () => {
  const s = stub([[{ id: 0, title: "Phim Zero", intro: "z" }]]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.search("hg", "x", 1);
  assert.deepStrictEqual(out, [
    { sourceId: "0", name: "Phim Zero", description: "z", cover: "" },
  ]);
});

test("topCategories phần tử null trong lists -> bỏ qua, không ném lỗi", async () => {
  const s = stub([{
    lists: [
      { cell_id: "100", cell_name: "Hành động", sub_lists: [] },
      null,
      { cell_id: "200", cell_name: "Tình cảm", sub_lists: [] },
    ],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [
    { cellId: "100", name: "Hành động", subs: [] },
    { cellId: "200", name: "Tình cảm", subs: [] },
  ]);
});

test("topCategories phần tử null trong items -> bỏ qua, giữ danh mục", async () => {
  const s = stub([{
    lists: [
      {
        cell_id: "300",
        cell_name: "Võ thuật",
        sub_lists: [
          {
            panel_lists: [
              {
                row_name: "r",
                items: [
                  { panel_id: "301", panel_name: "Chiến tranh" },
                  null,
                  { panel_id: "302", panel_name: "Truyền thuyết" },
                ],
              },
            ],
          },
        ],
      },
    ],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [
    {
      cellId: "300",
      name: "Võ thuật",
      subs: [
        { cellId: "301", name: "Chiến tranh" },
        { cellId: "302", name: "Truyền thuyết" },
      ],
    },
  ]);
});

test("topCategories bỏ qua phần tử null ở sub_lists/panel_lists mà không ném lỗi", async () => {
  const s = stub([{
    lists: [
      {
        cell_id: "c1",
        cell_name: "Cat1",
        sub_lists: [
          null,
          { panel_lists: [null, { row_name: "r", items: [{ panel_id: "x", panel_name: "X" }] }] },
        ],
      },
    ],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [{ cellId: "c1", name: "Cat1", subs: [{ cellId: "x", name: "X" }] }]);
});

test("topCategories cell_id: 0 ở tầng cha -> cellId '0' không rỗng", async () => {
  const s = stub([{
    lists: [{ cell_id: 0, cell_name: "Zero Cat", sub_lists: [] }],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [{ cellId: "0", name: "Zero Cat", subs: [] }]);
});

test("topCategories panel_id: 0 ở mục con -> cellId '0' không rỗng", async () => {
  const s = stub([{
    lists: [
      {
        cell_id: "400",
        cell_name: "Tìm kiếm",
        sub_lists: [
          { panel_lists: [{ row_name: "r", items: [{ panel_id: 0, panel_name: "Zero Sub" }] }] },
        ],
      },
    ],
  }]);
  const c = createClient({ getKey: () => "K", httpGet: s.httpGet, minIntervalMs: 0 });
  const out = await c.topCategories();
  assert.deepStrictEqual(out, [
    {
      cellId: "400",
      name: "Tìm kiếm",
      subs: [{ cellId: "0", name: "Zero Sub" }],
    },
  ]);
});

test("nguồn dl: KHÔNG gửi tham số page (API cấm), đọc đúng tên và tổng số tập", async () => {
  const calls = [];
  const c = createClient({
    getKey: () => "k",
    httpGet: async (url, params) => {
      calls.push({ url, params });
      if (params.type === "search") return [{ id: 13785, title: "Phim Dongli", cover: "c.jpg", introduction: "nội dung" }];
      return { title: "Phim Dongli", cover: "c.jpg", introduction: "nội dung", total: 83, lists: [{ id: 1 }, { id: 2 }] };
    },
    minIntervalMs: 0,
  });

  const found = await c.search("dl", "战神");
  assert.strictEqual(calls[0].url, "https://www.52api.cn/api/dongli");
  assert.strictEqual("page" in calls[0].params, false, "dl mà gửi page là API trả lỗi 400");
  assert.strictEqual(found[0].name, "Phim Dongli");
  assert.strictEqual(found[0].sourceId, "13785");

  const d = await c.detail("dl", "13785");
  assert.strictEqual(d.episodeCount, 83, "lấy theo total chứ không đếm mảng lists đã cắt bớt");
});

test("nguồn hg/hm vẫn gửi page như cũ", async () => {
  const calls = [];
  const c = createClient({ getKey: () => "k", httpGet: async (url, params) => { calls.push(params); return []; }, minIntervalMs: 0 });
  await c.search("hg", "x", 2);
  assert.strictEqual(calls[0].page, 2);
});
