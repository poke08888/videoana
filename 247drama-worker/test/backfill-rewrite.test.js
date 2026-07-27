const { test } = require("node:test");
const assert = require("node:assert");
const { rewriteUploadsUrl } = require("../scripts/backfill-r2");

test("rewrite /uploads -> r2 giữ nguyên filename", () => {
  assert.strictEqual(
    rewriteUploadsUrl("http://103.179.185.196/uploads/hg_123_ep5.mp4", "https://pub-x.r2.dev", "videos"),
    "https://pub-x.r2.dev/videos/hg_123_ep5.mp4",
  );
});

test("URL không phải /uploads -> giữ nguyên", () => {
  assert.strictEqual(
    rewriteUploadsUrl("https://pub-x.r2.dev/videos/hg_123_ep5.mp4", "https://pub-x.r2.dev", "videos"),
    "https://pub-x.r2.dev/videos/hg_123_ep5.mp4",
  );
});
