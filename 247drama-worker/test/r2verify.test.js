const { test } = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// Giả lập tầng S3 để kiểm uploadAndVerify mà không đụng R2 thật.
function loadR2(headSize) {
  const orig = Module._load;
  const puts = [];
  Module._load = function (req, parent, isMain) {
    if (req === "@aws-sdk/client-s3") {
      return {
        S3Client: class { async send(cmd) { return cmd._head ? { ContentLength: headSize } : (puts.push(cmd._put), {}); } },
        PutObjectCommand: class { constructor(i) { this._put = i; } },
        HeadObjectCommand: class { constructor(i) { this._head = i; } },
      };
    }
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("/Users/kevin/video/247drama-worker/util/r2.js")];
  const mod = require("/Users/kevin/video/247drama-worker/util/r2.js");
  Module._load = orig;
  return { mod, puts };
}

test("kích thước đọc lại khớp -> qua", async () => {
  const { mod } = loadR2(5);
  await mod.uploadAndVerify(Buffer.from("hello"), "k.mp4", "video/mp4");
});

test("object không tồn tại sau upload -> ném lỗi", async () => {
  const { mod } = loadR2(null);
  await assert.rejects(() => mod.uploadAndVerify(Buffer.from("hello"), "k.mp4", "video/mp4"), /không thấy object/);
});

test("kích thước lệch (bản cũ còn nằm đó) -> ném lỗi", async () => {
  const { mod } = loadR2(999);
  await assert.rejects(() => mod.uploadAndVerify(Buffer.from("hello"), "k.mp4", "video/mp4"), /đã up 5B nhưng đọc lại 999B/);
});

test("cacheControl được chuyển xuống PutObject", async () => {
  const { mod, puts } = loadR2(5);
  await mod.uploadAndVerify(Buffer.from("hello"), "k.vtt", "text/vtt", { cacheControl: "public, max-age=300" });
  assert.strictEqual(puts[0].CacheControl, "public, max-age=300");
});
