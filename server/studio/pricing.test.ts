import { test } from "node:test";
import assert from "node:assert/strict";
import { videoCost, imageCost, voiceCost, estimateProject, usdToVnd } from "./pricing.js";

test("videoCost nhân đúng giá theo giây", () => {
  assert.equal(videoCost("veo-3.1-fast-generate-preview", 8), 1.2);
  assert.equal(videoCost("fake", 8), 0);
});

test("videoCost ném lỗi khi model chưa có giá (không được lặng lẽ trả 0)", () => {
  assert.throws(() => videoCost("model-la", 8), /Chưa có giá/);
});

test("imageCost phân biệt 2K và 4K", () => {
  assert.equal(imageCost("gemini-3-pro-image", "2K"), 0.134);
  assert.equal(imageCost("gemini-3-pro-image", "4K"), 0.24);
  assert.equal(imageCost("fake", "2K"), 0);
});

test("voiceCost theo 1000 ký tự", () => {
  assert.equal(voiceCost("edge", 5000), 0);
  assert.equal(voiceCost("fpt", 2000), 0.04);
});

test("estimateProject cộng đủ ba khoản", () => {
  const e = estimateProject({ shots: 3, clipLen: 8, videoModel: "veo-3.1-lite-generate-preview", imageModel: "gemini-3-pro-image", voiceEngine: "edge", dialogChars: 300 });
  assert.equal(e.imagesUsd, 0.402);
  assert.equal(e.clipsUsd, 1.2);
  assert.equal(e.voiceUsd, 0);
  assert.equal(e.totalUsd, 1.602);
});

test("usdToVnd làm tròn nghìn", () => {
  assert.equal(usdToVnd(1.602), 42000);
});
