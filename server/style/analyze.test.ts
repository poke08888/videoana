import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStylePrompt, fakeStyleEngine, pickFps } from "./analyze.js";
import type { StyleMeasure } from "./types.js";

const M: StyleMeasure = { duration: 32.4, width: 1080, height: 1920, aspect: "9:16", fps: 30, cuts: [1.5, 3.2, 6.8], cutsPerMin: 5.56, medianShotLen: 1.7, shotLenP10: 1.5, shotLenP90: 25.6, cutsIn3s: 1,
  loudness: { integratedLufs: -14.2, first3sLufs: -12.1 }, silenceStart: null, color: { y: 120, u: 118, v: 140, saturation: 45, contrast: 50, tone: "warm", saturationLevel: "mid", contrastLevel: "mid" }, loopLikely: false, frames: [] };

test("prompt chứa số đo thật và mốc cut để model không đoán", () => {
  const p = buildStylePrompt(M, { title: "Khẩu trang", platform: "TikTok", nickname: "A" });
  for (const s of ["32.4", "1.5, 3.2, 6.8", "5.56", "-14.2", "warm", "9:16"]) assert.ok(p.includes(s), `prompt thiếu ${s}`);
  assert.ok(/KHÔNG.*(đoán|ước lượng)/i.test(p), "prompt phải cấm đoán số đã đo");
  assert.ok(p.includes('"hookType"') && p.includes('"captionStyle"') && p.includes('"watermark"'), "prompt phải có schema 6 lớp");
});
test("prompt khi measure=null yêu cầu estimated=true", () => {
  const p = buildStylePrompt(null, { title: "x", platform: "TikTok", nickname: "A" });
  assert.ok(p.includes('"estimated": true'), "phải bắt estimated true");
});
test("pickFps: ngắn 3, dài 2", () => { assert.equal(pickFps(30), 3); assert.equal(pickFps(61), 2); assert.equal(pickFps(null), 3); });

test("fake engine trả phiếu hợp lệ, timeline khớp cuts, cluster gom trùng, narrate 3 đoạn", async () => {
  const e = fakeStyleEngine();
  const a = await e.analyze({ videoPath: "/x.mp4", mimeType: "video/mp4", measure: M, meta: { title: "t", platform: "TikTok", nickname: "A" } });
  assert.equal(a.text.captionStyle, "sentence"); assert.equal(a.warnings.length, 0);
  const t = await e.timeline({ videoPath: "/x.mp4", mimeType: "video/mp4", cuts: [2, 4], duration: 6 });
  assert.equal(t.length, 3); assert.equal(t[2].to, 6);
  const c = await e.cluster({ kind: "opening", texts: ["Chào mọi người", "chào mọi người ", "Hôm nay"] });
  assert.equal(c[0].count, 2); assert.equal(c.length, 2);
  const n = await e.narrate({ profile: {} as any });
  assert.ok(n.overview && n.persona && n.howTo, "narrate phải đủ 3 đoạn");
});
