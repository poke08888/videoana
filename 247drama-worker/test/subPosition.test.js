const { test } = require("node:test");
const assert = require("node:assert");
const { resolveSubPosition } = require("../util/subPosition");

test("tập đo được, phim chưa chốt -> dùng số của tập và chốt cho phim", () => {
  const r = resolveSubPosition({ episodeRatio: 0.718, seriesRatio: null, gapRatio: 0.012 });
  assert.strictEqual(r.source, "episode");
  assert.strictEqual(r.pin, true);
  assert.ok(Math.abs(r.topRatio - 0.73) < 1e-9);
});

test("tập đo sát mức phim -> dùng số của tập, không chốt lại", () => {
  const r = resolveSubPosition({ episodeRatio: 0.73, seriesRatio: 0.72, gapRatio: 0.012 });
  assert.strictEqual(r.source, "episode");
  assert.strictEqual(r.pin, false);
  assert.strictEqual(r.warn, "");
});

test("tập đo lệch xa mức phim -> theo mức phim và cảnh báo", () => {
  const r = resolveSubPosition({ episodeRatio: 0.45, seriesRatio: 0.72, gapRatio: 0.012 });
  assert.strictEqual(r.source, "series");
  assert.ok(r.warn.includes("lệch"));
  assert.ok(Math.abs(r.topRatio - 0.732) < 1e-9);
});

test("tập không đo được nhưng phim đã chốt -> theo mức phim", () => {
  const r = resolveSubPosition({ episodeRatio: null, seriesRatio: 0.7, gapRatio: 0.012 });
  assert.strictEqual(r.source, "series");
  assert.ok(r.warn.includes("OCR không đo được"));
});

test("không có số nào -> null để bỏ tập, KHÔNG đoán hằng số", () => {
  assert.strictEqual(resolveSubPosition({ episodeRatio: null, seriesRatio: null }), null);
  assert.strictEqual(resolveSubPosition({ episodeRatio: 0, seriesRatio: undefined }), null);
  assert.strictEqual(resolveSubPosition({ episodeRatio: NaN, seriesRatio: 1.4 }), null);
});

test("số đặt tay luôn thắng OCR", () => {
  const r = resolveSubPosition({ episodeRatio: 0.4, seriesRatio: 0.75, seriesSource: "manual", gapRatio: 0.012 });
  assert.strictEqual(r.source, "series");
  assert.ok(Math.abs(r.topRatio - 0.762) < 1e-9);
  assert.ok(r.warn.includes("đặt tay"));
});

test("không đẩy chữ quá sát mép dưới", () => {
  const r = resolveSubPosition({ episodeRatio: 0.95, seriesRatio: null, gapRatio: 0.012 });
  assert.strictEqual(r.topRatio, 0.88);
});
