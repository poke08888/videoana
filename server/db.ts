import sqlite3 from "sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB_PATH cho phép trỏ DB ra volume bền vững (production). Mặc định: cạnh source.
const DB_PATH = (process.env.DB_PATH || "").trim() || path.join(__dirname, "db.sqlite");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); // đảm bảo thư mục DB tồn tại

// Kết nối cơ sở dữ liệu SQLite
export const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("[nonelab] Kết nối SQLite thất bại:", err);
  } else {
    console.log(`[nonelab] Kết nối SQLite thành công: ${DB_PATH}`);
  }
});

// Helper chạy câu lệnh không trả về dữ liệu (INSERT, UPDATE, DELETE, CREATE TABLE)
export function runQuery(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Helper lấy toàn bộ dòng (SELECT)
export function allQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

// Helper lấy một dòng duy nhất (SELECT LIMIT 1)
export function getQuery<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

// PBKDF2: số vòng lặp theo khuyến nghị OWASP cho SHA-512 (≥210.000).
const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = "sha512";
// Số vòng của lược đồ cũ (raw-hex, không có tiền tố) để xác thực ngược.
const LEGACY_ITERATIONS = 1000;

// Helper băm mật khẩu bằng PBKDF2. Định dạng lưu: `pbkdf2$<iterations>$<hex>`.
export function hashPassword(password: string, salt: string, iterations = PBKDF2_ITERATIONS): string {
  const hex = crypto.pbkdf2Sync(password, salt, iterations, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
  return `pbkdf2$${iterations}$${hex}`;
}

/**
 * So khớp mật khẩu với giá trị đã lưu (chống timing-attack bằng timingSafeEqual).
 * Hỗ trợ cả lược đồ cũ (raw-hex 1000 vòng) để không khóa tài khoản đã tồn tại.
 */
export function verifyPassword(password: string, salt: string, stored: string): boolean {
  let iterations = PBKDF2_ITERATIONS;
  let expectedHex = stored;
  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    iterations = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
    expectedHex = parts[2] || "";
  } else {
    iterations = LEGACY_ITERATIONS; // hash cũ dạng hex thuần
  }
  const actualHex = crypto.pbkdf2Sync(password, salt, iterations, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
  const a = Buffer.from(actualHex, "hex");
  const b = Buffer.from(expectedHex, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Helper sinh salt ngẫu nhiên
export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Thêm cột vào bảng nếu chưa tồn tại (bỏ qua lỗi "duplicate column").
async function addColumnIfMissing(table: string, columnDef: string) {
  try {
    await runQuery(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch {
    /* cột đã tồn tại — bỏ qua */
  }
}

// Hàm khởi tạo các bảng dữ liệu
export async function connectDB() {
  // 1. Tạo bảng history
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      product TEXT NOT NULL,
      date TEXT NOT NULL,
      score REAL NOT NULL,
      analysis TEXT NOT NULL,
      thumb TEXT DEFAULT '',
      status TEXT DEFAULT 'completed',
      queue_meta TEXT
    )
  `;
  await runQuery(createTableSql);

  // 2. Tạo bảng users
  const createUsersTableSql = `
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      salt TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Khách',
      count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      avBg TEXT,
      perms TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 0
    )
  `;
  await runQuery(createUsersTableSql);

  // 2b. Migration cho DB đã tồn tại từ phiên bản cũ — thêm cột nếu thiếu.
  await addColumnIfMissing("history", "queue_meta TEXT");
  await addColumnIfMissing("history", "cohort_id TEXT"); // gom video theo cụm import
  await addColumnIfMissing("history", "owner TEXT"); // email người tạo — chỉ chủ sở hữu (và admin) xem được
  await addColumnIfMissing("history", "source_url TEXT"); // link video gốc — để tái dùng phân tích khi trùng link
  // Backfill source_url cho phiếu cũ đã hoàn tất (lấy từ JSON analysis). Best-effort
  // — cần JSON1 của SQLite; nếu không có thì bỏ qua (catch).
  try {
    await runQuery("UPDATE history SET source_url = json_extract(analysis, '$.sourceUrl') WHERE source_url IS NULL AND status='completed' AND json_valid(analysis) AND json_extract(analysis, '$.sourceUrl') IS NOT NULL");
  } catch (e) {
    console.warn("[nonelab] Bỏ qua backfill source_url (JSON1 không khả dụng?)");
  }
  await addColumnIfMissing("users", "must_change_password INTEGER DEFAULT 0");

  // 2c. Bảng cụm phân tích chỉ số ads (mỗi lần import 1 file Excel = 1 cohort).
  await runQuery(`
    CREATE TABLE IF NOT EXISTS ads_cohorts (
      id TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      product_slug TEXT NOT NULL,
      created TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      summary TEXT,          -- JSON: benchmarks + phân loại + kết luận phía chỉ số
      insight TEXT,          -- JSON: kết luận content↔chỉ số (điền sau khi mổ xẻ xong)
      kind TEXT DEFAULT 'ads' -- 'ads' (import Excel) | 'campaign' (search keyword)
    )
  `);
  // Migration ads_cohorts — PHẢI chạy SAU CREATE TABLE (nếu bảng chưa tồn tại,
  // ALTER trước CREATE sẽ thất bại và cột owner không được thêm).
  await addColumnIfMissing("ads_cohorts", "kind TEXT DEFAULT 'ads'"); // 'ads' | 'campaign'
  await addColumnIfMissing("ads_cohorts", "owner TEXT"); // email người tạo cụm

  // 2d. Kho kiến thức theo sản phẩm — chắt lọc từ các cụm, bơm vào prompt sau này.
  await runQuery(`
    CREATE TABLE IF NOT EXISTS product_knowledge (
      slug TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      content TEXT NOT NULL,  -- markdown/JSON kiến thức bổ sung cho sản phẩm
      updated TEXT NOT NULL
    )
  `);

  // 3. Tự động Seed 5 người dùng mặc định nếu bảng users trống
  try {
    const userRow = await getQuery("SELECT COUNT(*) as count FROM users");
    const count = userRow ? userRow.count : 0;
    if (count === 0) {
      const av = [
        "linear-gradient(150deg,#3c7a5e,#2a5a44)",
        "linear-gradient(150deg,#b06a16,#7a4a10)",
        "linear-gradient(150deg,#9e3a3a,#6a2424)",
        "linear-gradient(150deg,#3a2a16,#5a4326)",
        "linear-gradient(150deg,#2f6b8a,#1e4a60)",
      ];
      const defaultUsers = [
        { name: "Admin Nerman", email: "k@nerman.asia", role: "Quản trị" },
      ];

      const presetPerms = (role: string) => {
        const P: Record<string, any> = {
          "Quản trị": { analyze: true, export: true, history: true, manage: true },
          "Biên tập": { analyze: true, export: true, history: true, manage: false },
          "Cộng tác": { analyze: true, export: true, history: false, manage: false },
          "Khách": { analyze: false, export: false, history: false, manage: false },
        };
        return P[role] || P["Khách"];
      };

      // Mật khẩu admin khởi tạo: lấy từ ADMIN_INIT_PASSWORD, nếu thiếu thì sinh
      // ngẫu nhiên và in ra console. Luôn bật must_change_password để buộc đổi.
      const envPass = (process.env.ADMIN_INIT_PASSWORD || "").trim();
      const initialPassword = envPass.length >= 6 ? envPass : crypto.randomBytes(9).toString("base64url");

      for (let i = 0; i < defaultUsers.length; i++) {
        const u = defaultUsers[i];
        const salt = generateSalt();
        const hashed = hashPassword(initialPassword, salt);
        const avBg = av[i % av.length];
        const perms = JSON.stringify(presetPerms(u.role));
        await runQuery(
          "INSERT INTO users (email, password, salt, name, role, count, active, avBg, perms, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            u.email,
            hashed,
            salt,
            u.name,
            u.role,
            0,
            1,
            avBg,
            perms,
            1
          ]
        );
      }
      console.log("[nonelab] Đã seed tài khoản admin mặc định.");
      if (!envPass) {
        console.log(
          `[nonelab] ⚠ Mật khẩu admin khởi tạo (đổi ngay sau khi đăng nhập): ${initialPassword}\n` +
            "[nonelab]   Đặt ADMIN_INIT_PASSWORD trong .env để tự chọn mật khẩu khởi tạo."
        );
      } else {
        console.log("[nonelab] Mật khẩu admin lấy từ ADMIN_INIT_PASSWORD — buộc đổi ở lần đăng nhập đầu.");
      }
    } else {
      // DB cũ: nếu admin mặc định vẫn dùng mật khẩu "123456" (lược đồ cũ) thì buộc đổi.
      try {
        const admin = await getQuery<{ email: string; salt: string; password: string }>(
          "SELECT email, salt, password FROM users WHERE email = ?",
          ["k@nerman.asia"]
        );
        if (admin && verifyPassword("123456", admin.salt, admin.password)) {
          await runQuery("UPDATE users SET must_change_password = 1 WHERE email = ?", [admin.email]);
          console.log("[nonelab] ⚠ Admin mặc định vẫn dùng mật khẩu yếu '123456' — đã bật cờ buộc đổi mật khẩu.");
        }
      } catch {
        /* bỏ qua */
      }
    }
  } catch (err) {
    console.error("[nonelab] Lỗi kiểm tra / seed bảng users:", err);
  }
}
