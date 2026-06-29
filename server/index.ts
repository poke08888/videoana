/**
 * server/index.ts — backend Nonelab Studio.
 *
 *  POST /api/analyze       (multipart) — mổ xẻ 1 video bằng Gemini, trả JSON phiếu mổ xẻ
 *  POST /api/gemini/test   (json)      — kiểm tra kết nối API key
 *  GET  /api/health
 *
 * Key Gemini: ưu tiên key người dùng gửi lên (từ màn Quản trị), sau đó tới
 * biến môi trường GEMINI_API_KEY trong .env.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeVideo, testConnection, humanizeError } from "./gemini.js";
import { DEFAULT_MODEL, type AnalyzeForm } from "./nonelabPrompt.js";
import { connectDB, runQuery, allQuery, getQuery, hashPassword, verifyPassword, generateSalt } from "./db.js";
import { buildReportHTML } from "./reportHtml.js";
import { startQueueProcessor } from "./queue.js";
import { signToken, requireAuth, requireAdmin, isValidRole } from "./auth.js";
import { isTikTokUrl, resolveTokapiKey, downloadTikTok } from "./tiktok.js";
import { embedFramesServer } from "./frames.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "16mb" })); // phiếu có nhúng ảnh frame thật (data-URL)

function resolveKey(reqKey?: string): string | null {
  const k = (reqKey || "").trim();
  if (k.length >= 10) return k;
  const env = (process.env.GEMINI_API_KEY || "").trim();
  return env.length >= 10 ? env : null;
}

app.get("/api/history", requireAuth, async (_req, res) => {
  try {
    // Chỉ chọn cột an toàn — KHÔNG bao giờ trả về queue_meta (chứa API key).
    const rows = await allQuery(
      "SELECT id, title, platform, product, date, score, analysis, thumb, status FROM history ORDER BY rowid DESC"
    );
    const history = rows.map((r) => {
      let parsed = {};
      try {
        parsed = JSON.parse(r.analysis);
      } catch (e) {}
      return {
        ...r,
        analysis: parsed,
      };
    });
    res.json(history);
  } catch (e) {
    console.error("Lỗi lấy lịch sử từ SQLite:", e);
    res.status(500).json({ ok: false, error: "database-error" });
  }
});

app.post("/api/history/seed", requireAdmin, async (req, res) => {
  const seeds = req.body?.history;
  if (Array.isArray(seeds)) {
    try {
      const row = await getQuery("SELECT COUNT(*) as count FROM history");
      const count = row ? row.count : 0;
      if (count === 0) {
        for (const entry of seeds) {
          await runQuery(
            "INSERT OR REPLACE INTO history (id, title, platform, product, date, score, analysis, thumb, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              entry.id,
              entry.title,
              entry.platform,
              entry.product,
              entry.date,
              entry.score,
              JSON.stringify(entry.analysis),
              entry.thumb || "",
              "completed"
            ]
          );
        }
        return res.json({ ok: true, count: seeds.length });
      }
    } catch (e) {
      console.error("Lỗi seed dữ liệu SQLite:", e);
      return res.status(500).json({ ok: false, error: "database-error" });
    }
  }
  res.json({ ok: true, count: 0 });
});

app.post("/api/history", requireAuth, async (req, res) => {
  const entry = req.body;
  if (entry && entry.id) {
    try {
      await runQuery(
        "INSERT OR REPLACE INTO history (id, title, platform, product, date, score, analysis, thumb, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          entry.id,
          entry.title,
          entry.platform,
          entry.product,
          entry.date,
          entry.score,
          JSON.stringify(entry.analysis),
          entry.thumb || "",
          entry.status || "completed"
        ]
      );
      return res.json({ ok: true });
    } catch (e) {
      console.error("Lỗi lưu lịch sử vào SQLite:", e);
      return res.status(500).json({ ok: false, error: "database-error" });
    }
  }
  res.status(400).json({ ok: false, error: "invalid-entry" });
});

// 5. API Đăng ký phân tích hàng loạt video chạy nền (Batch Queue)
app.post("/api/analyze/batch", requireAuth, upload.array("videos", 20), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const apiKey = resolveKey(req.body?.apiKey);
  const model = req.body?.model || DEFAULT_MODEL;
  const userEmail = req.user?.email;

  let form: AnalyzeForm = {};
  if (req.body?.form) {
    try {
      form = JSON.parse(req.body.form);
    } catch {
      /* ignore */
    }
  }

  const youtubeUrl = (req.body?.youtubeUrl || "").trim();

  // Danh sách link TikTok: nhận JSON array hoặc chuỗi nhiều dòng; chỉ giữ link hợp lệ.
  const tiktokUrls: string[] = (() => {
    const raw = req.body?.tiktokUrls;
    if (!raw) return [];
    let arr: any[] = [];
    try {
      const j = JSON.parse(raw);
      arr = Array.isArray(j) ? j : String(raw).split(/\r?\n/);
    } catch {
      arr = String(raw).split(/\r?\n/);
    }
    return arr.map((s) => String(s).trim()).filter((s) => isTikTokUrl(s));
  })();

  const tokapiKey = resolveTokapiKey(req.body?.tokapiKey);

  if (!apiKey) {
    for (const file of files) fs.promises.unlink(file.path).catch(() => {});
    return res.status(400).json({ ok: false, error: "no-key", message: "Chưa kết nối Gemini API. Vui lòng nhập API key." });
  }

  if (files.length === 0 && !youtubeUrl && tiktokUrls.length === 0) {
    return res.status(400).json({ ok: false, message: "Vui lòng chọn ít nhất một video hoặc dán link TikTok/YouTube." });
  }

  if (tiktokUrls.length > 0 && !tokapiKey) {
    for (const file of files) fs.promises.unlink(file.path).catch(() => {});
    return res.status(400).json({ ok: false, error: "no-tokapi-key", message: "Chưa cấu hình RapidAPI key cho TikTok (đặt TOKAPI_RAPIDAPI_KEY trong .env)." });
  }

  try {
    const av = [
      "linear-gradient(150deg,#3c7a5e,#2a5a44)",
      "linear-gradient(150deg,#b06a16,#7a4a10)",
      "linear-gradient(150deg,#9e3a3a,#6a2424)",
      "linear-gradient(150deg,#3a2a16,#5a4326)",
      "linear-gradient(150deg,#2f6b8a,#1e4a60)",
    ];
    const pickBg = () => av[Math.floor(Math.random() * av.length)];
    const newId = () => "e" + Math.random().toString(36).slice(2, 8);

    const insertItem = async (title: string, queueMeta: any) => {
      await runQuery(
        "INSERT INTO history (id, title, platform, product, date, score, analysis, thumb, status, queue_meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [newId(), title, form.platform || "TikTok / Douyin", form.product || "", "Hôm nay", 0, "{}", pickBg(), "pending", JSON.stringify(queueMeta)]
      );
    };

    let count = 0;

    // Link TikTok (nhiều) — worker sẽ tự tải video & cập nhật tiêu đề từ caption.
    for (const url of tiktokUrls) {
      await insertItem("Video TikTok (đang tải…)", { apiKey, model, form: { ...form }, tiktokUrl: url, tokapiKey, email: userEmail });
      count++;
    }

    // Video tải lên (nhiều)
    for (const file of files) {
      const title = file.originalname.replace(/\.[^/.]+$/, "");
      await insertItem(title, { apiKey, model, form: { ...form, title }, videoPath: file.path, mimeType: file.mimetype, email: userEmail });
      count++;
    }

    // Link YouTube (đơn)
    if (youtubeUrl) {
      const title = form.title || "Video YouTube";
      await insertItem(title, { apiKey, model, form: { ...form, title }, youtubeUrl, email: userEmail });
      count++;
    }

    res.json({ ok: true, message: `Đã thêm ${count} video vào hàng đợi phân tích.` });
  } catch (err) {
    console.error("Lỗi đăng ký hàng loạt:", err);
    // Dọn dẹp file tạm khi lỗi
    for (const file of files) {
      fs.promises.unlink(file.path).catch(() => {});
    }
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi thiết lập hàng đợi." });
  }
});

// 6. API Chia sẻ phiếu phân tích công khai dưới dạng link
app.get("/share/:id", async (req, res) => {
  try {
    const row = await getQuery("SELECT * FROM history WHERE id = ?", [req.params.id]);
    if (!row) {
      return res.status(404).send("<h3 style=\"text-align:center;margin-top:50px;font-family:sans-serif;color:#574a3a;\">Không tìm thấy phiếu phân tích này hoặc liên kết đã hết hạn.</h3>");
    }
    if (row.status !== "completed") {
      return res.status(400).send("<h3 style=\"text-align:center;margin-top:50px;font-family:sans-serif;color:#574a3a;\">Phiếu phân tích này vẫn đang được xử lý trong hàng đợi chạy nền. Vui lòng quay lại sau!</h3>");
    }
    const analysis = JSON.parse(row.analysis);
    const html = buildReportHTML(analysis);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Lỗi kết xuất trang chia sẻ:", err);
    res.status(500).send("<h3 style=\"text-align:center;margin-top:50px;font-family:sans-serif;color:#574a3a;\">Lỗi hệ thống khi tải phiếu phân tích.</h3>");
  }
});

// Helper map role to default perms
function presetPerms(role: string) {
  const P: Record<string, any> = {
    "Quản trị": { analyze: true, export: true, history: true, manage: true },
    "Biên tập": { analyze: true, export: true, history: true, manage: false },
    "Cộng tác": { analyze: true, export: true, history: false, manage: false },
    "Khách": { analyze: false, export: false, history: false, manage: false },
  };
  return P[role] || P["Khách"];
}

// 1. Đăng ký tài khoản mới
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ ok: false, message: "Vui lòng nhập đầy đủ thông tin." });
  }

  try {
    const existing = await getQuery("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (existing) {
      return res.status(400).json({ ok: false, message: "Email này đã được đăng ký." });
    }

    const salt = generateSalt();
    const hashed = hashPassword(password, salt);
    const av = [
      "linear-gradient(150deg,#3c7a5e,#2a5a44)",
      "linear-gradient(150deg,#b06a16,#7a4a10)",
      "linear-gradient(150deg,#9e3a3a,#6a2424)",
      "linear-gradient(150deg,#3a2a16,#5a4326)",
      "linear-gradient(150deg,#2f6b8a,#1e4a60)",
    ];
    const avBg = av[Math.floor(Math.random() * av.length)];
    const role = "Khách"; // Đăng ký mới mặc định là Khách
    const perms = JSON.stringify(presetPerms(role));

    await runQuery(
      "INSERT INTO users (email, password, salt, name, role, count, active, avBg, perms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [email.toLowerCase().trim(), hashed, salt, name.trim(), role, 0, 1, avBg, perms]
    );

    const user = {
      email: email.toLowerCase().trim(),
      name: name.trim(),
      role,
      count: 0,
      active: 1,
      avBg,
      perms: presetPerms(role)
    };

    res.json({ ok: true, user, token: signToken({ email: user.email, role: user.role }) });
  } catch (err) {
    console.error("Lỗi đăng ký:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi đăng ký." });
  }
});

// 2. Đăng nhập
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ ok: false, message: "Vui lòng nhập email và mật khẩu." });
  }

  try {
    const userRow = await getQuery("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (!userRow) {
      return res.status(401).json({ ok: false, message: "Email hoặc mật khẩu không đúng." });
    }

    if (!userRow.active) {
      return res.status(403).json({ ok: false, message: "Tài khoản của bạn đã bị khóa." });
    }

    if (!verifyPassword(password, userRow.salt, userRow.password)) {
      return res.status(401).json({ ok: false, message: "Email hoặc mật khẩu không đúng." });
    }

    const user = {
      email: userRow.email,
      name: userRow.name,
      role: userRow.role,
      count: userRow.count,
      active: userRow.active,
      avBg: userRow.avBg,
      perms: JSON.parse(userRow.perms)
    };

    res.json({
      ok: true,
      user,
      token: signToken({ email: user.email, role: user.role }),
      mustChangePassword: !!userRow.must_change_password
    });
  } catch (err) {
    console.error("Lỗi đăng nhập:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi đăng nhập." });
  }
});

// 2b. Đổi mật khẩu (cho người đã đăng nhập) — dùng để buộc đổi mật khẩu mặc định.
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ ok: false, message: "Mật khẩu mới phải từ 6 ký tự trở lên." });
  }
  try {
    const row = await getQuery("SELECT salt, password FROM users WHERE email = ?", [req.user!.email]);
    if (!row || !verifyPassword(currentPassword, row.salt, row.password)) {
      return res.status(401).json({ ok: false, message: "Mật khẩu hiện tại không đúng." });
    }
    const salt = generateSalt();
    const hashed = hashPassword(newPassword, salt);
    await runQuery(
      "UPDATE users SET password = ?, salt = ?, must_change_password = 0 WHERE email = ?",
      [hashed, salt, req.user!.email]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Lỗi đổi mật khẩu:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi đổi mật khẩu." });
  }
});

// 3. Lấy tất cả người dùng (chỉ dành cho admin)
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const rows = await allQuery("SELECT email, name, role, count, active, avBg, perms FROM users");
    const users = rows.map((u) => ({
      ...u,
      active: !!u.active,
      perms: JSON.parse(u.perms)
    }));
    res.json(users);
  } catch (err) {
    console.error("Lỗi lấy danh sách người dùng:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống." });
  }
});

// 4. Cập nhật phân quyền / trạng thái người dùng (chỉ admin)
app.post("/api/admin/users/update", requireAdmin, async (req, res) => {
  const { email, role, active, perms } = req.body;
  if (!email || !role) {
    return res.status(400).json({ ok: false, message: "Thiếu thông tin cập nhật." });
  }

  // Vai trò phải nằm trong whitelist — chặn chuỗi tùy ý.
  if (!isValidRole(role)) {
    return res.status(400).json({ ok: false, message: "Vai trò không hợp lệ." });
  }

  const targetEmail = String(email).toLowerCase().trim();

  // Chặn admin tự sửa vai trò / tự khóa chính mình (tránh tự nâng quyền hoặc tự khóa).
  if (targetEmail === req.user!.email.toLowerCase().trim()) {
    if (role !== req.user!.role || !active) {
      return res.status(400).json({
        ok: false,
        message: "Không thể tự thay đổi vai trò hoặc tự khóa tài khoản của chính mình."
      });
    }
  }

  try {
    const permsStr = perms ? JSON.stringify(perms) : JSON.stringify(presetPerms(role));
    await runQuery(
      "UPDATE users SET role = ?, active = ?, perms = ? WHERE email = ?",
      [role, active ? 1 : 0, permsStr, targetEmail]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Lỗi cập nhật người dùng:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi cập nhật." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: DEFAULT_MODEL, hasEnvKey: !!(process.env.GEMINI_API_KEY || "").trim() });
});

app.post("/api/gemini/test", async (req, res) => {
  const key = resolveKey(req.body?.apiKey);
  if (!key) return res.status(400).json({ ok: false, message: "Chưa có API key (nhập key hoặc đặt GEMINI_API_KEY trong .env)." });
  const result = await testConnection(key, req.body?.model);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/analyze", requireAuth, upload.single("video"), async (req, res) => {
  const file = req.file;
  let tiktokPath: string | null = null; // file TikTok tải về (nếu có) để dọn sau
  const cleanup = () => {
    if (file?.path) fs.promises.unlink(file.path).catch(() => {});
    if (tiktokPath) fs.promises.unlink(tiktokPath).catch(() => {});
  };
  try {
    const apiKey = resolveKey(req.body?.apiKey);
    const model = req.body?.model || DEFAULT_MODEL;
    const youtubeUrl = (req.body?.youtubeUrl || "").trim() || undefined;
    const tiktokUrl = (req.body?.tiktokUrl || "").trim();

    let form: AnalyzeForm = {};
    if (req.body?.form) {
      try {
        form = JSON.parse(req.body.form);
      } catch {
        /* ignore */
      }
    } else {
      form = {
        title: req.body?.title,
        platform: req.body?.platform,
        product: req.body?.product,
        genre: req.body?.genre,
        notes: req.body?.notes,
      };
    }

    if (!apiKey) {
      cleanup();
      return res.status(400).json({ ok: false, error: "no-key", message: "Chưa kết nối Gemini API. Vào Quản trị nhập API key, hoặc đặt GEMINI_API_KEY trong .env." });
    }

    // Link TikTok: tự động tải video về server qua RapidAPI (tokapi) rồi phân tích.
    if (tiktokUrl) {
      if (!isTikTokUrl(tiktokUrl)) {
        cleanup();
        return res.status(400).json({ ok: false, error: "bad-tiktok", message: "Link TikTok không hợp lệ." });
      }
      const tkKey = resolveTokapiKey(req.body?.tokapiKey);
      if (!tkKey) {
        cleanup();
        return res.status(400).json({ ok: false, error: "no-tokapi-key", message: "Chưa cấu hình RapidAPI key cho TikTok (đặt TOKAPI_RAPIDAPI_KEY trong .env)." });
      }
      const dl = await downloadTikTok(tiktokUrl, tkKey, UPLOAD_DIR);
      tiktokPath = dl.path;
      if (!form.title && dl.desc) form.title = dl.desc.slice(0, 120);
    }

    const videoPath = file?.path || tiktokPath || undefined;

    const analysis = await analyzeVideo({
      apiKey,
      model,
      form,
      videoPath,
      mimeType: file?.mimetype || "video/mp4",
      youtubeUrl: tiktokUrl ? undefined : youtubeUrl,
    });

    // Video TikTok tải ở server → trình duyệt không có File để trích frame, nên
    // trích frame thật ngay tại server (file vẫn còn trước khi cleanup).
    if (tiktokPath) {
      await embedFramesServer(tiktokPath, analysis);
    }

    const userEmail = req.user?.email;
    if (userEmail) {
      await runQuery("UPDATE users SET count = count + 1 WHERE email = ?", [userEmail.toLowerCase().trim()]).catch(() => {});
    }

    cleanup();
    res.json({ ok: true, analysis, usedAI: true, watchedVideo: !!(file || tiktokPath || youtubeUrl), model });
  } catch (err: any) {
    cleanup();
    res.status(502).json({ ok: false, error: "gemini-failed", message: humanizeError(err) });
  }
});

// Phục vụ frontend đã build trong production
if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = Number(process.env.PORT || 8787);

async function startServer() {
  await connectDB();
  startQueueProcessor(); // Khởi động hàng đợi chạy nền
  app.listen(PORT, () => {
    console.log(`[nonelab] backend chạy ở http://localhost:${PORT}  (model mặc định: ${DEFAULT_MODEL})`);
    if (!(process.env.GEMINI_API_KEY || "").trim()) {
      console.log("[nonelab] Chưa có GEMINI_API_KEY trong .env — người dùng cần nhập key ở màn Quản trị.");
    }
  });
}

startServer();
