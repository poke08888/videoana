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
