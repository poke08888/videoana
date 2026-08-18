const { test } = require("node:test");
const assert = require("node:assert");
const { segsToVtt } = require("../util/vtt");

test("sinh header WEBVTT + timestamp đúng định dạng", () => {
  const out = segsToVtt([{ start: 0, end: 1.5, text: "Xin chào" }]);
  assert.strictEqual(out, "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nXin chào\n");
});

test("giờ/phút/giây > 60 quy đổi đúng", () => {
  const out = segsToVtt([{ start: 3661.25, end: 3662, text: "A" }]);
  assert.ok(out.includes("01:01:01.250 --> 01:01:02.000"), out);
});

test("offsetSec dịch toàn bộ mốc thời gian", () => {
  const out = segsToVtt([{ start: 1, end: 2, text: "A" }], { offsetSec: 0.5 });
  assert.ok(out.includes("00:00:01.500 --> 00:00:02.500"), out);
});

test("mốc âm sau khi dịch bị kẹp về 0", () => {
  const out = segsToVtt([{ start: 0.2, end: 1, text: "A" }], { offsetSec: -1 });
  assert.ok(out.includes("00:00:00.000 --> 00:00:00.000"), out);
});

test("bỏ dòng rỗng, giữ dòng có chữ", () => {
  const out = segsToVtt([
    { start: 0, end: 1, text: "  " },
    { start: 1, end: 2, text: "Có chữ" },
  ]);
  assert.ok(!out.includes("00:00:00.000 --> 00:00:01.000"), out);
  assert.ok(out.includes("Có chữ"), out);
});

test("mảng rỗng trả chuỗi rỗng", () => {
  assert.strictEqual(segsToVtt([]), "");
  assert.strictEqual(segsToVtt(null), "");
});

test("xuống dòng trong text giữ nguyên, dòng trắng bị gộp", () => {
  const out = segsToVtt([{ start: 0, end: 1, text: "Dòng 1\n\nDòng 2" }]);
  assert.ok(out.includes("Dòng 1\nDòng 2"), out);
});
