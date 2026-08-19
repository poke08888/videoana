// Khoá riêng cho nhóm /api/ops: lộ khoá này KHÔNG mở được API người dùng, và ngược lại.
// Mật khẩu đặt trong .env của server (OPS_PASSWORD), không bao giờ nằm trong code.
function opsAuth() {
  return (req, res, next) => {
    const expected = process.env.OPS_PASSWORD || "";
    if (!expected) {
      return res.status(503).json({ status: false, message: "Server chưa cấu hình OPS_PASSWORD" });
    }
    const got = (req.headers && req.headers["ops-key"]) || "";
    if (got !== expected) {
      return res.status(401).json({ status: false, message: "Sai khoá vận hành" });
    }
    next();
  };
}

module.exports = { opsAuth };
