const { test } = require("node:test");
const assert = require("node:assert");
const { normalizeDlKeyword } = require("../util/dlKeyword");

test("bỏ dấu tiếng Việt và bỏ khoảng trắng", () => {
  assert.strictEqual(normalizeDlKeyword("chiến thần"), "chienthan");
  assert.strictEqual(normalizeDlKeyword("Đường Về Nhà"), "DuongVeNha");
});

test("chữ Hán giữ nguyên, chỉ bỏ khoảng trắng", () => {
  assert.strictEqual(normalizeDlKeyword("战神"), "战神");
  assert.strictEqual(normalizeDlKeyword("龙 主"), "龙主");
});

test("từ khoá rỗng hoặc toàn khoảng trắng -> chuỗi rỗng để caller khỏi gọi API", () => {
  assert.strictEqual(normalizeDlKeyword(""), "");
  assert.strictEqual(normalizeDlKeyword("   "), "");
  assert.strictEqual(normalizeDlKeyword(null), "");
});

test("ký tự lạ ngoài ASCII bị bỏ, không làm API trả lỗi", () => {
  assert.strictEqual(normalizeDlKeyword("phim 🎬 hay"), "phimhay");
});

test("từ khoá vốn đã hợp lệ thì giữ nguyên", () => {
  assert.strictEqual(normalizeDlKeyword("chienthan"), "chienthan");
  assert.strictEqual(normalizeDlKeyword("abc123"), "abc123");
});
