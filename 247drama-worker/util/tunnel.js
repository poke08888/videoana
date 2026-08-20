// Giữ tunnel SOCKS sang VPS Hong Kong luôn sống.
//
// Phim nguồn hm tải qua CDN cbread.cn — bị chặn từ Việt Nam, bắt buộc đi vòng qua HK. Tunnel
// là một tiến trình ssh: máy ngủ, rớt mạng hay VPS restart là nó chết lặng lẽ, và từ đó MỌI
// tập hm đều lỗi "ECONNREFUSED 127.0.0.1:1080" cho tới khi có người để ý. Kiểm mỗi vòng quét
// tốn một lần mở cổng nội bộ, rẻ hơn nhiều so với hàng chục tập hỏng.
const net = require("net");
const { execFile } = require("child_process");

function isPortOpen(port, host = "127.0.0.1", timeout = 1500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (open) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

function runScript(script, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile("bash", [script], { timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").trim().slice(0, 200)));
      resolve(String(stdout || "").trim());
    });
  });
}

/**
 * Cổng đang mở thì thôi; đang đóng thì chạy script mở lại rồi kiểm tra lại.
 * @returns {Promise<{ok:boolean, action:"đang chạy"|"đã mở lại"|"mở lại thất bại", reason:string}>}
 */
async function ensureTunnel({ port = 1080, script, check = isPortOpen, exec = runScript } = {}) {
  if (await check(port)) return { ok: true, action: "đang chạy", reason: "" };
  if (!script) return { ok: false, action: "mở lại thất bại", reason: "chưa cấu hình script tunnel" };
  try {
    await exec(script);
  } catch (e) {
    return { ok: false, action: "mở lại thất bại", reason: e.message };
  }
  const up = await check(port);
  return up
    ? { ok: true, action: "đã mở lại", reason: "" }
    : { ok: false, action: "mở lại thất bại", reason: "chạy script xong cổng vẫn đóng" };
}

module.exports = { ensureTunnel, isPortOpen };
