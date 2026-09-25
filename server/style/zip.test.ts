import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { buildSkillZip } from "./zip.js";
import type { StyleProfile } from "./types.js";

const px = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const P = { channel: { platform: "tiktok", handle: "Abc", nickname: "A", avatar: "" }, analyzedAt: "2026-09-25T00:00:00.000Z", model: "m", videos: { total: 1, used: 1, failed: 0, outliers: [] },
  metrics: { duration: { median: 1, p25: 1, p75: 1, n: 1 }, cutsPerMin: { median: 1, p25: 1, p75: 1, n: 1 }, shotLen: { median: 1, p25: 1, p75: 1, n: 1 }, loudness: { median: 1, p25: 1, p75: 1, n: 1 }, talkingHeadRatio: { median: 1, p25: 1, p75: 1, n: 1 }, brollRatio: { median: 1, p25: 1, p75: 1, n: 1 } },
  layers: { structure: {}, visual: {}, text: {}, audio: {}, content: {}, brand: {} }, rules: { hard: [], soft: [], never: [] }, formulas: { opening: [], closing: [], cta: [] }, exemplars: [], evidence: { "text.captionStyle": [px, px] } } as StyleProfile;

test("zip có đủ 4 loại file + ảnh evidence; profile.json không mang evidence", () => {
  const { name, buffer } = buildSkillZip(P, "---\nname: style-abc\n---\n# x");
  assert.equal(name, "style-abc.zip");
  const files = unzipSync(new Uint8Array(buffer));
  const keys = Object.keys(files);
  for (const k of ["style-abc/SKILL.md", "style-abc/references/profile.json", "style-abc/references/timelines.md", "style-abc/references/formulas.md", "style-abc/references/evidence/text-captionStyle-1.jpg", "style-abc/references/evidence/text-captionStyle-2.jpg"]) assert.ok(keys.includes(k), `thiếu ${k} trong ${keys}`);
  const prof = JSON.parse(strFromU8(files["style-abc/references/profile.json"]));
  assert.equal(prof.evidence, undefined); assert.equal(prof.channel.handle, "Abc");
  assert.equal(files["style-abc/references/evidence/text-captionStyle-1.jpg"].length, 4);
});

test("profile không có evidence → vẫn đủ 4 file, không có thư mục evidence", () => {
  const { buffer } = buildSkillZip({ ...P, evidence: {} }, "---\nname: style-abc\n---\n# x");
  const keys = Object.keys(unzipSync(new Uint8Array(buffer)));
  assert.equal(keys.length, 4, `phải đúng 4 file: ${keys}`);
  assert.ok(keys.every((k) => !k.includes("/evidence/")), `không được có evidence: ${keys}`);
});
