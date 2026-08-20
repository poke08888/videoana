const { test } = require("node:test");
const assert = require("node:assert");
const { ensureTunnel } = require("../util/tunnel");

test("cổng đang mở -> không chạy lại script", async () => {
  let ran = false;
  const r = await ensureTunnel({ script: "x.sh", check: async () => true, exec: async () => { ran = true; } });
  assert.deepStrictEqual([r.ok, r.action, ran], [true, "đang chạy", false]);
});

test("cổng đóng -> chạy script và kiểm lại", async () => {
  let ran = 0, checks = 0;
  const r = await ensureTunnel({
    script: "x.sh",
    check: async () => { checks++; return checks > 1; },
    exec: async () => { ran++; },
  });
  assert.deepStrictEqual([r.ok, r.action, ran, checks], [true, "đã mở lại", 1, 2]);
});

test("script lỗi -> báo hỏng kèm lý do, không ném", async () => {
  const r = await ensureTunnel({ script: "x.sh", check: async () => false, exec: async () => { throw new Error("sai mật khẩu"); } });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes("sai mật khẩu"));
});

test("chạy script xong cổng vẫn đóng -> coi như hỏng", async () => {
  const r = await ensureTunnel({ script: "x.sh", check: async () => false, exec: async () => {} });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes("vẫn đóng"));
});

test("không cấu hình script -> không chạy bừa, báo rõ", async () => {
  const r = await ensureTunnel({ check: async () => false, exec: async () => { throw new Error("không được gọi"); } });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes("chưa cấu hình"));
});
