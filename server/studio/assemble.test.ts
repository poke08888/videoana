import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clipStarts, totalDuration, buildAssembleArgs, assembleVideo } from "./assemble.js";
import { fakeVideoEngine, fakeVoiceEngine } from "./engines/fake.js";
import { probeDuration } from "./ffmpeg.js";

test("clipStarts/totalDuration với chuyển cảnh 0.5s", () => {
  assert.deepEqual(clipStarts([8, 8, 8], 0.5), [0, 7.5, 15]);
  assert.equal(totalDuration([8, 8, 8], 0.5), 23);
  assert.deepEqual(clipStarts([8, 8], 0), [0, 8]);
});

const base = (dir: string) => ({
  clips: [{ path: path.join(dir, "a.mp4"), durationSec: 4 }, { path: path.join(dir, "b.mp4"), durationSec: 4 }],
  voices: [{ path: path.join(dir, "v0.mp3"), startSec: 0 }, null],
  cues: [{ text: "Xin chào", startSec: 0.2, endSec: 1.5 }],
  musicPath: null as string | null,
  transition: "fade" as const,
  width: 1080, height: 1920, font: "DejaVu Sans",
  outPath: path.join(dir, "out.mp4"), assPath: path.join(dir, "subs.ass"),
});

test("buildAssembleArgs: xfade offset đúng, adelay theo ms, subtitles, -t tổng", () => {
  const args = buildAssembleArgs(base("/x"), 0.5).join(" ");
  assert.match(args, /xfade=transition=fade:duration=0\.5:offset=3\.5/);
  assert.match(args, /adelay=0\|0/);
  assert.match(args, /subtitles=/);
  assert.match(args, /-t 7\.5 /);
  assert.match(args, /-map \[vout\] -map \[aout\]/);
});

test("buildAssembleArgs: transition none → concat; không giọng không nhạc → -an", () => {
  const i = { ...base("/x"), transition: "none" as const, voices: [null, null] };
  const args = buildAssembleArgs(i, 0.5).join(" ");
  assert.match(args, /concat=n=2:v=1:a=0/);
  assert.match(args, / -an /);
  assert.match(args, /-t 8 /);
});

test("assembleVideo ghép thật 2 clip giả + giọng giả + phụ đề (không nhạc)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-"));
  const v = fakeVideoEngine();
  await v.generate({ prompt: "", firstFrame: { path: "", mimeType: "image/png" }, durationSec: 4, aspectRatio: "9:16", tier: "draft", motionLevel: "low", outPath: path.join(dir, "a.mp4") });
  await v.generate({ prompt: "", firstFrame: { path: "", mimeType: "image/png" }, durationSec: 4, aspectRatio: "9:16", tier: "draft", motionLevel: "low", outPath: path.join(dir, "b.mp4") });
  await fakeVoiceEngine().synthesize({ text: "xin chào các bạn", voice: "fake", rate: 1, outPath: path.join(dir, "v0.mp3") });
  const r = await assembleVideo(base(dir));
  assert.ok(fs.statSync(r.outPath).size > 1000);
  assert.ok(Math.abs(r.durationSec - 7.5) < 0.4, `dur=${r.durationSec}`);
  assert.ok(Math.abs((await probeDuration(r.outPath)) - 7.5) < 0.4);
});
