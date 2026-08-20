const { test } = require("node:test");
const assert = require("node:assert");
const { claimEpisode, releaseEpisode, sweepExpired, claimKey } = require("../util/claims");

// Kho giả mô phỏng đúng hai tính chất Mongo mà cơ chế này dựa vào: _id là duy nhất, và
// findOneAndUpdate chỉ sửa khi bản ghi khớp điều kiện.
function fakeCol() {
  const docs = new Map();
  return {
    docs,
    async insertOne(d) {
      if (docs.has(d._id)) { const e = new Error("duplicate key"); e.code = 11000; throw e; }
      docs.set(d._id, { ...d });
    },
    async findOneAndUpdate(filter, update) {
      const d = docs.get(filter._id);
      if (!d) return null;
      if (filter.at && filter.at.$lt && !(d.at < filter.at.$lt)) return null;
      Object.assign(d, update.$set);
      return { value: { ...d } };
    },
    async deleteOne(filter) { docs.delete(filter._id); },
    async deleteMany(filter) {
      let n = 0;
      for (const [k, d] of docs) if (d.at < filter.at.$lt) { docs.delete(k); n++; }
      return { deletedCount: n };
    },
  };
}

const ep = { provider: "hg", sourceId: "1", index: 5 };

test("máy đầu nhận được tập, máy thứ hai bị chặn", async () => {
  const col = fakeCol();
  assert.strictEqual(await claimEpisode(col, { ...ep, worker: "mac-1" }), true);
  assert.strictEqual(await claimEpisode(col, { ...ep, worker: "mac-2" }), false);
});

test("hai tập khác nhau thì hai máy làm song song được", async () => {
  const col = fakeCol();
  assert.strictEqual(await claimEpisode(col, { ...ep, index: 1, worker: "mac-1" }), true);
  assert.strictEqual(await claimEpisode(col, { ...ep, index: 2, worker: "mac-2" }), true);
});

test("máy giữ tập bị tắt ngang -> quá hạn thì máy khác nhận lại", async () => {
  const col = fakeCol();
  const t0 = 1_000_000;
  await claimEpisode(col, { ...ep, worker: "mac-1", now: t0 });
  // còn hạn: chưa ai giành được
  assert.strictEqual(await claimEpisode(col, { ...ep, worker: "mac-2", now: t0 + 60_000 }), false);
  // quá hạn 20 phút: máy khác tiếp quản
  assert.strictEqual(await claimEpisode(col, { ...ep, worker: "mac-2", now: t0 + 21 * 60_000 }), true);
  assert.strictEqual(col.docs.get(claimKey("hg", "1", 5)).worker, "mac-2");
});

test("làm xong thì trả phần nhận, máy khác nhận lại được ngay", async () => {
  const col = fakeCol();
  await claimEpisode(col, { ...ep, worker: "mac-1" });
  await releaseEpisode(col, ep);
  assert.strictEqual(col.docs.size, 0);
  assert.strictEqual(await claimEpisode(col, { ...ep, worker: "mac-2" }), true);
});

test("dọn phần nhận quá hạn, giữ nguyên phần đang chạy", async () => {
  const col = fakeCol();
  const t0 = 1_000_000;
  await claimEpisode(col, { ...ep, index: 1, worker: "mac-cũ", now: t0 });
  await claimEpisode(col, { ...ep, index: 2, worker: "mac-đang-chạy", now: t0 + 21 * 60_000 });
  const n = await sweepExpired(col, { now: t0 + 22 * 60_000 });
  assert.strictEqual(n, 1);
  assert.strictEqual(col.docs.size, 1);
  assert.ok(col.docs.has(claimKey("hg", "1", 2)));
});

test("lỗi kho khác lỗi trùng khoá -> ném ra, không im lặng bỏ tập", async () => {
  const col = fakeCol();
  col.insertOne = async () => { const e = new Error("mất kết nối"); e.code = 91; throw e; };
  await assert.rejects(() => claimEpisode(col, { ...ep, worker: "mac-1" }), /mất kết nối/);
});
