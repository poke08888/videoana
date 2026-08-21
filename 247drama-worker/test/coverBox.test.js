const { test } = require("node:test");
const assert = require("node:assert");
const { coverBoxFor } = require("../util/coverBox");

const base = { yRatio: 0.66, heightRatio: 0.17, color: "white@1", enabled: true };

test("phim đặt chữ ở chỗ quen thuộc -> ô che y như mặc định cũ", () => {
  assert.strictEqual(coverBoxFor({ bottomRatio: 0.72, base }).yRatio, 0.66);
});

test("phim đặt chữ thấp -> ô che tụt xuống theo, không để hở chữ Trung", () => {
  const box = coverBoxFor({ bottomRatio: 0.9, base });
  assert.strictEqual(box.yRatio, 0.83); // chạm mép dưới khung hình
  assert.ok(box.yRatio + box.heightRatio <= 1);
});

test("phim đặt chữ cao -> ô che lên theo", () => {
  assert.strictEqual(coverBoxFor({ bottomRatio: 0.62, base }).yRatio, 0.56);
});

test("không đo được đáy chữ -> giữ nguyên ô mặc định", () => {
  assert.deepStrictEqual(coverBoxFor({ bottomRatio: null, base }), base);
  assert.deepStrictEqual(coverBoxFor({ bottomRatio: undefined, base }), base);
  assert.deepStrictEqual(coverBoxFor({ bottomRatio: 1.4, base }), base);
});

test("giữ nguyên màu và cờ bật/tắt của người vận hành", () => {
  const off = { ...base, enabled: false, color: "black@1" };
  const box = coverBoxFor({ bottomRatio: 0.8, base: off });
  assert.strictEqual(box.enabled, false);
  assert.strictEqual(box.color, "black@1");
});

test("ô cao bất thường vẫn không tràn khỏi khung", () => {
  const tall = { ...base, heightRatio: 0.4 };
  const box = coverBoxFor({ bottomRatio: 0.95, base: tall });
  assert.ok(box.yRatio + tall.heightRatio <= 1.0001);
});
