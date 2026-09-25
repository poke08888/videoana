import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "../studio/ffmpeg.js";
import { parseShowinfoTimes, parseEbur128, parseSignalstats, parseSilenceStart, parseStreamInfo, cutStats, colorLabels, frameTimes, measureVideo } from "./measure.js";

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
test("cutStats: cutsPerMin dùng CÙNG danh sách cut đã lọc+sort với shot length", () => {
  const r = cutStats([5, 1, 30, 35], 30);
  assert.equal(r.cutsPerMin, 4, `cutsPerMin=${r.cutsPerMin}`); // 2 cut hợp lệ (1, 5) / 30 s * 60
  assert.equal(r.shotLenP10, 1, `p10=${r.shotLenP10}`); // shots [1,4,25] (bounds 0,1,5,30 đã sort)
  assert.equal(r.medianShotLen, 4, `median=${r.medianShotLen}`);
  assert.equal(r.shotLenP90, 25, `p90=${r.shotLenP90}`);
});

test("frameTimes: 1 cut, dur 6, count 6 → 6 mốc tăng dần trong [0, 5.7]", () => {
  const r = frameTimes([3], 6, 6);
  assert.equal(r.length, 6, `len=${r.length} r=${JSON.stringify(r)}`);
  for (let i = 1; i < r.length; i++) assert.ok(r[i] > r[i - 1], `không tăng dần tại ${i}: ${JSON.stringify(r)}`);
  for (const t of r) assert.ok(t >= 0 && t <= 5.7 + 1e-9, `mốc ${t} ngoài [0,5.7]`);
});
test("frameTimes: đủ cut phân biệt → mốc giữa lấy từ cut thật", () => {
  const cuts = [1, 2, 3, 4, 5, 6, 7, 8];
  const r = frameTimes(cuts, 10, 6);
  const mid = r.slice(1, -1);
  assert.equal(mid.length, 4, `mid=${JSON.stringify(mid)}`);
  for (const t of mid) assert.ok(cuts.some((c) => Math.abs(c - t) < 1e-9), `mốc giữa ${t} không lấy từ danh sách cut`);
});
test("frameTimes: dur 0 → [0] hoặc []", () => {
  const r = frameTimes([], 0, 6);
  assert.ok(r.length === 0 || (r.length === 1 && r[0] === 0), `r=${JSON.stringify(r)}`);
});
test("frameTimes: cut sát cuối (9.99, dur 10) không được vượt trần dur-0.3=9.7", () => {
  const r = frameTimes([9.99], 10, 3); // count=3 → 1 mốc giữa, đủ 1 cut phân biệt nên phải lấy 9.99 rồi kẹp
  for (const t of r) assert.ok(t <= 9.7 + 1e-9, `mốc ${t} vượt trần 9.7: ${JSON.stringify(r)}`);
  assert.ok(r.some((t) => Math.abs(t - 9.7) < 1e-9), `mốc giữa phải bị kẹp về 9.7: ${JSON.stringify(r)}`);
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

test("measureVideo giữ cut ĐẦU khi video có rất nhiều cut (stderr > 20.000 ký tự)", { timeout: 180_000 }, async () => {
  // 40 s đổi đỏ/xanh mỗi 0,5 s → ~79 cut; mỗi dòng showinfo ~420 ký tự nên runFfmpeg (giữ 20.000 ký tự cuối) sẽ mất cut đầu.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-many-"));
  const out = path.join(dir, "many.mp4");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=black:s=90x160:r=24:d=40,format=rgb24,geq=r='if(mod(floor(T*2),2),0,255)':g='0':b='if(mod(floor(T*2),2),255,0)'",
    "-t", "40", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", out], { nice: false, timeoutMs: 120_000 });
  const m = await measureVideo(out);
  assert.ok(m.cuts.length >= 60, `phải bắt ≥ 60 cut, được ${m.cuts.length}`);
  assert.ok(m.cuts[0] < 1, `cut đầu tiên phải < 1 s (không bị cắt mất), được ${m.cuts[0]}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
