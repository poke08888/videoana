const { test } = require("node:test");
const assert = require("node:assert");
const { scoreSegments, shouldWiden, MIN_CN_SEGS } = require("../util/asrOcr");

const cn = (n) => Array.from({ length: n }, (_, i) => ({ text: `中文câu${i}` }));

test("đếm đúng số câu có chữ Hán, bỏ qua câu rác không dấu Hán", () => {
  assert.strictEqual(scoreSegments([{ text: "中文" }, { text: "MV" }, { text: "" }, { text: "3" }]), 1);
  assert.strictEqual(scoreSegments([]), 0);
  assert.strictEqual(scoreSegments(null), 0);
  assert.strictEqual(scoreSegments([{ text: null }, {}]), 0);
});

test("đọc được nhiều câu và đo được vị trí -> khỏi quét lại", () => {
  assert.strictEqual(shouldWiden({ segments: cn(30), chineseBottomRatio: 0.72 }), false);
});

test("không đo được vị trí -> quét lại dải rộng", () => {
  assert.strictEqual(shouldWiden({ segments: cn(30), chineseBottomRatio: null }), true);
});

test("đo được vị trí nhưng chỉ vài câu -> vẫn quét lại (đang bắt nhầm chữ vụn)", () => {
  assert.strictEqual(shouldWiden({ segments: cn(MIN_CN_SEGS - 1), chineseBottomRatio: 0.66 }), true);
  assert.strictEqual(shouldWiden({ segments: cn(MIN_CN_SEGS), chineseBottomRatio: 0.66 }), false);
});

test("không có kết quả nào -> quét lại", () => {
  assert.strictEqual(shouldWiden(null), true);
  assert.strictEqual(shouldWiden({ segments: [], chineseBottomRatio: null }), true);
});
