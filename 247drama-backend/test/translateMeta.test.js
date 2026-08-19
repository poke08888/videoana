const { test } = require("node:test");
const assert = require("node:assert");
const { translateSeriesMeta } = require("../util/translateMeta");

const SRC = { name: "北境战神第2部", description: "白九霄五年前为爱顶罪" };
const GOOD = JSON.stringify({
  vi: { name: "Chiến Thần Phương Bắc 2", description: "Bạch Cửu Tiêu nhận tội thay người mình yêu" },
  en: { name: "War God of the North 2", description: "Bai Jiuxiao took the blame five years ago" },
  th: { name: "เทพสงครามแห่งเหนือ 2", description: "ไป๋จิ่วเซียวรับผิดแทนคนรัก" },
  id: { name: "Dewa Perang Utara 2", description: "Bai Jiuxiao menanggung kesalahan demi cinta" },
});

test("dịch bốn thứ tiếng -> đủ cả bốn, ok", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => GOOD, langs: ["vi", "en", "th", "id"] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(Object.keys(r.i18n).sort(), ["en", "id", "th", "vi"]);
  assert.strictEqual(r.i18n.th.name, "เทพสงครามแห่งเหนือ 2");
});

test("chỉ xin hai thứ tiếng thì không đòi phần còn lại", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => GOOD, langs: ["vi", "en"] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(Object.keys(r.i18n).sort(), ["en", "vi"]);
});

test("bọc trong ```json vẫn đọc được", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => "```json\n" + GOOD + "\n```", langs: ["vi"] });
  assert.strictEqual(r.ok, true);
});

test("Thái trả về tiếng Anh -> loại riêng ngôn ngữ đó, giữ ngôn ngữ khác", async () => {
  const raw = JSON.stringify({
    vi: { name: "Chiến Thần", description: "mô tả" },
    th: { name: "War God of the North", description: "english" },
  });
  const r = await translateSeriesMeta(SRC, { ask: async () => raw, langs: ["vi", "th"] });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, ["th"]);
  assert.strictEqual(r.i18n.vi.name, "Chiến Thần");
  assert.strictEqual(r.i18n.th, undefined);
});

test("model trả nguyên tên tiếng Trung -> coi như chưa dịch", async () => {
  const raw = JSON.stringify({ vi: { name: "北境战神第2部", description: "x" }, en: { name: "War God 2", description: "y" } });
  const r = await translateSeriesMeta(SRC, { ask: async () => raw, langs: ["vi", "en"] });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, ["vi"]);
  assert.strictEqual(r.i18n.en.name, "War God 2");
});

test("Gemini lỗi mạng -> không ném, báo thiếu hết", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => { throw new Error("timeout"); }, langs: ["vi", "en"] });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, ["vi", "en"]);
  assert.ok(r.error.includes("timeout"));
});

test("JSON rác -> giữ nguyên, không nổ", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => "xin lỗi tôi không thể", langs: ["vi"] });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.i18n, {});
});

test("mã ngôn ngữ lạ bị loại, trùng bị gộp", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => GOOD, langs: ["vi", "xx", "vi", "en"] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(Object.keys(r.i18n).sort(), ["en", "vi"]);
});

test("thiếu tên nguồn / thiếu key -> báo lý do, không gọi model", async () => {
  const a = await translateSeriesMeta({ name: "", description: "x" }, { ask: async () => GOOD });
  assert.strictEqual(a.error, "thiếu tên phim");
  const b = await translateSeriesMeta(SRC, {});
  assert.strictEqual(b.error, "thiếu geminiApiKey");
});

test("mô tả gốc rỗng -> bản dịch rỗng, vẫn tính là xong", async () => {
  const raw = JSON.stringify({ vi: { name: "Tên Việt", description: "" } });
  const r = await translateSeriesMeta({ name: "北境", description: "" }, { ask: async () => raw, langs: ["vi"] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.i18n.vi.description, "");
});
