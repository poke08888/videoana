const { test } = require("node:test");
const assert = require("node:assert");
const { seriesSearchOr, escapeRegex } = require("../util/searchMatch");

const fields = (or) => or.map((c) => Object.keys(c)[0]);

test("tìm cả tên tiếng Việt lẫn bản dịch từng ngôn ngữ", () => {
  const f = fields(seriesSearchOr("rồng"));
  assert.ok(f.includes("name"));
  assert.ok(f.includes("i18n.th.name"));
  assert.ok(f.includes("i18n.id.description"));
  assert.ok(f.includes("nameEn"));
});

test("tìm được cả bằng tên gốc tiếng Trung", () => {
  assert.ok(fields(seriesSearchOr("北境")).includes("nameOriginal"));
});

test("mọi điều kiện dùng chung một regex không phân biệt hoa thường", () => {
  const or = seriesSearchOr("Dragon");
  for (const c of or) {
    const v = Object.values(c)[0];
    assert.strictEqual(v.$regex, "Dragon");
    assert.strictEqual(v.$options, "i");
  }
});

test("ký tự đặc biệt được coi là chữ, không phải cú pháp regex", () => {
  assert.strictEqual(escapeRegex("phim (hay) *"), "phim \\(hay\\) \\*");
  const v = Object.values(seriesSearchOr("a(b")[0])[0];
  assert.strictEqual(v.$regex, "a\\(b");
});

test("từ khoá rỗng hoặc toàn khoảng trắng -> không sinh điều kiện nào", () => {
  assert.deepStrictEqual(seriesSearchOr(""), []);
  assert.deepStrictEqual(seriesSearchOr("   "), []);
  assert.deepStrictEqual(seriesSearchOr(null), []);
});

test("đổi danh sách ngôn ngữ thì điều kiện đổi theo", () => {
  const f = fields(seriesSearchOr("x", ["ja"]));
  assert.ok(f.includes("i18n.ja.name"));
  assert.ok(!f.includes("i18n.th.name"));
});
