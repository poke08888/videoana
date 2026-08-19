import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMotionPrompt, pickVideo } from "./video.js";
import { StudioError } from "../errors.js";

const base = { prompt: "Hand picks up the jar", firstFrame: { path: "", mimeType: "image/png" }, durationSec: 8 as const, aspectRatio: "9:16" as const, tier: "draft" as const, outPath: "" };

test("motion low thêm câu giữ nhãn không méo; high không thêm", () => {
  assert.match(buildMotionPrompt({ ...base, motionLevel: "low" }), /label .*legible/i);
  assert.doesNotMatch(buildMotionPrompt({ ...base, motionLevel: "high" }), /legible/i);
  assert.match(buildMotionPrompt({ ...base, motionLevel: "high" }), /Hand picks up the jar/);
});

test("pickVideo trả video khi có", () => {
  const v = pickVideo({ done: true, response: { generatedVideos: [{ video: { uri: "u" } }] } });
  assert.deepEqual(v, { uri: "u" });
});

test("pickVideo: RAI lọc hết → blocked", () => {
  assert.throws(
    () => pickVideo({ done: true, response: { generatedVideos: [], raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["x"] } }),
    (e: any) => e instanceof StudioError && e.kind === "blocked"
  );
});

test("pickVideo: operation lỗi → other với message", () => {
  assert.throws(() => pickVideo({ done: true, error: { message: "boom" } }), /boom/);
});
