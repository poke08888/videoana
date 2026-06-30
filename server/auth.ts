/**
 * server/auth.ts — xác thực JWT (HS256) tự ký bằng secret + middleware phân quyền.
 *
 * Không phụ thuộc thư viện ngoài: ký/giải mã JWT bằng `node:crypto`.
 * Secret lấy từ biến môi trường JWT_SECRET; nếu thiếu sẽ sinh tạm thời
 * (mọi phiên sẽ mất hiệu lực khi restart) và in cảnh báo.
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getQuery } from "./db.js";

const SECRET: string =
  (process.env.JWT_SECRET || "").trim() ||
  (() => {
    const ephemeral = crypto.randomBytes(48).toString("hex");
    console.warn(
      "[nonelab] CẢNH BÁO: chưa đặt JWT_SECRET trong .env — dùng secret tạm thời, " +
        "mọi phiên đăng nhập sẽ mất hiệu lực sau khi restart backend."
    );
    return ephemeral;
  })();

const ROLES = ["Quản trị", "Biên tập", "Cộng tác", "Khách"] as const;
export type Role = (typeof ROLES)[number];

export function isValidRole(role: unknown): role is Role {
  return typeof role === "string" && (ROLES as readonly string[]).includes(role);
}

export interface TokenPayload {
  email: string;
  role: string;
  iat: number;
  exp: number;
}

const DEFAULT_TTL = 7 * 24 * 3600; // 7 ngày

export function signToken(payload: { email: string; role: string }, ttlSec = DEFAULT_TTL): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(body)).toString("base64url");
  const data = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(p, "base64url").toString()) as TokenPayload;
    if (body.exp && Math.floor(Date.now() / 1000) > body.exp) return null;
    return body;
  } catch {
    return null;
  }
}

// Gắn thông tin user đã xác thực vào request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

function bearer(req: Request): string | null {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Yêu cầu token hợp lệ (bất kỳ vai trò nào). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ ok: false, message: "Chưa xác thực hoặc phiên đã hết hạn." });
  }
  req.user = payload;
  next();
}

/**
 * Yêu cầu vai trò Quản trị — kiểm tra lại vai trò THỰC trong DB
 * (token có thể đã cũ; user có thể bị hạ quyền/khóa sau khi đăng nhập).
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async () => {
    try {
      const row = await getQuery<{ role: string; active: number }>(
        "SELECT role, active FROM users WHERE email = ?",
        [req.user!.email]
      );
      if (!row || !row.active) {
        return res.status(403).json({ ok: false, message: "Tài khoản không hợp lệ hoặc đã bị khóa." });
      }
      if (row.role !== "Quản trị") {
        return res.status(403).json({ ok: false, message: "Chỉ Quản trị mới có quyền thực hiện thao tác này." });
      }
      next();
    } catch (err) {
      console.error("[nonelab] Lỗi kiểm tra quyền admin:", err);
      res.status(500).json({ ok: false, message: "Lỗi hệ thống khi kiểm tra quyền." });
    }
  });
}

/**
 * Yêu cầu vai trò Biên tập trở lên (Biên tập hoặc Quản trị) — kiểm tra vai trò
 * THỰC trong DB. Dùng cho 2 tính năng Phân tích chỉ số & Campaign từ khóa.
 */
export function requireEditor(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async () => {
    try {
      const row = await getQuery<{ role: string; active: number }>(
        "SELECT role, active FROM users WHERE email = ?",
        [req.user!.email]
      );
      if (!row || !row.active) {
        return res.status(403).json({ ok: false, message: "Tài khoản không hợp lệ hoặc đã bị khóa." });
      }
      if (row.role !== "Quản trị" && row.role !== "Biên tập") {
        return res.status(403).json({ ok: false, message: "Tính năng này chỉ dành cho Biên tập và Quản trị." });
      }
      next();
    } catch (err) {
      console.error("[nonelab] Lỗi kiểm tra quyền biên tập:", err);
      res.status(500).json({ ok: false, message: "Lỗi hệ thống khi kiểm tra quyền." });
    }
  });
}
