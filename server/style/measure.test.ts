import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "../studio/ffmpeg.js";
import { parseShowinfoTimes, parseEbur128, parseSignalstats, parseSilenceStart, parseStreamInfo, cutStats, colorLabels, measureVideo } from "./measure.js";

test("parseShowinfoTimes lấy pts_time từng cut", () => {
  const s = "[Parsed_showinfo_1 @ 0x1] n:   0 pts:  800 pts_time:26.6667 duration: 1\n[Parsed_showinfo_1 @ 0x1] n:   1 pts:  868 pts_time:28.9333 duration: 1\n";
  assert.deepEqual(parseShowinfoTimes(s), [26.6667, 28.9333]);
});
test("parseEbur128 đọc Integrated loudness", () => {
  assert.equal(parseEbur128("  Integrated loudness:\n    I:         -14.3 LUFS\n    Threshold: -24.5 LUFS"), -14.3);
  assert.equal(parseEbur128("rác"), null);
});
test("parseSignalstats đọc YAVG/UAVG/VAVG/SATAVG từng khung", () => {
  const s = "lavfi.signalstats.YAVG=120.5\nlavfi.signalstats.UAVG=118.0\nlavfi.signalstats.VAVG=140.2\nlavfi.signalstats.SATAVG=40.1\nlavfi.signalstats.YAVG=90\nlavfi.signalstats.UAVG=130\nlavfi.signalstats.VAVG=120\nlavfi.signalstats.SATAVG=20\n";
  const r = parseSignalstats(s);
  assert.equal(r.length, 2); assert.equal(r[0].v, 140.2); assert.equal(r[1].sat, 20);
});
test("parseSilenceStart chỉ nhận im lặng bắt đầu tại 0", () => {
  assert.equal(parseSilenceStart("[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 1.2 | silence_duration: 1.2"), 1.2);
  assert.equal(parseSilenceStart("[silencedetect @ 0x1] silence_start: 5.1\n[silencedetect @ 0x1] silence_end: 6 | silence_duration: 0.9"), null);
});
test("parseStreamInfo đọc kích thước và fps", () => {
  assert.deepEqual(parseStreamInfo("Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1080x1920, 2000 kb/s, 30 fps, 30 tbr"), { width: 1080, height: 1920, fps: 30 });
});
test("cutStats: cuts/phút, trung vị shot, P10/P90, cutsIn3s", () => {
  const r = cutStats([1, 2.5, 4, 6, 20], 30);
  assert.equal(r.cutsPerMin, 10);
  assert.equal(r.cutsIn3s, 2);
  assert.ok(r.medianShotLen !== null && Math.abs(r.medianShotLen - 2) < 0.01, `median=${r.medianShotLen}`);
  assert.ok(r.shotLenP90 !== null && r.shotLenP90 >= 10, `p90=${r.shotLenP90}`);
  assert.deepEqual(cutStats([], 10), { cutsPerMin: 0, medianShotLen: 10, shotLenP10: 10, shotLenP90: 10, cutsIn3s: 0 });
});
test("colorLabels: V cao hơn U → warm; sat/contrast theo ngưỡng", () => {
  assert.deepEqual(colorLabels({ y: 120, u: 110, v: 150, saturation: 70, contrast: 60 }), { tone: "warm", saturationLevel: "high", contrastLevel: "high" });
  assert.equal(colorLabels({ y: 120, u: 150, v: 110, saturation: 20, contrast: 20 }).tone, "cool");
});

test("measureVideo trên clip lavfi 2 màu 6s → đúng 1 cut ở ~3s, aspect 9:16, có frames", { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  const out = path.join(dir, "two.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=180x320:d=3:r=24", "-f", "lavfi", "-i", "color=c=blue:s=180x320:d=3:r=24", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", out], { nice: false });
  const m = await measureVideo(out);
  assert.ok(m.duration !== null && Math.abs(m.duration - 6) < 0.3, `duration=${m.duration}`);
  assert.equal(m.aspect, "9:16");
  assert.equal(m.cuts.length, 1, `cuts=${JSON.stringify(m.cuts)}`);
  assert.ok(Math.abs(m.cuts[0] - 3) < 0.2, `cut tại ${m.cuts[0]}`);
  assert.equal(m.frames.length, 6);
  assert.ok(m.frames[0].startsWith("data:image/jpeg;base64,"), "frame phải là data-URL");
  assert.equal(m.loopLikely, false);
});
