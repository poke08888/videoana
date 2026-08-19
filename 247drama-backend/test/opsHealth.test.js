const { test } = require("node:test");
const assert = require("node:assert");
const { diffEpisodes } = require("../util/opsHealth");

const SRC = [
  { index: 0, videoId: "a" },
  { index: 1, videoId: "b" },
  { index: 2, videoId: "c" },
];

test("đủ tập, khớp videoId -> không thiếu, không lệch", () => {
  const r = diffEpisodes(SRC, [
    { episodeNumber: 0, sourceVideoId: "a" },
    { episodeNumber: 1, sourceVideoId: "b" },
    { episodeNumber: 2, sourceVideoId: "c" },
  ]);
  assert.deepStrictEqual(r, { rendered: 3, drift: [], missing: [] });
});

test("thiếu tập -> liệt kê đúng vị trí", () => {
  const r = diffEpisodes(SRC, [{ episodeNumber: 0, sourceVideoId: "a" }]);
  assert.deepStrictEqual(r.missing, [1, 2]);
  assert.strictEqual(r.rendered, 1);
});

test("lệch videoId -> báo đúng tập", () => {
  const r = diffEpisodes(SRC, [
    { episodeNumber: 0, sourceVideoId: "a" },
    { episodeNumber: 1, sourceVideoId: "ZZ" },
    { episodeNumber: 2, sourceVideoId: "c" },
  ]);
  assert.deepStrictEqual(r.drift, [{ index: 1, storedVideoId: "ZZ", sourceVideoId: "b" }]);
  assert.deepStrictEqual(r.missing, []);
});

test("bản ghi cũ thiếu sourceVideoId -> không tính là lệch", () => {
  const r = diffEpisodes(SRC, [
    { episodeNumber: 0 },
    { episodeNumber: 1, sourceVideoId: "" },
    { episodeNumber: 2, sourceVideoId: "c" },
  ]);
  assert.deepStrictEqual(r.drift, []);
  assert.strictEqual(r.rendered, 3);
});

test("đầu vào rỗng -> số 0, mảng rỗng", () => {
  assert.deepStrictEqual(diffEpisodes([], []), { rendered: 0, drift: [], missing: [] });
  assert.deepStrictEqual(diffEpisodes(null, null), { rendered: 0, drift: [], missing: [] });
});
