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
