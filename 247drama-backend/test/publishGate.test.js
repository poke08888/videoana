const { test } = require("node:test");
const assert = require("node:assert");
const { evaluateSeries, publishedMatch, hasSource } = require("../util/publishGate");

const phim = (over = {}) => ({ sourceProvider: "52api-hm", bookId: "hm:1", sourceEpisodeCount: 50, ...over });
const tap = (over = {}) => ({ have: 50, uniq: 50, minEp: 0, maxEp: 49, bad: [], ...over });

test("đủ tập, không tập nào hỏng -> lên app", () => {
  const r = evaluateSeries(phim(), tap());
  assert.strictEqual(r.isComplete, true);
  assert.strictEqual(r.completeness.reason, "");
  assert.strictEqual(r.completeness.missing, 0);
});

test("mới render một phần -> ẩn, nói rõ còn thiếu bao nhiêu", () => {
  const r = evaluateSeries(phim(), tap({ have: 21, uniq: 21, maxEp: 20 }));
  assert.strictEqual(r.isComplete, false);
  assert.strictEqual(r.completeness.reason, "mới có 21/50 tập");
  assert.strictEqual(r.completeness.missing, 29);
});

test("đủ số tập nhưng có tập không phụ đề -> vẫn ẩn, liệt kê tập lỗi (đếm từ 1)", () => {
  const r = evaluateSeries(phim(), tap({ bad: [22, 25] }));
  assert.strictEqual(r.isComplete, false);
  assert.strictEqual(r.completeness.reason, "2 tập lỗi (tập 23, 26)");
  assert.deepStrictEqual(r.completeness.badEps, [22, 25]);
});

test("nhiều tập lỗi -> chỉ kể 8 tập đầu rồi tóm tắt phần còn lại", () => {
  const bad = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const r = evaluateSeries(phim(), tap({ bad }));
  assert.strictEqual(r.completeness.reason, "10 tập lỗi (tập 1, 2, 3, 4, 5, 6, 7, 8, +2 tập nữa)");
});

test("chưa có tập nào -> ẩn", () => {
  assert.strictEqual(evaluateSeries(phim(), undefined).completeness.reason, "chưa có tập nào");
});

test("phim nguồn chưa biết tổng số tập -> ẩn, KHÔNG đoán là đã xong", () => {
  const r = evaluateSeries(phim({ sourceEpisodeCount: 0 }), tap({ have: 3, uniq: 3, maxEp: 2 }));
  assert.strictEqual(r.isComplete, false);
  assert.strictEqual(r.completeness.reason, "chưa biết tổng số tập bên nguồn");
});

test("phim admin tự tạo tay (không nguồn) -> lấy chính số tập đang có làm tổng", () => {
  const r = evaluateSeries({ sourceEpisodeCount: 0 }, tap({ have: 3, uniq: 3, maxEp: 2 }));
  assert.strictEqual(r.isComplete, true);
  assert.strictEqual(r.completeness.expected, 3);
});

test("đủ số lượng nhưng thủng ở giữa -> ẩn", () => {
  const r = evaluateSeries(phim({ sourceEpisodeCount: 3 }), tap({ have: 3, uniq: 3, minEp: 0, maxEp: 5 }));
  assert.strictEqual(r.isComplete, false);
  assert.strictEqual(r.completeness.reason, "số tập đứt quãng, thiếu tập ở giữa");
});

test("hai bản ghi cùng một số tập -> ẩn", () => {
  const r = evaluateSeries(phim({ sourceEpisodeCount: 3 }), tap({ have: 4, uniq: 3, minEp: 0, maxEp: 2 }));
  assert.strictEqual(r.isComplete, false);
  assert.strictEqual(r.completeness.reason, "có tập trùng số");
});

test("tập đánh số từ 1 (phim nhập đời cũ) vẫn được coi là liền mạch", () => {
  const r = evaluateSeries(phim({ sourceEpisodeCount: 50 }), tap({ minEp: 1, maxEp: 50 }));
  assert.strictEqual(r.isComplete, true);
});

test("nguồn rút bớt tập, kho ta nhiều hơn -> vẫn cho lên app", () => {
  const r = evaluateSeries(phim({ sourceEpisodeCount: 48 }), tap());
  assert.strictEqual(r.isComplete, true);
});

test("nhận ra phim có nguồn qua bookId dù thiếu sourceProvider", () => {
  assert.strictEqual(hasSource({ bookId: "dl:8494" }), true);
  assert.strictEqual(hasSource({ sourceProvider: "52api-hg" }), true);
  assert.strictEqual(hasSource({}), false);
});

test("bộ lọc dùng chung ghép được tiền tố sau $lookup", () => {
  assert.deepStrictEqual(publishedMatch(), { isActive: true, isComplete: true });
  assert.deepStrictEqual(publishedMatch("movie."), { "movie.isActive": true, "movie.isComplete": true });
});
