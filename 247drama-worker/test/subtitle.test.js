const { test } = require("node:test");
const assert = require("node:assert");
const { assTime } = require("../util/subtitle");

test("định dạng H:MM:SS.cs cơ bản", () => {
  assert.strictEqual(assTime(0), "0:00:00.00");
  assert.strictEqual(assTime(1.5), "0:00:01.50");
});

test("mốc biên làm tròn phải cộng dồn sang giây, không ra .100", () => {
  assert.strictEqual(assTime(1.995), "0:00:02.00");
  assert.strictEqual(assTime(12.9999), "0:00:13.00");
});

test("tràn lên phút và giờ", () => {
  assert.strictEqual(assTime(59.999), "0:01:00.00");
  assert.strictEqual(assTime(3599.999), "1:00:00.00");
});

test("giây âm kẹp về 0", () => {
  assert.strictEqual(assTime(-1), "0:00:00.00");
});

test("không mốc nào sinh trường centisecond sai định dạng (quét 100k giá trị)", () => {
  for (let i = 0; i < 100000; i++) {
    const sec = i / 1000 + 0.9949; // quét quanh ngưỡng làm tròn
    const out = assTime(sec);
    const cs = out.split(".")[1];
    assert.strictEqual(cs.length, 2, `${sec} -> ${out}`);
    assert.ok(Number(cs) <= 99, `${sec} -> ${out}`);
  }
});

test("ASS và VTT chỉ lệch nhau trong đúng độ phân giải của ASS (5ms)", () => {
  const { segsToVtt } = require("../util/vtt");
  for (const sec of [0, 1.995, 12.9999, 59.999, 61.234]) {
    const ass = assTime(sec);
    const [h, m, rest] = ass.split(":");
    const assMs = (Number(h) * 3600 + Number(m) * 60 + Number(rest)) * 1000;
    const vtt = segsToVtt([{ start: sec, end: sec + 1, text: "x" }]);
    const [vh, vm, vrest] = vtt.split("\n")[2].split(" --> ")[0].split(":");
    const vttMs = (Number(vh) * 3600 + Number(vm) * 60 + Number(vrest)) * 1000;
    assert.ok(Math.abs(assMs - vttMs) <= 5, `${sec}: ass=${ass} vtt=${vttMs}ms`);
  }
});
