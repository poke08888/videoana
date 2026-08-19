import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, retryDelayMs, StudioError, humanKind } from "./errors.js";

test("phân loại đúng 5 nhóm lỗi", () => {
  assert.equal(classifyError(new Error("429 RESOURCE_EXHAUSTED: quota exceeded")), "quota");
  assert.equal(classifyError(new Error("503 UNAVAILABLE model overloaded")), "quota");
  assert.equal(classifyError(new Error("Response blocked by SAFETY filters")), "blocked");
  assert.equal(classifyError(new Error("fetch failed ECONNRESET")), "network");
  assert.equal(classifyError(new Error("500 Internal error")), "network");
  assert.equal(classifyError(new Error("403 PERMISSION_DENIED: API key not valid")), "billing");
  assert.equal(classifyError(new Error("something odd")), "other");
});

test("StudioError giữ nguyên kind của nó", () => {
  assert.equal(classifyError(new StudioError("blocked", "x")), "blocked");
});

test("blocked/billing KHÔNG được thử lại; quota có backoff; network tối đa 2 lần", () => {
  assert.equal(retryDelayMs("blocked", 0), null);
  assert.equal(retryDelayMs("billing", 0), null);
  assert.ok((retryDelayMs("quota", 0) ?? 0) > 0);
  assert.ok((retryDelayMs("quota", 1) ?? 0) > (retryDelayMs("quota", 0) ?? 0));
  assert.equal(retryDelayMs("quota", 4), null);
  assert.ok((retryDelayMs("network", 1) ?? 0) > 0);
  assert.equal(retryDelayMs("network", 2), null);
  assert.ok((retryDelayMs("other", 0) ?? 0) > 0);
  assert.equal(retryDelayMs("other", 1), null);
});

test("humanKind có chữ tiếng Việt cho mọi kind", () => {
  for (const k of ["quota", "blocked", "network", "billing", "other"] as const) assert.ok(humanKind(k).length > 5);
});
