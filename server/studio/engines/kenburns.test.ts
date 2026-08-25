import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildKenBurnsFilter, KEN_BURNS_MOTION, kenBurnsVideoEngine } from "./kenburns.js";
import { fakeImageEngine } from "./fake.js";
import { probeDuration } from "../ffmpeg.js";

test("biên độ thấp zoom ít hơn và KHÔNG lia ngang", () => {
  assert.ok(KEN_BURNS_MOTION.low.zoom < KEN_BURNS_MOTION.medium.zoom);
  assert.ok(KEN_BURNS_MOTION.medium.zoom < KEN_BURNS_MOTION.high.zoom);
  assert.equal(KEN_BURNS_MOTION.low.panX, 0, "cảnh nhãn không lia, chỉ zoom");
});

test("buildKenBurnsFilter: số khung = giây × fps, xuất đúng kích thước đích", () => {
  const f = buildKenBurnsFilter({ width: 1080, height: 1920, durationSec: 4, fps: 24, motionLevel: "low" });
  assert.match(f, /d=96:/, "4s × 24fps = 96 khung");
  assert.match(f, /s=1080x1920/);
  assert.match(f, /setsar=1$/);
});

test("buildKenBurnsFilter: phóng to trước khi zoompan để không rung", () => {
  const f = buildKenBurnsFilter({ width: 1080, height: 1920, durationSec: 4, fps: 24, motionLevel: "medium" });
  // zoompan trên ảnh tĩnh nhỏ sẽ giật; phải scale lên rồi crop đúng tỉ lệ trước.
  assert.match(f, /^scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,/);
});

test("biên độ thấp không có số hạng lia trong biểu thức x", () => {
  const low = buildKenBurnsFilter({ width: 1080, height: 1920, durationSec: 4, fps: 24, motionLevel: "low" });
  const med = buildKenBurnsFilter({ width: 1080, height: 1920, durationSec: 4, fps: 24, motionLevel: "medium" });
  assert.ok(!/\+\s*\d+\*on/.test(low), "low: x không được cộng số hạng theo on");
  assert.match(med, /\+\d+\*on\//, "medium: có lia ngang");
});

test("engine dựng mp4 thật từ ảnh khoá, đúng thời lượng, chi phí 0", { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
  const frame = path.join(dir, "keyframe.png");
  await fakeImageEngine().generate({ prompt: "", refs: [], aspectRatio: "9:16", size: "1K", outPath: frame });
  const out = path.join(dir, "shot.mp4");

  const eng = kenBurnsVideoEngine();
  const r = await eng.generate({
    prompt: "", firstFrame: { path: frame, mimeType: "image/png" },
    durationSec: 4, aspectRatio: "9:16", tier: "draft", motionLevel: "low", outPath: out,
  });

  assert.equal(r.costUsd, 0, "không gọi API nào → 0 đồng");
  assert.equal(r.model, "kenburns");
  assert.ok(fs.statSync(out).size > 0);
  const d = await probeDuration(out);
  assert.ok(Math.abs(d - 4) < 0.35, `thời lượng ${d}s phải xấp xỉ 4s`);
});
