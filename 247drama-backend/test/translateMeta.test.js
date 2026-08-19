const { test } = require("node:test");
const assert = require("node:assert");
const { translateSeriesMeta } = require("../util/translateMeta");

const SRC = { name: "北境战神第2部", description: "白九霄五年前为爱顶罪" };
const GOOD = JSON.stringify({
  vi: { name: "Chiến Thần Bắc Cảnh 2", description: "Bạch Cửu Tiêu năm năm trước nhận tội thay người mình yêu" },
  en: { name: "War God of the North 2", description: "Bai Jiuxiao took the blame five years ago" },
});

test("dịch được -> trả bản vi + en, ok", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => GOOD });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.vi.name, "Chiến Thần Bắc Cảnh 2");
  assert.strictEqual(r.en.name, "War God of the North 2");
  assert.strictEqual(r.error, "");
});

test("bọc trong ```json vẫn đọc được", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => "```json\n" + GOOD + "\n```" });
  assert.strictEqual(r.ok, true);
});

test("model trả nguyên tên tiếng Trung -> coi như chưa dịch, giữ gốc", async () => {
  const raw = JSON.stringify({ vi: { name: "北境战神第2部", description: "x" }, en: { name: "War God 2", description: "y" } });
  const r = await translateSeriesMeta(SRC, { ask: async () => raw });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.vi.name, SRC.name);
  assert.ok(r.error.includes("chữ Hán"));
});

test("thiếu một ngôn ngữ -> không nhận nửa vời", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => JSON.stringify({ vi: { name: "Tên Việt" } }) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.en.name, SRC.name);
});

test("Gemini lỗi mạng -> giữ gốc, KHÔNG ném lỗi (không chặn nhập phim)", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => { throw new Error("timeout"); } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.vi.name, SRC.name);
  assert.ok(r.error.includes("timeout"));
});

test("JSON rác -> giữ gốc", async () => {
  const r = await translateSeriesMeta(SRC, { ask: async () => "xin lỗi tôi không thể" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.en.description, SRC.description);
});

test("thiếu tên nguồn hoặc thiếu key -> giữ gốc, báo lý do", async () => {
  const a = await translateSeriesMeta({ name: "", description: "x" }, { ask: async () => GOOD });
  assert.strictEqual(a.error, "thiếu tên phim");
  const b = await translateSeriesMeta(SRC, {});
  assert.strictEqual(b.error, "thiếu geminiApiKey");
});

test("mô tả gốc rỗng -> bản dịch rỗng, vẫn tính là xong", async () => {
  const raw = JSON.stringify({ vi: { name: "Tên Việt", description: "" }, en: { name: "English Name", description: "" } });
  const r = await translateSeriesMeta({ name: "北境", description: "" }, { ask: async () => raw });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.vi.description, "");
});
