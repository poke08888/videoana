import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rateToSpeed, fptVoiceEngine, FPT_VOICES } from "./voiceFpt.js";

test("rateToSpeed: 1.0→0, 1.2→1, 0.8→-1, kẹp -3..3", () => {
  assert.equal(rateToSpeed(1), 0); assert.equal(rateToSpeed(1.2), 1); assert.equal(rateToSpeed(0.8), -1);
  assert.equal(rateToSpeed(3), 3); assert.equal(rateToSpeed(0.1), -3);
});

test("fpt: gửi header api-key/voice/speed, poll URL async rồi ghi file; words=null; cost theo ký tự", async () => {
  const calls: any[] = [];
  const fakeFetch: any = async (url: string, init?: any) => {
    calls.push({ url, init });
    if (url.includes("hmi/tts")) return { ok: true, status: 200, json: async () => ({ error: 0, async: "https://cdn/x.mp3" }) };
    if (calls.filter((c) => c.url === "https://cdn/x.mp3").length < 2) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([0xff, 0xfb, 0x90, 0x00]).buffer };
  };
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fpt-")), "v.mp3");
  const eng = fptVoiceEngine("KEY", fakeFetch, { pollMs: 1, probe: async () => 1.5 });
  const r = await eng.synthesize({ text: "Xin chào", voice: "banmai", rate: 1.2, outPath: out });
  assert.equal(calls[0].init.headers["api-key"], "KEY");
  assert.equal(calls[0].init.headers.voice, "banmai");
  assert.equal(calls[0].init.headers.speed, "1");
  assert.equal(fs.statSync(out).size, 4);
  assert.equal(r.words, null);
  assert.equal(r.durationSec, 1.5);
  assert.equal(r.costUsd, 0.0002);
  assert.ok(FPT_VOICES.length >= 5);
});
