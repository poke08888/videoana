const { test } = require("node:test");
const assert = require("node:assert");
const { pickHgStream } = require("../util/hgStream");

const s = (definition, codec_type) => ({ definition, codec_type, main_url: `http://x/${definition}-${codec_type}` });

test("có luồng thường + đúng độ phân giải -> lấy đúng luồng đó", () => {
  const r = pickHgStream([s("720p", "bytevc1"), s("1080p", "h264"), s("1080p", "bytevc1")], "1080p");
  assert.strictEqual(r.codecType, "h264");
  assert.strictEqual(r.stream.definition, "1080p");
  assert.strictEqual(r.decodable, true);
});

test("chỉ có luồng thường ở độ phân giải khác -> vẫn ưu tiên codec hơn độ phân giải", () => {
  const r = pickHgStream([s("1080p", "bytevc1"), s("480p", "h264")], "1080p");
  assert.strictEqual(r.codecType, "h264");
  assert.strictEqual(r.stream.definition, "480p");
});

test("mọi luồng đều bytevc1 -> báo không giải mã được để caller đi đường khác", () => {
  const r = pickHgStream([s("720p", "bytevc1"), s("480p", "bytevc1")], "1080p");
  assert.strictEqual(r.decodable, false);
  assert.strictEqual(r.codecType, "bytevc1");
  assert.ok(r.stream, "vẫn trả luồng để dùng khi đường kia cũng hỏng");
});

test("không có độ phân giải mong muốn -> lấy luồng dùng được đầu tiên", () => {
  const r = pickHgStream([s("360p", "h264"), s("720p", "h264")], "1080p");
  assert.strictEqual(r.stream.definition, "360p");
});

test("danh sách rỗng hoặc hỏng -> không nổ", () => {
  for (const v of [[], null, undefined, [{ definition: "720p" }]]) {
    const r = pickHgStream(v, "1080p");
    assert.strictEqual(r.stream, null);
    assert.strictEqual(r.decodable, false);
  }
});

test("codec viết hoa vẫn nhận ra là bytevc1", () => {
  assert.strictEqual(pickHgStream([s("720p", "ByteVC1")], "720p").decodable, false);
});
