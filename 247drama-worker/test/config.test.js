const { test } = require("node:test");
const assert = require("node:assert");
const { buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig, buildSubKey, buildSubUrl } = require("../config");

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

test("key phụ đề đi kèm tên file video, đổi đuôi theo lang (mặc định v1)", () => {
  process.env.R2_KEY_PREFIX = "videos";
  assert.strictEqual(buildSubKey("hg", "123", 0, "vi"), "videos/hg_123_ep0.v1.vi.vtt");
  assert.strictEqual(buildSubKey("hm", "9", 4, "en"), "videos/hm_9_ep4.v1.en.vtt");
});

test("url phụ đề ghép từ R2_PUBLIC_BASE (mặc định v1)", () => {
  process.env.R2_KEY_PREFIX = "videos";
  process.env.R2_PUBLIC_BASE = "https://pub-x.r2.dev";
  assert.strictEqual(buildSubUrl("hg", "123", 0, "en"), "https://pub-x.r2.dev/videos/hg_123_ep0.v1.en.vtt");
});

test("key phụ đề mang số phiên bản", () => {
  process.env.R2_KEY_PREFIX = "videos";
  assert.strictEqual(buildSubKey("hg", "123", 5, "vi", 2), "videos/hg_123_ep5.v2.vi.vtt");
  assert.strictEqual(buildSubKey("hm", "9", 0, "en", 1), "videos/hm_9_ep0.v1.en.vtt");
});

test("thiếu version -> mặc định v1", () => {
  process.env.R2_KEY_PREFIX = "videos";
  assert.strictEqual(buildSubKey("hg", "123", 5, "vi"), "videos/hg_123_ep5.v1.vi.vtt");
});

test("url phụ đề ghép base + key có phiên bản", () => {
  process.env.R2_KEY_PREFIX = "videos";
  process.env.R2_PUBLIC_BASE = "https://pub-x.r2.dev";
  assert.strictEqual(buildSubUrl("hg", "123", 5, "en", 3), "https://pub-x.r2.dev/videos/hg_123_ep5.v3.en.vtt");
});
