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

// Bug #1 (Critical): làm tròn mili-giây kiểu cũ (floor giờ/phút/giây, round mili-giây
// riêng) khiến phần thập phân >= 0.9995 cho ra ms=1000 mà không cộng dồn sang giây.
test("mili-giây tràn lên giây không bị kẹt ở .1000", () => {
  const out = segsToVtt([{ start: 1.9996, end: 2, text: "X" }]);
  assert.ok(out.includes("00:00:02.000 --> 00:00:02.000"), out);
  assert.ok(!out.includes(".1000"), out);
});

test("mili-giây tràn lên giây (giá trị lớn hơn)", () => {
  const out = segsToVtt([{ start: 0, end: 12.9997, text: "X" }]);
  assert.ok(out.includes("--> 00:00:13.000"), out);
  assert.ok(!out.includes(".1000"), out);
});

test("mili-giây tràn lên phút (59.9999 -> 00:01:00.000)", () => {
  const out = segsToVtt([{ start: 0, end: 59.9999, text: "X" }]);
  assert.ok(out.includes("--> 00:01:00.000"), out);
});

test("mili-giây tràn lên giờ (3599.9999 -> 01:00:00.000)", () => {
  const out = segsToVtt([{ start: 0, end: 3599.9999, text: "X" }]);
  assert.ok(out.includes("--> 01:00:00.000"), out);
});

// Bug #2 (Important): text phụ đề chứa &, <, > phải được escape đúng thứ tự để không
// bị parser WebVTT hiểu nhầm thành markup (đặc biệt dấu <).
test("escape ký tự đặc biệt WebVTT (&, <, >) đúng thứ tự", () => {
  const out = segsToVtt([{ start: 0, end: 1, text: "A & B <C> D" }]);
  assert.ok(out.includes("A &amp; B &lt;C&gt; D"), out);
  assert.ok(!out.includes("<C>"), out);
});

// Bug #3 (Important): khoá lại quy tắc WebVTT bắt buộc phải có 1 dòng trống giữa 2 cue.
test("giữ >= 2 cue: có đúng 1 dòng trống ngăn cách giữa hai cue", () => {
  const out = segsToVtt([
    { start: 0, end: 1, text: "Cue 1" },
    { start: 1, end: 2, text: "Cue 2" },
  ]);
  assert.strictEqual(
    out,
    "WEBVTT\n\n" +
      "00:00:00.000 --> 00:00:01.000\nCue 1\n" +
      "\n" +
      "00:00:01.000 --> 00:00:02.000\nCue 2\n"
  );
  // Khẳng định cụ thể chuỗi ngăn cách: text cue 1 + dòng trống + timestamp cue 2
  assert.ok(out.includes("Cue 1\n\n00:00:01.000 --> 00:00:02.000"), out);
});
