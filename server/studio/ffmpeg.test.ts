import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFfmpeg, probeDuration, parseDurationLine } from "./ffmpeg.js";

test("parseDurationLine đọc Duration của ffmpeg", () => {
  assert.equal(parseDurationLine("  Duration: 00:00:08.04, start: 0.000000, bitrate: 20 kb/s"), 8.04);
  assert.equal(parseDurationLine("no duration here"), null);
});

test("runFfmpeg sinh mp4 3s và probeDuration đo được", async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ff-")), "a.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=64x64:d=3:r=24", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", out]);
  assert.ok(fs.statSync(out).size > 0);
  const d = await probeDuration(out);
  assert.ok(Math.abs(d - 3) < 0.2, `duration=${d}`);
});

test("runFfmpeg ném lỗi kèm đuôi stderr khi lệnh sai", async () => {
  await assert.rejects(runFfmpeg(["-i", "/khong/ton/tai.mp4", "-f", "null", "-"]), /ffmpeg/);
});
