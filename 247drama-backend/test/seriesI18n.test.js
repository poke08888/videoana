const { test } = require("node:test");
const assert = require("node:assert");
const { localizePayload, getTransMap, clearCache, localizeSeriesResponse } = require("../util/seriesI18n");

const MAP = new Map([
  ["s1", {
    en: { name: "War God", description: "english desc" },
    th: { name: "เทพสงคราม", description: "คำอธิบาย" },
  }],
]);
const noTable = async () => ({});

test("thay tên phim theo đúng ngôn ngữ được chọn", () => {
  const body = { data: [{ _id: "s1", name: "Chiến Thần", description: "mô tả Việt" }, { _id: "s2", name: "Phim Khác" }] };
  localizePayload(body, MAP, "th");
  assert.strictEqual(body.data[0].name, "เทพสงคราม");
  assert.strictEqual(body.data[0].description, "คำอธิบาย");
  assert.strictEqual(body.data[1].name, "Phim Khác");
});

test("phim chưa có ngôn ngữ đó -> giữ nguyên bản tiếng Việt", () => {
  const body = { _id: "s1", name: "Chiến Thần", description: "mô tả Việt" };
  localizePayload(body, MAP, "id");
  assert.strictEqual(body.name, "Chiến Thần");
});

test("thay tên ở dạng nhóm (movieSeriesName) và object lồng sâu", () => {
  const body = { data: { _id: "s1", movieSeriesName: "Chiến Thần", movieSeriesDescription: "mô tả Việt", videos: [{ _id: "v9", name: "tập 1" }] } };
  localizePayload(body, MAP, "en");
  assert.strictEqual(body.data.movieSeriesName, "War God");
  assert.strictEqual(body.data.movieSeriesDescription, "english desc");
  assert.strictEqual(body.data.videos[0].name, "tập 1");
});

test("KHÔNG chạm field name của thứ khác trùng tên field", () => {
  const body = { user: { _id: "u1", name: "Kevin" }, category: { _id: "c1", name: "Ngôn tình" } };
  localizePayload(body, MAP, "en");
  assert.strictEqual(body.user.name, "Kevin");
  assert.strictEqual(body.category.name, "Ngôn tình");
});

test("thiếu mô tả dịch -> giữ mô tả tiếng Việt, chỉ đổi tên", () => {
  const map = new Map([["s1", { en: { name: "War God", description: "" } }]]);
  const body = { _id: "s1", name: "Chiến Thần", description: "mô tả Việt" };
  localizePayload(body, map, "en");
  assert.strictEqual(body.name, "War God");
  assert.strictEqual(body.description, "mô tả Việt");
});

test("payload rỗng / không phải object -> không nổ", () => {
  assert.strictEqual(localizePayload(null, MAP, "en"), null);
  assert.strictEqual(localizePayload("chuỗi", MAP, "en"), "chuỗi");
  assert.deepStrictEqual(localizePayload([], MAP, "en"), []);
});

test("map gộp cả phim dịch từ bản cũ (chỉ có nameEn)", async () => {
  clearCache();
  const find = async () => [
    { _id: "s1", i18n: { th: { name: "เทพสงคราม", description: "" } } },
    { _id: "s2", nameEn: "Old English", descriptionEn: "desc" },
  ];
  const map = await getTransMap({ now: 1000, find, ttl: 500 });
  assert.strictEqual(map.get("s1").th.name, "เทพสงคราม");
  assert.strictEqual(map.get("s2").en.name, "Old English");
  clearCache();
});

test("map có cache theo thời gian, hết hạn mới nạp lại", async () => {
  clearCache();
  let calls = 0;
  const find = async () => { calls++; return [{ _id: "s1", i18n: { en: { name: "War God", description: "d" } } }]; };
  await getTransMap({ now: 1000, find, ttl: 500 });
  await getTransMap({ now: 1200, find, ttl: 500 });
  assert.strictEqual(calls, 1, "trong hạn thì không truy vấn lại");
  await getTransMap({ now: 2000, find, ttl: 500 });
  assert.strictEqual(calls, 2, "hết hạn thì nạp lại");
  clearCache();
});

test("người xem ở Việt Nam: giữ tên tiếng Việt nhưng vẫn kèm bản dịch cho app", async () => {
  let sent = null;
  const res = { json: (b) => { sent = b; } };
  const mw = localizeSeriesResponse({ resolveLang: () => "vi", getMap: async () => MAP, loadLangTable: noTable });
  await new Promise((done) => mw({}, res, done));
  res.json({ status: true, data: { _id: "s1", name: "Chiến Thần", description: "mô tả Việt" } });
  assert.strictEqual(sent.data.name, "Chiến Thần", "người Việt vẫn thấy tên tiếng Việt");
  assert.strictEqual(sent.data.i18n.th.name, "เทพสงคราม", "nhưng app đọc được bản Thái");
  assert.strictEqual(sent.contentLang, "vi");
});

test("phản hồi ghi rõ server đã chọn ngôn ngữ nào", async () => {
  let sent = null;
  const res = { json: (b) => { sent = b; } };
  const mw = localizeSeriesResponse({ resolveLang: () => "th", getMap: async () => MAP, loadLangTable: noTable });
  await new Promise((done) => mw({}, res, done));
  res.json({ status: true, data: { _id: "s1", name: "Chiến Thần" } });
  assert.strictEqual(sent.contentLang, "th");
  assert.strictEqual(sent.data.name, "เทพสงคราม");
});

test("người xem Thái Lan: res.json được bọc và trả bản tiếng Thái", async () => {
  let sent = null;
  const res = { json: (b) => { sent = b; } };
  const mw = localizeSeriesResponse({ resolveLang: () => "th", getMap: async () => MAP, loadLangTable: noTable });
  await new Promise((done) => mw({}, res, done));
  res.json({ data: { _id: "s1", name: "Chiến Thần" } });
  assert.strictEqual(sent.data.name, "เทพสงคราม");
});

test("lỗi nạp map -> trả nguyên bản, không chặn request", async () => {
  const res = { json: (b) => b };
  const original = res.json;
  const mw = localizeSeriesResponse({ resolveLang: () => "en", getMap: async () => { throw new Error("mongo sập"); }, loadLangTable: noTable });
  let called = false;
  await mw({}, res, () => { called = true; });
  assert.strictEqual(called, true);
  assert.strictEqual(res.json, original);
});
