import { test } from "node:test";
import assert from "node:assert/strict";
import { proportionalTimings, groupCues, shiftCues, assTime, toAss, toSrt } from "./subtitles.js";

test("proportionalTimings chia thời lượng theo độ dài chữ, phủ kín 0→dur", () => {
  const w = proportionalTimings("Mở hộp ra thơm", 4);
  assert.equal(w.length, 4);
  assert.equal(w[0].startSec, 0);
  assert.equal(w[3].endSec, 4);
  assert.ok(w[1].startSec >= w[0].endSec - 1e-9);
});

test("groupCues gom theo maxChars và cắt ở dấu câu", () => {
  const w = proportionalTimings("Mở hộp ra. Thơm nức mũi luôn nha mọi người ơi", 6);
  const cues = groupCues(w, 20);
  assert.equal(cues[0].text, "Mở hộp ra.");
  assert.ok(cues.every((c) => c.text.length <= 20 || c.text.split(" ").length === 1));
  assert.equal(cues[cues.length - 1].endSec, 6);
});

test("shiftCues dời mốc", () => {
  const c = shiftCues([{ text: "a", startSec: 1, endSec: 2 }], 7.5);
  assert.deepEqual(c, [{ text: "a", startSec: 8.5, endSec: 9.5 }]);
});

test("assTime định dạng H:MM:SS.cc", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(83.456), "0:01:23.46");
});

test("toAss có PlayRes, BorderStyle=3, font, Dialogue; toSrt đúng thứ tự", () => {
  const cues = [{ text: "Xin {chào}", startSec: 0, endSec: 1.5 }];
  const ass = toAss(cues, { font: "DejaVu Sans", width: 1080, height: 1920 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Style: Default,DejaVu Sans,/);
  assert.match(ass, /,3,\d+,0,2,/); // BorderStyle=3 … Alignment=2
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.50,Default,,0,0,0,,Xin \\\{chào\\\}/);
  assert.match(toSrt(cues), /1\n00:00:00,000 --> 00:00:01,500\nXin \{chào\}/);
});
