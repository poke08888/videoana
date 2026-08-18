const { test } = require("node:test");
const assert = require("node:assert");
const { buildBoxFilter } = require("../util/transcode");

test("mặc định che dải đáy từ 0.66, cao 0.17, màu trắng", () => {
  assert.strictEqual(
    buildBoxFilter({}),
    "drawbox=x=0:y=ih*0.66:w=iw:h=ih*0.17:color=white@1:t=fill,",
  );
});

test("nhận yRatio/heightRatio/color tuỳ chỉnh", () => {
  assert.strictEqual(
    buildBoxFilter({ yRatio: 0.7, heightRatio: 0.2, color: "black@1" }),
    "drawbox=x=0:y=ih*0.7:w=iw:h=ih*0.2:color=black@1:t=fill,",
  );
});

test("enabled=false -> không che gì", () => {
  assert.strictEqual(buildBoxFilter({ enabled: false }), "");
});
