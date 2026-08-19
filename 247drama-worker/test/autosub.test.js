const { test } = require("node:test");
const assert = require("node:assert");
const { translateBoth } = require("../util/autosub");

const ZH = [{ start: 0, end: 1, text: "你好" }];

test("dịch cả 2 nhánh từ tiếng Trung gốc, không dịch chuyền vi->en", async () => {
  const calls = [];
  const fake = async (segs, opts) => {
    calls.push({ src: opts.sourceLang, dst: opts.targetLang, text: segs[0].text });
    return [{ ...segs[0], text: `[${opts.targetLang}]` }];
  };
  const r = await translateBoth(ZH, { apiKey: "k", secondLang: "en", translateFn: fake });
  assert.strictEqual(r.viSegs[0].text, "[vi]");
  assert.strictEqual(r.enSegs[0].text, "[en]");
  assert.deepStrictEqual(calls.map((c) => c.src), ["zh", "zh"]);
  assert.deepStrictEqual(calls.map((c) => c.text), ["你好", "你好"]);
});

test("nhánh en lỗi -> vẫn có vi, enSegs rỗng", async () => {
  const fake = async (segs, opts) => {
    if (opts.targetLang === "en") throw new Error("Gemini 429");
    return [{ ...segs[0], text: "chào" }];
  };
  const r = await translateBoth(ZH, { apiKey: "k", secondLang: "en", translateFn: fake });
  assert.strictEqual(r.viSegs[0].text, "chào");
  assert.deepStrictEqual(r.enSegs, []);
});

test("nhánh vi lỗi -> ném lỗi cho caller fallback", async () => {
  const fake = async (segs, opts) => {
    if (opts.targetLang === "vi") throw new Error("Gemini 500");
    return [{ ...segs[0], text: "hi" }];
  };
  await assert.rejects(
    () => translateBoth(ZH, { apiKey: "k", secondLang: "en", translateFn: fake }),
    /Gemini 500/,
  );
});

test("secondLang rỗng -> chỉ dịch 1 nhánh", async () => {
  let n = 0;
  const fake = async (segs) => { n++; return [{ ...segs[0], text: "x" }]; };
  const r = await translateBoth(ZH, { apiKey: "k", secondLang: "", translateFn: fake });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(r.enSegs, []);
});

const { hanRatio } = require("../util/autosub");

test("hanRatio: bản dịch thật -> 0, bản chưa dịch -> 1", () => {
  assert.strictEqual(hanRatio([{ text: "Xin chào" }, { text: "Tạm biệt" }]), 0);
  assert.strictEqual(hanRatio([{ text: "你好" }, { text: "再见" }]), 1);
});

test("hanRatio: mảng rỗng hoặc toàn dòng trắng -> 1 (coi như chưa dịch)", () => {
  assert.strictEqual(hanRatio([]), 1);
  assert.strictEqual(hanRatio(null), 1);
  assert.strictEqual(hanRatio([{ text: "  " }]), 1);
});

test("hanRatio: lẫn lộn -> đúng tỉ lệ", () => {
  assert.strictEqual(hanRatio([{ text: "你好" }, { text: "Xin chào" }]), 0.5);
  assert.strictEqual(hanRatio([{ text: "你好" }, { text: "A" }, { text: "B" }, { text: "C" }]), 0.25);
});
