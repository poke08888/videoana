import { test } from "node:test";
import assert from "node:assert/strict";
import { countSyllables, maxSyllablesFor } from "./text.js";

test("tiếng Việt đơn âm tiết: đếm âm tiết = đếm chữ, bỏ dấu câu rời", () => {
  assert.equal(countSyllables("Mở hộp ra là thơm nức mũi!"), 7);
  assert.equal(countSyllables("  Giòn   -   rụm...  "), 2);
  assert.equal(countSyllables(""), 0);
  assert.equal(countSyllables("100% thật"), 2);
});

test("maxSyllablesFor làm tròn xuống", () => {
  assert.equal(maxSyllablesFor(4.8, 8), 38);
  assert.equal(maxSyllablesFor(4.5, 4), 18);
});
