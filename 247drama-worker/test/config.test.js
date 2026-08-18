const { test } = require("node:test");
const assert = require("node:assert");
const { buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig } = require("../config");

test("buildFilename khớp format server", () => {
  assert.strictEqual(buildFilename("hg", "7661582233639062553", 58), "hg_7661582233639062553_ep58.mp4");
  assert.strictEqual(buildFilename("hm", "12345", 0), "hm_12345_ep0.mp4");
});

test("buildR2Key = prefix + filename", () => {
  process.env.R2_KEY_PREFIX = "videos";
  assert.strictEqual(buildR2Key("hg", "7661582233639062553", 58), "videos/hg_7661582233639062553_ep58.mp4");
});

test("buildVideoUrl trỏ R2 public base", () => {
  process.env.R2_KEY_PREFIX = "videos";
  process.env.R2_PUBLIC_BASE = "https://pub-abc123.r2.dev";
  assert.strictEqual(
    buildVideoUrl("hg", "7661582233639062553", 58),
    "https://pub-abc123.r2.dev/videos/hg_7661582233639062553_ep58.mp4",
  );
});

test("mode mặc định là burn", () => {
  assert.strictEqual(buildSubtitleConfig({}).mode, "burn");
  assert.strictEqual(buildSubtitleConfig({ subtitle: {} }).mode, "burn");
  assert.strictEqual(buildSubtitleConfig({ subtitle: { mode: "linh tinh" } }).mode, "burn");
});

test("mode soft khi setting ghi đúng chữ soft", () => {
  assert.strictEqual(buildSubtitleConfig({ subtitle: { mode: "soft" } }).mode, "soft");
});

test("secondLang mặc định en", () => {
  assert.strictEqual(buildSubtitleConfig({}).secondLang, "en");
  assert.strictEqual(buildSubtitleConfig({ subtitle: { secondLang: "th" } }).secondLang, "th");
});
