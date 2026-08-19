const { test } = require("node:test");
const assert = require("node:assert");
const { opsAuth } = require("../util/opsAuth");

function fakeRes() {
  return {
    code: 0,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test("đúng khoá -> gọi next()", () => {
  process.env.OPS_PASSWORD = "mat-khau-test";
  const res = fakeRes();
  let called = false;
  opsAuth()({ headers: { "ops-key": "mat-khau-test" } }, res, () => { called = true; });
  assert.strictEqual(called, true);
  assert.strictEqual(res.code, 0);
});

test("sai khoá -> 401, không gọi next()", () => {
  process.env.OPS_PASSWORD = "mat-khau-test";
  const res = fakeRes();
  let called = false;
  opsAuth()({ headers: { "ops-key": "sai" } }, res, () => { called = true; });
  assert.strictEqual(called, false);
  assert.strictEqual(res.code, 401);
});

test("thiếu header -> 401", () => {
  process.env.OPS_PASSWORD = "mat-khau-test";
  const res = fakeRes();
  opsAuth()({ headers: {} }, res, () => {});
  assert.strictEqual(res.code, 401);
});

test("server chưa cấu hình OPS_PASSWORD -> 503, không cho lọt", () => {
  delete process.env.OPS_PASSWORD;
  const res = fakeRes();
  let called = false;
  opsAuth()({ headers: { "ops-key": "" } }, res, () => { called = true; });
  assert.strictEqual(called, false);
  assert.strictEqual(res.code, 503);
});
