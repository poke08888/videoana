import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLE, parseWindowsDays } from "./config.js";

test("STYLE giữ nguyên giá trị mặc định", () => {
  assert.equal(STYLE.pickCount, 30, "pickCount phải mặc định 30");
  assert.deepEqual(STYLE.windowsDays, [90, 180, 365], "windowsDays phải mặc định [90,180,365]");
  assert.equal(STYLE.silenceDb, -35, "silenceDb phải mặc định -35 (âm)");
  assert.equal(STYLE.outlierMinN, 5, "outlierMinN phải mặc định 5");
  assert.ok(STYLE.engine === "gemini" || STYLE.engine === "fake", "engine phải là 'gemini' hoặc 'fake'");
});

test("parseWindowsDays: bỏ giá trị không phải số, sắp tăng dần", () => {
  assert.deepEqual(parseWindowsDays("180, x,90", [1, 2, 3]), [90, 180], "phải lọc 'x' và sắp tăng dần");
});

test("parseWindowsDays: rỗng → trả về default", () => {
  assert.deepEqual(parseWindowsDays("", [90, 180, 365]), [90, 180, 365], "chuỗi rỗng phải trả default");
});

test("parseWindowsDays: undefined → trả về default", () => {
  assert.deepEqual(parseWindowsDays(undefined, [90, 180, 365]), [90, 180, 365], "undefined phải trả default");
});
