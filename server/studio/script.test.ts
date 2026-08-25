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

// ── Bài học từ bench Bước 0 (19/08/2026) ────────────────────────────────────
test("ép motion_level='low' cho cảnh packaging/label — chốt chặn chống méo chữ", () => {
  const v = validateScript({ shots: [
    { purpose: "label", camera: "close", dialog: "Nhãn ghi rõ", image_prompt: "a", motion_prompt: "b", motion_level: "high" },
    { purpose: "packaging", camera: "close", dialog: "Hộp đẹp", image_prompt: "c", motion_prompt: "d", motion_level: "medium" },
    { purpose: "cta", camera: "wide", dialog: "Mua ngay", image_prompt: "e", motion_prompt: "f", motion_level: "high" },
  ] }, { maxSyllables: 38 });
  assert.ok(v.ok, JSON.stringify(v));
  assert.equal(v.script.shots[0].motion_level, "low", "cảnh label phải bị ép về low");
  assert.equal(v.script.shots[1].motion_level, "low", "cảnh packaging phải bị ép về low");
  assert.equal(v.script.shots[2].motion_level, "high", "cảnh khác giữ nguyên lựa chọn");
});

test("buildScriptPrompt cấm trích dẫn chữ trên nhãn (prompt đè lên ảnh tham chiếu)", () => {
  const p = buildScriptPrompt({ productName: "X", industry: "food", shots: 3, clipLen: 8, maxSyllables: 38, hasBackground: true });
  assert.match(p, /KHÔNG.*(trích|chép|ghi lại|viết lại).*chữ/i);
});

test("buildScriptPrompt: số cảnh 'auto' → bảo AI tự quyết, không ép con số", () => {
  const a = buildScriptPrompt({ productName: "X", industry: "food", shots: "auto", clipLen: 8, maxSyllables: 38, hasBackground: true });
  assert.match(a, /tự quyết|tự chọn/i);
  assert.match(a, /1[–-]8|tối đa 8/, "vẫn phải nêu trần 8 cảnh");
  assert.ok(!/đúng \d+ cảnh/.test(a), "không được ép 'đúng N cảnh'");
  const b = buildScriptPrompt({ productName: "X", industry: "food", shots: 5, clipLen: 8, maxSyllables: 38, hasBackground: true });
  assert.match(b, /đúng 5 cảnh/, "khi có số thì vẫn ép đúng số đó");
});
