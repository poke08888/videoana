const { test } = require("node:test");
const assert = require("node:assert");
const { classifyEpisodes } = require("../work");

const DETAIL = [
  { index: 0, videoId: "a", title: "t0" },
  { index: 1, videoId: "b", title: "t1" },
  { index: 2, videoId: "c", title: "t2" },
  { index: 3, videoId: "d", title: "t3" },
];

test("chưa có bản ghi -> tính là thiếu, giữ đúng thứ tự", () => {
  const r = classifyEpisodes(DETAIL, [
    { episodeNumber: 0, sourceVideoId: "a" },
    { episodeNumber: 1, sourceVideoId: "b" },
  ]);
  assert.deepStrictEqual(r.missing.map((m) => m.index), [2, 3]);
  assert.strictEqual(r.missing[0].videoId, "c");
  assert.deepStrictEqual(r.drift, []);
});

test("videoId khớp -> không thiếu, không lệch", () => {
  const r = classifyEpisodes(DETAIL, DETAIL.map((e) => ({ episodeNumber: e.index, sourceVideoId: e.videoId })));
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.drift, []);
});

test("videoId khác -> báo lệch, KHÔNG đưa vào danh sách render", () => {
  const r = classifyEpisodes(DETAIL, [
    { episodeNumber: 0, sourceVideoId: "a" },
    { episodeNumber: 1, sourceVideoId: "XX" },
    { episodeNumber: 2, sourceVideoId: "c" },
    { episodeNumber: 3, sourceVideoId: "d" },
  ]);
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.drift, [{ index: 1, storedVideoId: "XX", sourceVideoId: "b" }]);
});

test("bản ghi cũ thiếu sourceVideoId -> coi là hợp lệ, không báo lệch giả", () => {
  const r = classifyEpisodes(DETAIL, [
    { episodeNumber: 0 },
    { episodeNumber: 1, sourceVideoId: "" },
    { episodeNumber: 2, sourceVideoId: null },
  ]);
  assert.deepStrictEqual(r.missing.map((m) => m.index), [3]);
  assert.deepStrictEqual(r.drift, []);
});

test("videoId so sánh theo chuỗi (nguồn trả số)", () => {
  const r = classifyEpisodes([{ index: 0, videoId: "12345", title: "t" }], [{ episodeNumber: 0, sourceVideoId: 12345 }]);
  assert.deepStrictEqual(r.drift, []);
  assert.deepStrictEqual(r.missing, []);
});

test("đầu vào rỗng/null -> không nổ", () => {
  assert.deepStrictEqual(classifyEpisodes(null, null), { missing: [], drift: [] });
  assert.deepStrictEqual(classifyEpisodes([], []), { missing: [], drift: [] });
});

const { extract52apiSource } = require("../work");

test("nhận ra phim nguồn dl (东梨), không bỏ qua như trước", () => {
  assert.deepStrictEqual(extract52apiSource({ bookId: "dl:10959", sourceProvider: "52api-dl" }), { provider: "dl", sourceId: "10959" });
});

test("thiếu bookId thì lấy nguồn từ sourceProvider, đủ cả ba nguồn", () => {
  for (const p of ["hg", "hm", "dl"]) {
    assert.strictEqual(extract52apiSource({ sourceProvider: `52api-${p}` }).provider, p);
  }
});

test("nguồn lạ vẫn bị bỏ qua, không đoán bừa", () => {
  assert.strictEqual(extract52apiSource({ bookId: "xx:1", sourceProvider: "52api-xx" }).provider, null);
});

test("tập đã có bản ghi nhưng backend chấm là hỏng -> đưa vào danh sách render lại", () => {
  const rows = DETAIL.map((e) => ({ episodeNumber: e.index, sourceVideoId: e.videoId }));
  const r = classifyEpisodes(DETAIL, rows, [1]);
  assert.deepStrictEqual(r.missing.map((e) => e.index), [1]);
  assert.deepStrictEqual(r.drift, []);
});

test("không có tập hỏng nào -> không render lại gì cả", () => {
  const rows = DETAIL.map((e) => ({ episodeNumber: e.index, sourceVideoId: e.videoId }));
  assert.deepStrictEqual(classifyEpisodes(DETAIL, rows, []).missing, []);
  assert.deepStrictEqual(classifyEpisodes(DETAIL, rows).missing, []);
});

test("tập vừa hỏng vừa lệch videoId -> KHÔNG ghi đè, chỉ báo lệch", () => {
  const rows = DETAIL.map((e) => ({ episodeNumber: e.index, sourceVideoId: e.index === 1 ? "khac" : e.videoId }));
  const r = classifyEpisodes(DETAIL, rows, [1]);
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.drift.map((d) => d.index), [1]);
});
