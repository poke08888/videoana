const { test } = require("node:test");
const assert = require("node:assert");
const { buildSeriesDoc } = require("../util/opsSeries");

const INFO = { name: "Phim A", description: "mô tả", cover: "http://x/a.jpg", episodeCount: 42 };

test("dựng đúng bookId và sourceProvider cho worker nhặt việc", () => {
  const d = buildSeriesDoc({ provider: "hg", sourceId: "999", info: INFO, categoryId: "c1", languageId: "l1", type: 2 });
  assert.strictEqual(d.bookId, "hg:999");
  assert.strictEqual(d.sourceProvider, "52api-hg");
  assert.strictEqual(d.sourceEpisodeCount, 42);
  assert.strictEqual(d.createdByOps, true);
});

test("lấy tên, mô tả, ảnh từ nguồn; banner dùng chung ảnh bìa", () => {
  const d = buildSeriesDoc({ provider: "hm", sourceId: "5", info: INFO, categoryId: "c1", languageId: "l1", type: 2 });
  assert.strictEqual(d.name, "Phim A");
  assert.strictEqual(d.description, "mô tả");
  assert.strictEqual(d.thumbnail, "http://x/a.jpg");
  assert.strictEqual(d.banner, "http://x/a.jpg");
});

test("thiếu tên nguồn -> ném lỗi thay vì tạo phim vô danh", () => {
  assert.throws(
    () => buildSeriesDoc({ provider: "hg", sourceId: "1", info: { ...INFO, name: "" }, categoryId: "c1", languageId: "l1", type: 2 }),
    /tên phim/,
  );
});

test("thiếu category hoặc language -> ném lỗi", () => {
  assert.throws(() => buildSeriesDoc({ provider: "hg", sourceId: "1", info: INFO, categoryId: "", languageId: "l1", type: 2 }), /category/);
  assert.throws(() => buildSeriesDoc({ provider: "hg", sourceId: "1", info: INFO, categoryId: "c1", languageId: "", type: 2 }), /language/);
});

test("provider lạ -> ném lỗi", () => {
  assert.throws(() => buildSeriesDoc({ provider: "xx", sourceId: "1", info: INFO, categoryId: "c1", languageId: "l1", type: 2 }), /provider/);
});
