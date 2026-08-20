const { test } = require("node:test");
const assert = require("node:assert");
const { mergeWorkerStatus, readStatusDir } = require("../util/renderStatus");

const NOW = 1_000_000_000;
const may = (worker, secAgo, over, thr, inflight = []) => ({
  worker,
  updatedAt: new Date(NOW - secAgo * 1000).toISOString(),
  running: true,
  overall: over,
  throughput: thr,
  inflight,
});

test("hai máy đọc cùng kho -> KHÔNG cộng số tập xong (tránh báo 200%)", () => {
  const r = mergeWorkerStatus([
    may("mac-2", 2, { done: 5085, target: 8148, failed: 15 }, { perMin: 1.1, concurrency: 4 }),
    may("mac-10", 3, { done: 5080, target: 8148, failed: 0 }, { perMin: 0.9, concurrency: 6 }),
  ], NOW);
  assert.strictEqual(r.overall.done, 5085);
  assert.strictEqual(r.overall.target, 8148);
  assert.strictEqual(r.overall.pct, 62);
});

test("tốc độ, luồng và lỗi là của riêng từng máy -> cộng lại", () => {
  const r = mergeWorkerStatus([
    may("mac-2", 2, { done: 10, target: 100, failed: 3 }, { perMin: 1.1, concurrency: 4 }),
    may("mac-10", 3, { done: 10, target: 100, failed: 2 }, { perMin: 0.9, concurrency: 6 }),
  ], NOW);
  assert.strictEqual(r.throughput.perMin, 2);
  assert.strictEqual(r.throughput.concurrency, 10);
  assert.strictEqual(r.throughput.machines, 2);
  assert.strictEqual(r.overall.failed, 5);
});

test("máy im quá 1 phút -> coi như tắt, không tính vào tốc độ", () => {
  const r = mergeWorkerStatus([
    may("mac-2", 2, { done: 50, target: 100 }, { perMin: 2, concurrency: 4 }),
    may("mac-cu", 300, { done: 40, target: 100 }, { perMin: 5, concurrency: 8 }),
  ], NOW);
  assert.strictEqual(r.throughput.perMin, 2);
  assert.strictEqual(r.throughput.machines, 1);
  assert.strictEqual(r.workers.find((w) => w.worker === "mac-cu").stale, true);
  assert.strictEqual(r.running, true, "còn một máy sống thì hệ thống vẫn coi là đang chạy");
});

test("thời gian còn lại tính theo tốc độ CỘNG của các máy", () => {
  const r = mergeWorkerStatus([
    may("a", 1, { done: 100, target: 400 }, { perMin: 1, concurrency: 2 }),
    may("b", 1, { done: 100, target: 400 }, { perMin: 2, concurrency: 4 }),
  ], NOW);
  assert.strictEqual(r.throughput.etaMin, 100); // 300 tập / 3 tập mỗi phút
});

test("tập đang làm gộp lại và ghi rõ của máy nào", () => {
  const r = mergeWorkerStatus([
    may("mac-2", 1, {}, {}, [{ tag: "hm:1 ep2", phase: "sub" }]),
    may("mac-10", 1, {}, {}, [{ tag: "hg:9 ep5", phase: "tải" }]),
  ], NOW);
  assert.strictEqual(r.inflight.length, 2);
  assert.deepStrictEqual(r.inflight.map((x) => x.worker).sort(), ["mac-10", "mac-2"]);
});

test("tất cả máy đều tắt -> running false, không chia cho 0", () => {
  const r = mergeWorkerStatus([may("mac-2", 500, { done: 5, target: 10 }, { perMin: 3, concurrency: 4 })], NOW);
  assert.strictEqual(r.running, false);
  assert.strictEqual(r.throughput.perMin, 0);
  assert.strictEqual(r.throughput.etaMin, null);
});

test("không có máy nào -> trả về khung rỗng, không nổ", () => {
  const r = mergeWorkerStatus([], NOW);
  assert.deepStrictEqual(r.workers, []);
  assert.strictEqual(r.overall.pct, 0);
});

test("đọc thư mục: chỉ nhận đúng tên file trạng thái, bỏ file hỏng", () => {
  const files = {
    "render-status.json": '{"worker":"cu","updatedAt":"x"}',
    "render-status-mac-2.json": '{"worker":"mac-2"}',
    "render-status-mac-10.json": "{ghi dở",
    "ops.html": "<html>",
    "video.mp4": "xxx",
  };
  const rows = readStatusDir("/uploads", {
    list: () => Object.keys(files),
    readFile: (p) => files[p.split("/").pop()],
  });
  assert.deepStrictEqual(rows.map((r) => r.file).sort(), ["render-status-mac-2.json", "render-status.json"]);
});
