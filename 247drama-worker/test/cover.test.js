const { test } = require("node:test");
const assert = require("node:assert");
const { mirrorCover, coverKey, coverUrl, isMirrored, sniffImageType } = require("../util/cover");

const BASE = "https://cdn.247tv.app";
const jpeg = (n = 40) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]);

test("khoá và link ảnh theo phim", () => {
  assert.strictEqual(coverKey("hg", "123"), "covers/hg_123.jpg");
  assert.strictEqual(coverUrl("hg", "123", BASE), "https://cdn.247tv.app/covers/hg_123.jpg");
});

test("phân biệt ảnh của mình với ảnh nguồn ngoài", () => {
  assert.strictEqual(isMirrored("https://cdn.247tv.app/covers/hg_1.jpg", BASE), true);
  assert.strictEqual(isMirrored("https://p6-novel.byteimg.com/origin/novel-pic/abc", BASE), false);
  assert.strictEqual(isMirrored("http://103.179.185.196/uploads/cover_hg_1.jpg", BASE), false);
  assert.strictEqual(isMirrored("", BASE), false);
  // video nằm cùng CDN nhưng khác thư mục -> không tính là ảnh đã sao
  assert.strictEqual(isMirrored("https://cdn.247tv.app/videos/hg_1_ep0.mp4", BASE), false);
});

test("nhận diện ảnh theo byte đầu", () => {
  assert.strictEqual(sniffImageType(jpeg()), "image/jpeg");
  assert.strictEqual(sniffImageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)])), "image/png");
  assert.strictEqual(sniffImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)])), "image/webp");
  assert.strictEqual(sniffImageType(Buffer.from("<html>lỗi 403 nhé</html>")), "");
  assert.strictEqual(sniffImageType(null), "");
});

test("sao ảnh: tải, kiểm, tải lên, trả link của mình", async () => {
  const calls = [];
  const r = await mirrorCover({
    provider: "hg", sourceId: "9", url: "https://x/a.jpg",
    download: async (u) => { calls.push(u); return jpeg(100); },
    upload: async (buf, key, ct, opts) => { calls.push([key, ct, opts.cacheControl]); },
  });
  assert.strictEqual(r.contentType, "image/jpeg");
  assert.strictEqual(calls[0], "https://x/a.jpg");
  assert.deepStrictEqual(calls[1], ["covers/hg_9.jpg", "image/jpeg", "public, max-age=31536000, immutable"]);
  assert.ok(r.url.endsWith("/covers/hg_9.jpg"));
});

test("nguồn trả HTML lỗi -> KHÔNG tải lên, ném lỗi rõ ràng", async () => {
  let uploaded = false;
  await assert.rejects(
    () => mirrorCover({ provider: "hg", sourceId: "9", url: "u", download: async () => Buffer.from("<html>403</html>"), upload: async () => { uploaded = true; } }),
    /không phải ảnh/
  );
  assert.strictEqual(uploaded, false);
});

test("thiếu link ảnh, ảnh rỗng, ảnh quá lớn -> báo lỗi, không tải lên", async () => {
  await assert.rejects(() => mirrorCover({ provider: "hg", sourceId: "9", url: "", download: async () => jpeg() }), /không có ảnh bìa/);
  await assert.rejects(() => mirrorCover({ provider: "hg", sourceId: "9", url: "u", download: async () => Buffer.alloc(0) }), /rỗng/);
  await assert.rejects(
    () => mirrorCover({ provider: "hg", sourceId: "9", url: "u", download: async () => Buffer.concat([jpeg(), Buffer.alloc(9 * 1024 * 1024)]) }),
    /quá lớn/
  );
});
