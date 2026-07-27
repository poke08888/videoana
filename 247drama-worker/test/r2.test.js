const { test } = require("node:test");
const assert = require("node:assert");

test("r2Client cấu hình đúng cho R2", async () => {
  process.env.R2_ENDPOINT = "https://acc.r2.cloudflarestorage.com";
  process.env.R2_ACCESS_KEY = "ak";
  process.env.R2_SECRET = "sk";
  process.env.R2_BUCKET = "bk";
  delete require.cache[require.resolve("../config")];
  delete require.cache[require.resolve("../util/r2")];
  const { r2Client } = require("../util/r2");
  const c = r2Client();
  const cfg = c.config;
  assert.strictEqual(await cfg.region(), "auto");
  assert.strictEqual(cfg.forcePathStyle, true);
  const ep = await cfg.endpoint();
  assert.strictEqual(ep.hostname, "acc.r2.cloudflarestorage.com");
});
