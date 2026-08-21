const { test } = require("node:test");
const assert = require("node:assert");
const { translateSegments } = require("../util/translate");

const segs = (n) => Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, text: `中文${i + 1}` }));
// Đếm số dòng trong prompt để biết Gemini đang được hỏi lô mấy dòng.
const linesOf = (prompt) => prompt.split("\n").filter((l) => /^\d+\. /.test(l));

test("Gemini trả đúng số dòng -> gán 1:1 theo vị trí", async () => {
  const r = await translateSegments(segs(3), {
    apiKey: "x",
    ask: (p) => JSON.stringify(linesOf(p).map((_, i) => `việt ${i + 1}`)),
  });
  assert.deepStrictEqual(r.map((s) => s.text), ["việt 1", "việt 2", "việt 3"]);
  assert.deepStrictEqual(r.map((s) => s.start), [0, 1, 2]); // timestamp giữ nguyên
});

test("Gemini gộp dòng -> chẻ đôi lô hỏi lại, chỉ câu gây rối mới giữ gốc", async () => {
  // Trả thiếu 1 dòng cho mọi lô có chứa câu số 2; lô khác trả đúng.
  const ask = (p) => {
    const lines = linesOf(p);
    const hasBad = lines.some((l) => l.includes("中文2"));
    const n = hasBad && lines.length > 1 ? lines.length - 1 : lines.length;
    if (hasBad && lines.length === 1) return JSON.stringify([]); // câu số 2: chịu, không dịch được
    return JSON.stringify(Array.from({ length: n }, (_, i) => `v:${lines[i]}`));
  };
  const r = await translateSegments(segs(4), { apiKey: "x", batchSize: 4, ask });
  assert.strictEqual(r[1].text, "中文2", "câu hỏng giữ nguyên tiếng Trung");
  for (const i of [0, 2, 3]) {
    assert.ok(r[i].text.startsWith("v:"), `câu ${i + 1} phải được dịch, đang là ${r[i].text}`);
  }
});

test("một câu mà Gemini trả nhiều mảnh -> nối lại, không rơi câu", async () => {
  const ask = (p) => (linesOf(p).length === 1 ? JSON.stringify(["nửa đầu", "nửa sau"]) : JSON.stringify([]));
  const r = await translateSegments(segs(1), { apiKey: "x", ask });
  assert.strictEqual(r[0].text, "nửa đầu nửa sau");
});

test("gọi Gemini hỏng hoàn toàn -> giữ nguyên toàn bộ câu gốc, không ném lỗi", async () => {
  const r = await translateSegments(segs(2), {
    apiKey: "x",
    ask: () => {
      throw new Error("mạng hỏng");
    },
  });
  assert.deepStrictEqual(r.map((s) => s.text), ["中文1", "中文2"]);
});

test("chẻ lô không làm lệch thứ tự", async () => {
  const ask = (p) => {
    const lines = linesOf(p);
    if (lines.length > 2) return JSON.stringify([]); // ép chẻ tới lô <= 2
    return JSON.stringify(lines.map((l) => "v" + l.replace(/^\d+\. 中文/, "")));
  };
  const r = await translateSegments(segs(8), { apiKey: "x", batchSize: 8, ask });
  assert.deepStrictEqual(r.map((s) => s.text), ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"]);
});

test("không có segment nào -> trả mảng rỗng, không gọi Gemini", async () => {
  let called = 0;
  const r = await translateSegments([], { apiKey: "x", ask: () => (called++, "[]") });
  assert.deepStrictEqual(r, []);
  assert.strictEqual(called, 0);
});
