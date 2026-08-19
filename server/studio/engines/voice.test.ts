import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEdgeMetadata, escapeXml, EDGE_VOICES } from "./voice.js";

test("parseEdgeMetadata đổi 100ns → giây, chỉ lấy WordBoundary", () => {
  const meta = { Metadata: [
    { Type: "SentenceBoundary", Data: { Offset: 0, Duration: 20000000, text: { Text: "Xin chào" } } },
    { Type: "WordBoundary", Data: { Offset: 1000000, Duration: 5000000, text: { Text: "Xin" } } },
    { Type: "WordBoundary", Data: { Offset: 7000000, Duration: 6000000, text: { Text: "chào" } } },
  ] };
  const w = parseEdgeMetadata(meta);
  assert.deepEqual(w, [{ text: "Xin", startSec: 0.1, endSec: 0.6 }, { text: "chào", startSec: 0.7, endSec: 1.3 }]);
});

test("escapeXml", () => { assert.equal(escapeXml(`a<b>&"c"`), "a&lt;b&gt;&amp;&quot;c&quot;"); });
test("EDGE_VOICES có Hoài My và Nam Minh", () => {
  assert.ok(EDGE_VOICES.some((v) => v.id === "vi-VN-HoaiMyNeural"));
  assert.ok(EDGE_VOICES.some((v) => v.id === "vi-VN-NamMinhNeural"));
});
