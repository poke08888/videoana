import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScript, buildScriptPrompt } from "./script.js";

const shot = (dialog: string, extra: any = {}) => ({ purpose: "product", camera: "medium", dialog, image_prompt: "p", motion_prompt: "m", motion_level: "medium", ...extra });

test("validateScript: hợp lệ, mặc định enum lạ, cắt hashtag về 8", () => {
  const r = validateScript({ shots: [shot("Giòn rụm", { purpose: "lạ", camera: "xa" })], caption: "c", hashtags: Array(12).fill("#x"), cover_idx: 5 }, { maxSyllables: 38 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.script.shots[0].purpose, "product");
    assert.equal(r.script.shots[0].camera, "medium");
    assert.equal(r.script.hashtags.length, 8);
    assert.equal(r.script.cover_idx, 0);
  }
});

test("validateScript: thoại vượt ngân sách âm tiết → lỗi ghi rõ cảnh và số", () => {
  const r = validateScript({ shots: [shot("một hai ba bốn năm sáu")], caption: "", hashtags: [] }, { maxSyllables: 5 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors[0], /Cảnh 1.*6.*5/);
});

test("validateScript: 0 hoặc >8 cảnh → lỗi", () => {
  assert.equal(validateScript({ shots: [] }, { maxSyllables: 38 }).ok, false);
  assert.equal(validateScript({ shots: Array(9).fill(shot("a")) }, { maxSyllables: 38 }).ok, false);
});

test("buildScriptPrompt nêu ngưỡng âm tiết, số cảnh, ngành, và yêu cầu JSON", () => {
  const p = buildScriptPrompt({ productName: "Mẹt đốt", industry: "food", shots: 4, clipLen: 8, maxSyllables: 38, hasBackground: true });
  assert.match(p, /38 âm tiết/);
  assert.match(p, /4 cảnh/);
  assert.match(p, /"shots"/);
  assert.match(p, /motion_level/);
});
