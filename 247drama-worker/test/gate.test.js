const { test } = require("node:test");
const assert = require("node:assert");
const { createGate } = require("../util/gate");

const cho = (ms) => new Promise((r) => setTimeout(r, ms));

test("không bao giờ chạy quá số cho phép", async () => {
  const gate = createGate(2);
  let dangChay = 0, đỉnh = 0;
  await Promise.all(Array.from({ length: 8 }, () => gate.run(async () => {
    dangChay++; đỉnh = Math.max(đỉnh, dangChay);
    await cho(10);
    dangChay--;
  })));
  assert.strictEqual(đỉnh, 2);
});

test("chạy đúng thứ tự xếp hàng và trả về kết quả của từng việc", async () => {
  const gate = createGate(1);
  const xong = [];
  const rs = await Promise.all([1, 2, 3].map((i) => gate.run(async () => { xong.push(i); return i * 10; })));
  assert.deepStrictEqual(xong, [1, 2, 3]);
  assert.deepStrictEqual(rs, [10, 20, 30]);
});

test("một việc lỗi không làm kẹt hàng đợi", async () => {
  const gate = createGate(1);
  await assert.rejects(() => gate.run(async () => { throw new Error("hỏng"); }), /hỏng/);
  assert.strictEqual(await gate.run(async () => "vẫn chạy"), "vẫn chạy");
  assert.strictEqual(gate.running, 0);
});

test("số cho phép không hợp lệ -> ít nhất là 1", () => {
  assert.strictEqual(createGate(0).limit, 1);
  assert.strictEqual(createGate(-5).limit, 1);
  assert.strictEqual(createGate("x").limit, 1);
  assert.strictEqual(createGate(3).limit, 3);
});

test("đếm được số việc đang chạy và đang chờ", async () => {
  const gate = createGate(1);
  let mo;
  const chan = new Promise((r) => { mo = r; });
  const p1 = gate.run(() => chan);
  const p2 = gate.run(async () => "sau");
  await cho(5);
  assert.strictEqual(gate.running, 1);
  assert.strictEqual(gate.waiting, 1);
  mo();
  await Promise.all([p1, p2]);
  assert.strictEqual(gate.waiting, 0);
});
