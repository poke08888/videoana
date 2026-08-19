const { test } = require("node:test");
const assert = require("node:assert");
const { checkTrack, langName, isSupported } = require("../util/langRules");

const segs = (arr) => arr.map((t, i) => ({ start: i, end: i + 1, text: t }));

test("bản Việt sạch chữ Hán -> nhận", () => {
  const r = checkTrack("vi", segs(["Chào anh", "Đi thôi", "Được rồi"]), 3);
  assert.strictEqual(r.ok, true);
});

test("thiếu dòng so với OCR -> loại", () => {
  const r = checkTrack("vi", segs(["Chào anh"]), 3);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes("số cue"));
});

test("còn chữ Hán quá ngưỡng -> loại", () => {
  const r = checkTrack("en", segs(["Hello", "新任龙头", "走吧", "好的"]), 4);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes("chữ Hán"));
});

test("một dòng Hán lẫn trong 40 dòng -> vẫn nhận (dưới 5%)", () => {
  const arr = Array.from({ length: 40 }, (_, i) => (i === 7 ? "好的" : "Hello there"));
  assert.strictEqual(checkTrack("en", segs(arr), 40).ok, true);
});

test("Thái: đúng bảng chữ Thái -> nhận", () => {
  const r = checkTrack("th", segs(["สวัสดีครับ", "ไปกันเถอะ", "ได้เลย"]), 3);
  assert.strictEqual(r.ok, true);
});

test("Thái: model trả tiếng Anh (không có chữ Hán) -> vẫn phải loại", () => {
  const r = checkTrack("th", segs(["Hello there", "Let us go", "All right"]), 3);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes("sai bảng chữ"));
});

test("Indonesia dùng chữ Latin -> không đòi bảng chữ riêng", () => {
  const r = checkTrack("id", segs(["Halo", "Ayo pergi", "Baiklah"]), 3);
  assert.strictEqual(r.ok, true);
});

test("tên ngôn ngữ để nhắc model, mã lạ thì trả lại chính nó", () => {
  assert.strictEqual(langName("th"), "tiếng Thái (ภาษาไทย)");
  assert.strictEqual(langName("xx"), "xx");
  assert.strictEqual(isSupported("id"), true);
  assert.strictEqual(isSupported("xx"), false);
});
