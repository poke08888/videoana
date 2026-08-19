const { test } = require("node:test");
const assert = require("node:assert");
const { localizePayload, getEnMap, clearCache, localizeSeriesResponse } = require("../util/seriesI18n");

const MAP = new Map([["s1", { name: "War God", description: "english desc" }]]);

test("thay tên phim ở dạng danh sách chi tiết", () => {
  const body = { data: [{ _id: "s1", name: "Chiến Thần", description: "mô tả Việt" }, { _id: "s2", name: "Phim Khác" }] };
  localizePayload(body, MAP);
  assert.strictEqual(body.data[0].name, "War God");
  assert.strictEqual(body.data[0].description, "english desc");
  assert.strictEqual(body.data[1].name, "Phim Khác"); // phim chưa dịch: giữ nguyên
});

test("thay tên ở dạng nhóm (movieSeriesName) và ở object lồng sâu", () => {
  const body = { data: { _id: "s1", movieSeriesName: "Chiến Thần", movieSeriesDescription: "mô tả Việt", videos: [{ _id: "v9", name: "tập 1" }] } };
  localizePayload(body, MAP);
  assert.strictEqual(body.data.movieSeriesName, "War God");
  assert.strictEqual(body.data.movieSeriesDescription, "english desc");
  assert.strictEqual(body.data.videos[0].name, "tập 1"); // id tập không nằm trong map
});

test("KHÔNG chạm field name của thứ khác trùng tên field", () => {
  const body = { user: { _id: "u1", name: "Kevin" }, category: { _id: "c1", name: "Ngôn tình" } };
  localizePayload(body, MAP);
  assert.strictEqual(body.user.name, "Kevin");
  assert.strictEqual(body.category.name, "Ngôn tình");
});

test("thiếu mô tả tiếng Anh -> giữ mô tả tiếng Việt, chỉ đổi tên", () => {
  const map = new Map([["s1", { name: "War God", description: "" }]]);
  const body = { _id: "s1", name: "Chiến Thần", description: "mô tả Việt" };
  localizePayload(body, map);
  assert.strictEqual(body.name, "War God");
  assert.strictEqual(body.description, "mô tả Việt");
});

test("payload rỗng / không phải object -> không nổ", () => {
  assert.strictEqual(localizePayload(null, MAP), null);
  assert.strictEqual(localizePayload("chuỗi", MAP), "chuỗi");
  assert.deepStrictEqual(localizePayload([], MAP), []);
});

test("map có cache theo thời gian, hết hạn mới nạp lại", async () => {
  clearCache();
  let calls = 0;
  const find = async () => { calls++; return [{ _id: "s1", nameEn: "War God", descriptionEn: "d" }]; };
  const a = await getEnMap({ now: 1000, find, ttl: 500 });
  assert.strictEqual(a.get("s1").name, "War God");
  await getEnMap({ now: 1200, find, ttl: 500 });
  assert.strictEqual(calls, 1, "trong hạn thì không truy vấn lại");
  await getEnMap({ now: 2000, find, ttl: 500 });
  assert.strictEqual(calls, 2, "hết hạn thì nạp lại");
  clearCache();
});

test("người xem ở Việt Nam: middleware không đụng vào res.json", async () => {
  const res = { json: (b) => b };
  const original = res.json;
  const mw = localizeSeriesResponse({ resolveLang: () => "vi", getMap: async () => MAP });
  await mw({}, res, () => {});
  assert.strictEqual(res.json, original);
});

test("người xem nước ngoài: res.json được bọc và dịch", async () => {
  let sent = null;
  const res = { json: (b) => { sent = b; } };
  const mw = localizeSeriesResponse({ resolveLang: () => "en", getMap: async () => MAP });
  await new Promise((done) => mw({}, res, done));
  res.json({ data: { _id: "s1", name: "Chiến Thần" } });
  assert.strictEqual(sent.data.name, "War God");
});

test("lỗi nạp map -> trả nguyên bản, không chặn request", async () => {
  const res = { json: (b) => b };
  const original = res.json;
  const mw = localizeSeriesResponse({ resolveLang: () => "en", getMap: async () => { throw new Error("mongo sập"); } });
  let called = false;
  await mw({}, res, () => { called = true; });
  assert.strictEqual(called, true);
  assert.strictEqual(res.json, original);
});
