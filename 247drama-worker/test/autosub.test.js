const { test } = require("node:test");
const assert = require("node:assert");
const { translateAll, translateTracks } = require("../util/autosub");

const ZH = [{ start: 0, end: 1, text: "你好" }];

test("dịch mọi ngôn ngữ từ tiếng Trung gốc, không dịch chuyền vi->en", async () => {
  const calls = [];
  const fake = async (segs, opts) => {
    calls.push({ src: opts.sourceLang, dst: opts.targetLang, text: segs[0].text });
    return [{ ...segs[0], text: `[${opts.targetLang}]` }];
  };
  const r = await translateAll(ZH, { apiKey: "k", langs: ["vi", "en", "th"], translateFn: fake });
  assert.strictEqual(r.vi[0].text, "[vi]");
  assert.strictEqual(r.en[0].text, "[en]");
  assert.strictEqual(r.th[0].text, "[th]");
  assert.deepStrictEqual(calls.map((c) => c.src), ["zh", "zh", "zh"]);
  assert.deepStrictEqual(calls.map((c) => c.text), ["你好", "你好", "你好"]);
});

test("một ngôn ngữ phụ lỗi -> track đó rỗng, các ngôn ngữ khác vẫn có", async () => {
  const fake = async (segs, opts) => {
    if (opts.targetLang === "en") throw new Error("Gemini 429");
    return [{ ...segs[0], text: "chào" }];
  };
  const r = await translateAll(ZH, { apiKey: "k", langs: ["vi", "en"], translateFn: fake });
  assert.strictEqual(r.vi[0].text, "chào");
  assert.deepStrictEqual(r.en, []);
});

test("ngôn ngữ chính lỗi -> ném lỗi cho caller fallback", async () => {
  const fake = async (segs, opts) => {
    if (opts.targetLang === "vi") throw new Error("Gemini 500");
    return [{ ...segs[0], text: "hi" }];
  };
  await assert.rejects(
    () => translateAll(ZH, { apiKey: "k", langs: ["vi", "en"], translateFn: fake }),
    /Gemini 500/,
  );
});

test("chỉ một ngôn ngữ -> chỉ gọi model một lần", async () => {
  let n = 0;
  const fake = async (segs) => { n++; return [{ ...segs[0], text: "x" }]; };
  const r = await translateAll(ZH, { apiKey: "k", langs: ["vi"], translateFn: fake });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(Object.keys(r), ["vi"]);
});

test("ngôn ngữ phụ hụt -> dịch LẠI một lần, lần sau đạt thì vẫn có track", async () => {
  let enCalls = 0;
  const fake = async (segs, opts) => {
    if (opts.targetLang === "en") {
      enCalls++;
      return [{ ...segs[0], text: enCalls === 1 ? "你好" : "Hello" }];
    }
    return [{ ...segs[0], text: "Chào" }];
  };
  const r = await translateTracks(ZH, { apiKey: "k", langs: ["vi", "en"], primary: "vi", translateFn: fake });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(enCalls, 2, "phải dịch lại đúng một lần");
  assert.strictEqual(r.accepted.en[0].text, "Hello");
  assert.deepStrictEqual(r.dropped, []);
});

test("ngôn ngữ phụ hụt cả hai lần -> bỏ track đó, tập vẫn lên", async () => {
  const fake = async (segs, opts) =>
    [{ ...segs[0], text: opts.targetLang === "th" ? "你好" : "Chào" }];
  const r = await translateTracks(ZH, { apiKey: "k", langs: ["vi", "th"], primary: "vi", translateFn: fake });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(Object.keys(r.accepted), ["vi"]);
  assert.strictEqual(r.dropped[0].lang, "th");
});

test("ngôn ngữ chính hụt -> cả tập không đạt, không dịch lại lắt nhắt", async () => {
  const fake = async (segs) => [{ ...segs[0], text: "你好" }];
  const r = await translateTracks(ZH, { apiKey: "k", langs: ["vi", "en"], primary: "vi", translateFn: fake });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /vi/);
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

const { acceptTracks } = require("../util/autosub");

const VI3 = [{ text: "Một" }, { text: "Hai" }, { text: "Ba" }];
const EN3 = [{ text: "One" }, { text: "Two" }, { text: "Three" }];

test("nghiệm thu: đủ số cue, đã dịch -> đạt cả hai track", () => {
  const r = acceptTracks({ zhCount: 3, tracks: { vi: VI3, en: EN3 }, primary: "vi" });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(Object.keys(r.accepted).sort(), ["en", "vi"]);
});

test("nghiệm thu: ngôn ngữ chính dịch hụt -> cả tập không đạt", () => {
  const vi = [{ text: "Một" }, { text: "你好世界" }, { text: "Ba" }];
  const r = acceptTracks({ zhCount: 3, tracks: { vi, en: EN3 }, primary: "vi" });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /vi/);
});

test("nghiệm thu: thiếu cue so với OCR -> không đạt", () => {
  const r = acceptTracks({ zhCount: 4, tracks: { vi: VI3 }, primary: "vi" });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /số cue/);
});

test("nghiệm thu: track phụ hụt -> tập vẫn đạt nhưng track đó bị loại", () => {
  const en = [{ text: "One" }, { text: "再见" }, { text: "Three" }];
  const r = acceptTracks({ zhCount: 3, tracks: { vi: VI3, en }, primary: "vi" });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(Object.keys(r.accepted), ["vi"]);
  assert.strictEqual(r.dropped[0].lang, "en");
});

test("nghiệm thu: chỉ có ngôn ngữ chính -> đạt", () => {
  const r = acceptTracks({ zhCount: 3, tracks: { vi: VI3 }, primary: "vi" });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(Object.keys(r.accepted), ["vi"]);
});
