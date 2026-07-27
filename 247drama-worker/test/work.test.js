const { test } = require("node:test");
const assert = require("node:assert");
const { computeMissingEpisodes } = require("../work");

test("bỏ tập đã có, giữ tập thiếu đúng thứ tự", () => {
  const detail = [
    { index: 0, videoId: "a", title: "t0" },
    { index: 1, videoId: "b", title: "t1" },
    { index: 2, videoId: "c", title: "t2" },
    { index: 3, videoId: "d", title: "t3" },
  ];
  const existing = new Set([0, 1]);
  const missing = computeMissingEpisodes(detail, existing);
  assert.deepStrictEqual(missing.map((m) => m.index), [2, 3]);
  assert.strictEqual(missing[0].videoId, "c");
});

test("không thiếu tập -> mảng rỗng", () => {
  const detail = [{ index: 0, videoId: "a", title: "t0" }];
  assert.deepStrictEqual(computeMissingEpisodes(detail, new Set([0])), []);
});
