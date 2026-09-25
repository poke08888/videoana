import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateProfile, stat, type AggInput } from "./aggregate.js";
import { emptyStyle } from "./validate.js";
import type { StyleAnalysis, StyleMeasure } from "./types.js";

const NOW = 1_800_000_000; const DAY = 86400;
const CH = { platform: "tiktok", handle: "a", nickname: "A", avatar: "" };
const meas = (cpm: number, dur = 30): StyleMeasure => ({ duration: dur, width: 1080, height: 1920, aspect: "9:16", fps: 30, cuts: [], cutsPerMin: cpm, medianShotLen: 60 / cpm, shotLenP10: 1, shotLenP90: 3, cutsIn3s: 1, loudness: { integratedLufs: -14, first3sLufs: -13 }, silenceStart: null, color: null, loopLikely: false, frames: ["data:image/jpeg;base64,AAAA"] });
function vid(i: number, patch: (s: StyleAnalysis) => void, opts: { daysAgo?: number; cpm?: number } = {}): AggInput {
  const s = emptyStyle(); s.text.captionStyle = "sentence"; s.content.persona = "friendly"; s.structure.hookType = "text-big"; s.content.openingFormula = "Chào mọi người"; patch(s);
  return { videoId: `v${i}`, link: `l${i}`, views: 1000 - i, createTime: NOW - (opts.daysAgo ?? 10) * DAY, measure: meas(opts.cpm ?? 30), analysis: s, timeline: null, isExemplar: i < 2 };
}

test("stat: trung vị và P25/P75", () => { assert.deepEqual(stat([1, 2, 3, 4, 5, 6, 7, 8]), { median: 4.5, p25: 2.75, p75: 6.25, n: 8 }); assert.equal(stat([]).n, 0); });

test("≥70% → hard, 40–69% → soft, 0% ở trường phủ định → never", () => {
  const vids = Array.from({ length: 10 }, (_, i) => vid(i, (s) => { if (i < 5) s.visual.shooting = "handheld"; else s.visual.shooting = "static"; }));
  const p = aggregateProfile(vids, NOW, CH, "m");
  assert.equal(p.layers.text.captionStyle.rule, "hard"); assert.equal(p.layers.text.captionStyle.share, 1);
  assert.equal(p.layers.visual.shooting.rule, "soft"); assert.equal(p.layers.visual.shooting.value, "handheld");
  assert.ok(p.rules.hard.some((r) => /caption.*sentence|sentence/.test(r)), `hard=${p.rules.hard}`);
  assert.ok(p.rules.never.some((r) => /word-pop/.test(r)), `never=${p.rules.never}`);
  assert.ok(p.rules.never.some((r) => /intro/.test(r)), "không có intro → never");
  assert.ok(p.rules.hard.some((r) => /cut/.test(r) && /30/.test(r)), `hard phải có câu số đo cut: ${p.rules.hard}`);
});

test("trọng số thời gian: 6 video cũ style X vs 4 video mới style Y → Y thắng", () => {
  const vids = [...Array.from({ length: 6 }, (_, i) => vid(i, (s) => { s.content.genre = "story"; }, { daysAgo: 200 })), ...Array.from({ length: 4 }, (_, i) => vid(10 + i, (s) => { s.content.genre = "review"; }))];
  const p = aggregateProfile(vids, NOW, CH, "m");
  assert.equal(p.layers.content.genre.value, "review");
});

test("outlier: lệch ≥3 lớp bị loại và ghi lý do; formulas gom câu thô", () => {
  const vids = Array.from({ length: 9 }, (_, i) => vid(i, () => {}));
  vids.push(vid(99, (s) => { s.text.captionStyle = "word-pop"; s.content.persona = "sassy"; s.structure.hookType = "question"; }, { cpm: 150 }));
  const p = aggregateProfile(vids, NOW, CH, "m");
  assert.equal(p.videos.used, 9); assert.equal(p.videos.outliers.length, 1);
  assert.equal(p.videos.outliers[0].videoId, "v99"); assert.ok(p.videos.outliers[0].reasons.length >= 3, `reasons=${p.videos.outliers[0].reasons}`);
  assert.equal(p.metrics.cutsPerMin.median, 30, "outlier không được kéo số đo");
  assert.equal(p.formulas.opening.length, 9);
  assert.equal(p.exemplars.length, 2);
  assert.ok(Object.keys(p.evidence).length > 0, "phải có ảnh bằng chứng");
});

test("outlier fallback: 2 video lệch nhau ≥3 lớp → không loại ai, outliers rỗng, used === total", () => {
  const vids = [
    vid(0, (s) => { s.text.captionStyle = "sentence"; s.content.persona = "friendly"; s.structure.hookType = "text-big"; }),
    vid(1, (s) => { s.text.captionStyle = "word-pop"; s.content.persona = "sassy"; s.structure.hookType = "question"; }),
  ];
  const p = aggregateProfile(vids, NOW, CH, "m");
  assert.equal(p.videos.total, 2, "total phải là 2");
  assert.equal(p.videos.used, p.videos.total, "fallback: used phải bằng total khi filter loại hết/không chạy");
  assert.equal(p.videos.outliers.length, 0, "outliers phải rỗng để nhất quán với used === total");
});

test("outlierMinN: tập 3 video (< mặc định 5) bỏ qua phát hiện outlier dù có video lệch 3 lớp", () => {
  const vids = [
    vid(0, () => {}),
    vid(1, () => {}),
    vid(2, (s) => { s.text.captionStyle = "word-pop"; s.content.persona = "sassy"; s.structure.hookType = "question"; }),
  ];
  const p = aggregateProfile(vids, NOW, CH, "m");
  assert.equal(p.videos.used, 3, "3 video < outlierMinN(5) → không loại ai");
  assert.equal(p.videos.outliers.length, 0, "không phát hiện outlier khi tập quá nhỏ");
});
