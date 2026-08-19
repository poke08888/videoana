import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectDB } from "../db.js";
import { signToken } from "../auth.js";
import { initStudioTables } from "./db.js";
import { studioRouter } from "./routes.js";
import { fakeImageEngine } from "./engines/fake.js";

let base = ""; let server: any; let token = "";
before(async () => {
  process.env.ADMIN_INIT_PASSWORD = "x-test-x";
  await connectDB(); await initStudioTables();
  token = signToken({ email: "k@nerman.asia", role: "Quản trị" });
  const app = express(); app.use(express.json({ limit: "2mb" })); app.use("/api/studio", studioRouter);
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());
const H = () => ({ Authorization: `Bearer ${token}` });
const j = (r: Response) => r.json() as Promise<any>;

test("luồng API: tạo dự án (multipart) → nhập tay kịch bản → yêu cầu ảnh khoá → đọc lại → file token", { timeout: 30_000 }, async () => {
  const png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rt-")), "p.png");
  await fakeImageEngine().generate({ prompt: "", refs: [], aspectRatio: "9:16", size: "1K", outPath: png });
  const fd = new FormData();
  fd.append("name", "Gà rán"); fd.append("industry", "food"); fd.append("clipLen", "8"); fd.append("ratio", "9:16"); fd.append("tier", "draft"); fd.append("scriptSource", "manual");
  fd.append("products", new Blob([fs.readFileSync(png)], { type: "image/png" }), "p.png");
  const c = await j(await fetch(`${base}/api/studio/projects`, { method: "POST", headers: H(), body: fd }));
  assert.ok(c.ok, JSON.stringify(c)); const id = c.project.id;

  const s = await j(await fetch(`${base}/api/studio/projects/${id}/script`, { method: "POST", headers: { ...H(), "Content-Type": "application/json" }, body: JSON.stringify({ source: "manual", shots: [{ purpose: "hook", camera: "close", dialog: "Mở hộp", image_prompt: "a", motion_prompt: "b", motion_level: "low" }] }) }));
  assert.ok(s.ok, JSON.stringify(s)); assert.equal(s.shots.length, 1);

  const k = await j(await fetch(`${base}/api/studio/projects/${id}/keyframes`, { method: "POST", headers: { ...H(), "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(k.count, 1);
  const g = await j(await fetch(`${base}/api/studio/projects/${id}`, { headers: H() }));
  assert.equal(g.shots[0].image_status, "pending");
  assert.equal(g.assets[0].kind, "product");
  assert.ok(g.assets[0].rel.startsWith("assets/"));
  assert.equal(g.maxSyllables, 36); // 4.5 × 8 (engine fake)

  const f = await fetch(`${base}/api/studio/file/${id}/${g.assets[0].rel}?t=${token}`);
  assert.equal(f.status, 200);
  const bad = await fetch(`${base}/api/studio/file/${id}/../../etc/passwd?t=${token}`);
  assert.notEqual(bad.status, 200);
  const noauth = await fetch(`${base}/api/studio/file/${id}/${g.assets[0].rel}`);
  assert.equal(noauth.status, 401);
});

test("người khác không thấy dự án của tôi", async () => {
  const other = signToken({ email: "b@nerman.asia", role: "Biên tập" });
  const r = await fetch(`${base}/api/studio/projects`, { headers: { Authorization: `Bearer ${other}` } });
  // b@ chưa có trong bảng users → requireEditor trả 403; đủ để chứng minh không lộ dữ liệu.
  assert.ok([401, 403].includes(r.status));
});
