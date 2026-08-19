import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildImageParts, extractImage } from "./image.js";
import { StudioError } from "../errors.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "img-"));
const ref = path.join(tmp, "a.png");
fs.writeFileSync(ref, Buffer.from("89504e470d0a1a0a", "hex"));

test("buildImageParts: ảnh tham chiếu đứng trước, prompt đứng cuối", () => {
  const parts = buildImageParts({ prompt: "P", refs: [{ path: ref, mimeType: "image/png" }], aspectRatio: "9:16", size: "2K", outPath: "" });
  assert.equal(parts.length, 2);
  assert.equal(parts[0].inlineData.mimeType, "image/png");
  assert.equal(parts[0].inlineData.data, Buffer.from("89504e470d0a1a0a", "hex").toString("base64"));
  assert.equal(parts[1], "P");
});

test("extractImage lấy inlineData đầu tiên", () => {
  const r = extractImage({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { data: "QUJD", mimeType: "image/jpeg" } }] } }] });
  assert.deepEqual(r, { data: "QUJD", mimeType: "image/jpeg" });
});

test("extractImage: bị chặn → StudioError kind blocked", () => {
  assert.throws(
    () => extractImage({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
    (e: any) => e instanceof StudioError && e.kind === "blocked"
  );
});

test("extractImage: không có ảnh → StudioError kind other", () => {
  assert.throws(() => extractImage({ candidates: [] }), (e: any) => e instanceof StudioError && e.kind === "other");
});
