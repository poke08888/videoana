import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeImageEngine, fakeVideoEngine, fakeVoiceEngine } from "./fake.js";
import { probeDuration } from "../ffmpeg.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-"));

test("fake image sinh PNG 9:16, cost 0", async () => {
  const r = await fakeImageEngine().generate({ prompt: "x", refs: [], aspectRatio: "9:16", size: "2K", outPath: path.join(dir, "k.png") });
  assert.ok(fs.statSync(r.path).size > 100);
  assert.equal(r.costUsd, 0);
});

test("fake video sinh mp4 đúng thời lượng", async () => {
  const r = await fakeVideoEngine().generate({ prompt: "x", firstFrame: { path: path.join(dir, "k.png"), mimeType: "image/png" }, durationSec: 4, aspectRatio: "9:16", tier: "draft", motionLevel: "low", outPath: path.join(dir, "c.mp4") });
  assert.ok(Math.abs((await probeDuration(r.path)) - 4) < 0.3);
  assert.equal(r.model, "fake");
});

test("fake voice: thời lượng theo số âm tiết / 4.5, words = null", async () => {
  const r = await fakeVoiceEngine().synthesize({ text: "một hai ba bốn năm sáu bảy tám chín", voice: "fake", rate: 1, outPath: path.join(dir, "v.mp3") });
  assert.ok(Math.abs(r.durationSec - 2) < 0.4, `dur=${r.durationSec}`);
  assert.equal(r.words, null);
  assert.equal(fakeVoiceEngine().voices()[0].id, "fake");
});
