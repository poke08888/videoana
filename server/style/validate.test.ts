import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStyle, validateTimeline } from "./validate.js";

test("enum sai → mặc định + warning; đúng → giữ", () => {
  const a = validateStyle({ structure: { hookType: "text-big", layout: "bogus", transitions: [{ at: 1.2, type: "zoom" }, { at: "x", type: "??" }], cutSync: "beat" }, text: { captionStyle: "word-pop", font: { weight: "bold", sizeRel: "huge" } } });
  assert.equal(a.structure.hookType, "text-big");
  assert.equal(a.structure.layout, "other");
  assert.equal(a.structure.transitions.length, 1, "bỏ transition không có at số");
  assert.equal(a.text.font.sizeRel, "med");
  assert.ok(a.warnings.some((w) => /layout/.test(w)), `warnings=${a.warnings}`);
  assert.ok(a.warnings.some((w) => /sizeRel/.test(w)), "phải cảnh báo sizeRel");
});
test("thiếu lớp → lớp rỗng + warning, không throw; ratio kẹp 0–1; mảng enum lọc giá trị lạ", () => {
  const a = validateStyle({ visual: { talkingHeadRatio: 3, angles: ["eye", "weird"], shotSizes: [] } });
  assert.equal(a.visual.talkingHeadRatio, 1);
  assert.deepEqual(a.visual.angles, ["eye"]);
  assert.ok(a.warnings.some((w) => /audio/.test(w)), "thiếu lớp audio phải cảnh báo");
  assert.equal(a.estimated, false);
});
test("estimated giữ theo input", () => { assert.equal(validateStyle({ estimated: true }).estimated, true); });
test("validateTimeline ghép đúng theo cuts, bỏ shot thừa, điền shot thiếu", () => {
  const t = validateTimeline({ timeline: [{ shot: "CU tay", textOnScreen: "HOT", textAnim: "pop", sfx: "whoosh", music: "trap", voice: "mở đầu" }] }, [2, 5], 8);
  assert.equal(t.length, 3);
  assert.deepEqual([t[0].from, t[0].to, t[1].from, t[1].to, t[2].from, t[2].to], [0, 2, 2, 5, 5, 8]);
  assert.equal(t[0].shot, "CU tay"); assert.equal(t[2].shot, ""); assert.equal(t[2].textAnim, "none");
});
