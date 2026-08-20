const { test } = require("node:test");
const assert = require("node:assert");
const { classifySeries } = require("../util/classifySeries");
const { CATEGORIES } = require("../util/taxonomy");

const SRC = { name: "Chiến Thần Long Chủ", description: "Chiến thần trở về, giấu thân phận, trừng trị kẻ ác." };
const opts = (ask) => ({ ask, categories: CATEGORIES });

test("xếp được thể loại và thẻ hợp lệ", async () => {
  const r = await classifySeries(SRC, opts(async () => JSON.stringify({
    category: "Cao nhân xuống núi",
    tags: ["Chiến thần", "Giấu thân phận", "Hành động"],
  })));
  assert.strictEqual(r.category, "Cao nhân xuống núi");
  assert.deepStrictEqual(r.tags, ["Chiến thần", "Giấu thân phận", "Hành động"]);
  assert.strictEqual(r.error, "");
});

test("máy tự nghĩ thể loại ngoài danh sách -> KHÔNG nhận, để trống cho người chọn", async () => {
  const r = await classifySeries(SRC, opts(async () => JSON.stringify({ category: "Phim hành động Trung Quốc", tags: ["Chiến thần"] })));
  assert.strictEqual(r.category, "");
  assert.ok(r.error.includes("không xếp được"));
  assert.deepStrictEqual(r.tags, ["Chiến thần"], "thẻ hợp lệ vẫn giữ");
});

test("thẻ lạ bị loại, thẻ trùng bị gộp, tối đa 6 thẻ", async () => {
  const r = await classifySeries(SRC, opts(async () => JSON.stringify({
    category: "Cao nhân xuống núi",
    tags: ["Chiến thần", "chiến thần", "Thẻ tự chế", "Báo thù", "Đô thị", "Hành động", "Hài hước", "Nữ cường", "Cổ trang"],
  })));
  assert.strictEqual(r.tags.length, 6);
  assert.ok(!r.tags.includes("Thẻ tự chế"));
  assert.strictEqual(r.tags.filter((t) => t === "Chiến thần").length, 1);
});

test("so tên không phân biệt hoa thường và khoảng trắng thừa", async () => {
  const r = await classifySeries(SRC, opts(async () => JSON.stringify({ category: "  cao nhân XUỐNG núi ", tags: [] })));
  assert.strictEqual(r.category, "Cao nhân xuống núi");
});

test("Gemini lỗi -> không ném, trả rỗng kèm lý do", async () => {
  const r = await classifySeries(SRC, opts(async () => { throw new Error("timeout"); }));
  assert.strictEqual(r.category, "");
  assert.ok(r.error.includes("timeout"));
});

test("JSON rác -> trả rỗng", async () => {
  const r = await classifySeries(SRC, opts(async () => "tôi nghĩ phim này thuộc thể loại hành động"));
  assert.strictEqual(r.category, "");
  assert.deepStrictEqual(r.tags, []);
});

test("thiếu tên phim, thiếu danh sách thể loại, thiếu key -> báo đúng lý do", async () => {
  assert.strictEqual((await classifySeries({ name: "" }, opts(async () => "{}"))).error, "thiếu tên phim");
  assert.strictEqual((await classifySeries(SRC, { ask: async () => "{}", categories: [] })).error, "chưa có thể loại nào để xếp");
  assert.strictEqual((await classifySeries(SRC, { categories: CATEGORIES })).error, "thiếu geminiApiKey");
});

test("lượt đầu bỏ trống -> hỏi lại lần hai bắt buộc chọn", async () => {
  let n = 0;
  const r = await classifySeries(SRC, {
    categories: CATEGORIES,
    ask: async (prompt) => {
      n++;
      if (n === 1) return JSON.stringify({ category: "", tags: ["Chiến thần"] });
      assert.ok(prompt.includes("BẮT BUỘC"), "lượt hai phải ép chọn");
      return JSON.stringify({ category: "Cao nhân xuống núi", tags: ["Chiến thần", "Đô thị"] });
    },
  });
  assert.strictEqual(n, 2);
  assert.strictEqual(r.category, "Cao nhân xuống núi");
  assert.strictEqual(r.error, "");
});

test("xếp được ngay lượt đầu thì KHÔNG hỏi lại", async () => {
  let n = 0;
  await classifySeries(SRC, {
    categories: CATEGORIES,
    ask: async () => { n++; return JSON.stringify({ category: "Cao nhân xuống núi", tags: [] }); },
  });
  assert.strictEqual(n, 1);
});

test("cả hai lượt đều hụt -> giữ thẻ của lượt đầu, báo chưa xếp được", async () => {
  const r = await classifySeries(SRC, {
    categories: CATEGORIES,
    ask: async () => JSON.stringify({ category: "Thể loại tự chế", tags: ["Chiến thần"] }),
  });
  assert.strictEqual(r.category, "");
  assert.deepStrictEqual(r.tags, ["Chiến thần"]);
  assert.ok(r.error.includes("không xếp được"));
});
