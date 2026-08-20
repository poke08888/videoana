const { test } = require("node:test");
const assert = require("node:assert");
const { toChineseKeyword, _cache } = require("../util/keywordZh");

test("từ khoá tiếng Việt được dịch sang tiếng Trung", async () => {
  _cache.clear();
  const r = await toChineseKeyword("chiến thần", { ask: async () => "战神" });
  assert.deepStrictEqual(r, { keyword: "战神", translated: true });
});

test("từ khoá đã là tiếng Trung -> giữ nguyên, KHÔNG gọi model", async () => {
  _cache.clear();
  let goi = 0;
  const r = await toChineseKeyword("战神", { ask: async () => { goi++; return "x"; } });
  assert.deepStrictEqual(r, { keyword: "战神", translated: false });
  assert.strictEqual(goi, 0);
});

test("model trả kèm giải thích -> chỉ giữ chữ Hán", async () => {
  _cache.clear();
  const r = await toChineseKeyword("tổng tài", { ask: async () => "总裁 (zǒngcái) — nghĩa là ông chủ.\n" });
  assert.strictEqual(r.keyword, "总裁");
});

test("hỏi lần hai lấy từ bộ nhớ, không gọi model lại", async () => {
  _cache.clear();
  let goi = 0;
  const ask = async () => { goi++; return "重生"; };
  await toChineseKeyword("trùng sinh", { ask });
  const r = await toChineseKeyword("Trùng Sinh", { ask });
  assert.strictEqual(goi, 1);
  assert.strictEqual(r.keyword, "重生");
});

test("model lỗi hoặc trả rác -> tìm bằng từ gốc, không chặn người dùng", async () => {
  _cache.clear();
  const a = await toChineseKeyword("abc", { ask: async () => { throw new Error("hết quota"); } });
  assert.deepStrictEqual(a, { keyword: "abc", translated: false });
  const b = await toChineseKeyword("abc", { ask: async () => "sorry I cannot" });
  assert.deepStrictEqual(b, { keyword: "abc", translated: false });
});

test("không có khoá model -> trả từ gốc", async () => {
  _cache.clear();
  assert.deepStrictEqual(await toChineseKeyword("chiến thần", {}), { keyword: "chiến thần", translated: false });
});
