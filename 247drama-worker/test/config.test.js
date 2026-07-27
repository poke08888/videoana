const { test } = require("node:test");
const assert = require("node:assert");
const { buildFilename, buildVideoUrl } = require("../config");

test("buildFilename khớp format server", () => {
  assert.strictEqual(buildFilename("hg", "7661582233639062553", 58), "hg_7661582233639062553_ep58.mp4");
  assert.strictEqual(buildFilename("hm", "12345", 0), "hm_12345_ep0.mp4");
});

test("buildVideoUrl khớp URL server", () => {
  process.env.baseURL = "http://103.179.185.196";
  assert.strictEqual(
    buildVideoUrl("hg", "7661582233639062553", 58),
    "http://103.179.185.196/uploads/hg_7661582233639062553_ep58.mp4",
  );
});
