const { test } = require("node:test");
const assert = require("node:assert");
const { resolveSubLang, pickClientIp } = require("../util/geoLang");

const req = (headers = {}, ip) => ({ headers, ip, socket: { remoteAddress: ip } });

test("lấy IP đầu tiên trong X-Forwarded-For", () => {
  assert.strictEqual(pickClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
});

test("không có header thì lấy remoteAddress, bỏ tiền tố IPv6-mapped", () => {
  assert.strictEqual(pickClientIp(req({}, "::ffff:5.6.7.8")), "5.6.7.8");
});

test("IP Việt Nam -> vi", () => {
  const lookup = () => ({ country: "VN" });
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "113.161.0.1" }), lookup), "vi");
});

test("IP nước ngoài -> en", () => {
  const lookup = () => ({ country: "US" });
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "8.8.8.8" }), lookup), "en");
});

test("không tra được -> vi (thị trường chính)", () => {
  assert.strictEqual(resolveSubLang(req({}), () => null), "vi");
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "rác" }), () => null), "vi");
});

const { loadLangTable, resetLangTable, DEFAULT_TABLE } = require("../util/geoLang");

test("bảng mặc định: Thái -> th, Indo -> id, nước khác -> en", () => {
  const req = (h) => ({ headers: h });
  const lookup = (ip) => ({ "1.1.1.1": { country: "TH" }, "2.2.2.2": { country: "ID" }, "3.3.3.3": { country: "JP" } }[ip]);
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "1.1.1.1" }), lookup), "th");
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "2.2.2.2" }), lookup), "id");
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "3.3.3.3" }), lookup), "en");
});

test("bảng sửa trong Setting được áp dụng, quốc gia lạ theo ngôn ngữ dự phòng", async () => {
  resetLangTable();
  await loadLangTable({ now: 1000, find: async () => ({ geoLangs: { vn: "vi", ph: "en", jp: "id" }, geoFallbackLang: "th" }) });
  const req = (h) => ({ headers: h });
  const lookup = (ip) => ({ "4.4.4.4": { country: "JP" }, "5.5.5.5": { country: "KR" } }[ip]);
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "4.4.4.4" }), lookup), "id");
  assert.strictEqual(resolveSubLang(req({ "x-forwarded-for": "5.5.5.5" }), lookup), "th");
  resetLangTable();
});

test("bảng rỗng trong Setting -> quay về bảng mặc định", async () => {
  resetLangTable();
  await loadLangTable({ now: 2000, find: async () => ({ geoLangs: {} }) });
  const lookup = () => ({ country: "TH" });
  assert.strictEqual(resolveSubLang({ headers: {} }, lookup), DEFAULT_TABLE.TH);
  resetLangTable();
});

test("tra IP hụt vẫn về tiếng Việt dù bảng có đổi", async () => {
  resetLangTable();
  await loadLangTable({ now: 3000, find: async () => ({ geoLangs: { TH: "th" }, geoFallbackLang: "en" }) });
  assert.strictEqual(resolveSubLang({ headers: {} }, () => null), "vi");
  resetLangTable();
});
