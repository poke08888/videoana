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
import { signToken, requireAuth, requireAdmin, requireEditor, isValidRole } from "./auth.js";
import { isTikTokUrl, resolveTokapiKey, downloadTikTok } from "./tiktok.js";
import { embedFramesServer } from "./frames.js";
import { readXlsxGrid } from "./xlsx.js";
import { parseAdsGrid, buildCohort, type ScoredVideo } from "./adsAnalytics.js";
import { searchVideos, rankEngagement, parseKeywords } from "./tiktokSearch.js";
import { getProductKnowledge, saveProductKnowledge, finalizeCohortIfDone, productSlug } from "./cohort.js";

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

// Quyền xem dữ liệu phân tích: mỗi user chỉ thấy phiếu/cụm của chính mình
// (owner = email). Riêng vai trò Quản trị xem được tất cả để giám sát.
const ownerEmail = (req: any): string => String(req?.user?.email || "").toLowerCase().trim();
const isAdminReq = (req: any): boolean => req?.user?.role === "Quản trị";

app.get("/api/history", requireAuth, async (req, res) => {
  try {
    // Chỉ chọn cột an toàn — KHÔNG bao giờ trả về queue_meta (chứa API key).
    // Ẩn video thuộc cụm import chỉ số (cohort_id) — chúng hiển thị ở màn Phân tích chỉ số.
    // Chỉ trả phiếu của chính người dùng (admin xem tất cả).
    const rows = isAdminReq(req)
      ? await allQuery("SELECT id, title, platform, product, date, score, analysis, thumb, status FROM history WHERE cohort_id IS NULL ORDER BY rowid DESC")
      : await allQuery("SELECT id, title, platform, product, date, score, analysis, thumb, status FROM history WHERE cohort_id IS NULL AND owner = ? ORDER BY rowid DESC", [ownerEmail(req)]);
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

// Lấy 1 phiếu theo id (mở report từ màn Phân tích chỉ số). Không trả queue_meta.
app.get("/api/history/:id", requireAuth, async (req, res) => {
  try {
    const r = await getQuery<any>(
      "SELECT id, title, platform, product, date, score, analysis, thumb, status, owner FROM history WHERE id = ?",
      [req.params.id]
    );
    if (!r) return res.status(404).json({ ok: false });
    // Chỉ chủ sở hữu (hoặc admin) được xem.
    if (!isAdminReq(req) && String(r.owner || "").toLowerCase().trim() !== ownerEmail(req)) {
      return res.status(404).json({ ok: false });
    }
    let analysis: any = {};
    try { analysis = JSON.parse(r.analysis); } catch {}
    const { owner, ...safe } = r;
    res.json({ ...safe, analysis });
  } catch {
    res.status(500).json({ ok: false });
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
        "INSERT OR REPLACE INTO history (id, title, platform, product, date, score, analysis, thumb, status, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          entry.id,
          entry.title,
          entry.platform,
          entry.product,
          entry.date,
          entry.score,
          JSON.stringify(entry.analysis),
          entry.thumb || "",
          entry.status || "completed",
          ownerEmail(req)
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

    const owner = String(userEmail || "").toLowerCase().trim();
    const insertItem = async (title: string, queueMeta: any) => {
      await runQuery(
        "INSERT INTO history (id, title, platform, product, date, score, analysis, thumb, status, queue_meta, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [newId(), title, form.platform || "TikTok / Douyin", form.product || "", "Hôm nay", 0, "{}", pickBg(), "pending", JSON.stringify(queueMeta), owner]
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

// ── Phân tích chỉ số ads: import Excel → cụm + mổ xẻ nội dung cả cụm ──────────
function toAdsReport(v: ScoredVideo) {
  return {
    efficiencyScore: v.efficiencyScore, label: v.label,
    orders: v.orders, revenue: v.revenue, traffic: v.traffic, clicks: v.clicks,
    ctr: v.ctr, cvr: v.cvr, cost: v.cost, cpm: v.cpm, cpc: v.cpc, roas: v.roas,
    ctrTier: v.ctrTier, cvrTier: v.cvrTier, roasTier: v.roasTier, link: v.link,
  };
}

// Nạp file Excel chỉ số → dựng cụm → đẩy từng video vào hàng đợi mổ xẻ nội dung.
app.post("/api/ads/import", requireEditor, upload.single("file"), async (req, res) => {
  const file = req.file;
  const cleanup = () => { if (file?.path) fs.promises.unlink(file.path).catch(() => {}); };
  try {
    const product = String(req.body?.product || "").trim();
    if (!file) return res.status(400).json({ ok: false, message: "Chưa chọn file Excel (.xlsx)." });
    if (!product) { cleanup(); return res.status(400).json({ ok: false, message: "Vui lòng nhập tên sản phẩm cho cụm này." }); }
    const apiKey = resolveKey(req.body?.apiKey);
    if (!apiKey) { cleanup(); return res.status(400).json({ ok: false, error: "no-key", message: "Chưa kết nối Gemini API." }); }
    const tokapiKey = resolveTokapiKey(req.body?.tokapiKey);
    if (!tokapiKey) { cleanup(); return res.status(400).json({ ok: false, error: "no-tokapi-key", message: "Chưa cấu hình RapidAPI key cho TikTok (TOKAPI_RAPIDAPI_KEY)." }); }
    const model = req.body?.model || DEFAULT_MODEL;
    const email = req.user?.email;

    const buf = await fs.promises.readFile(file.path);
    cleanup();
    let cohort;
    try {
      cohort = buildCohort(parseAdsGrid(readXlsxGrid(buf)));
    } catch (e: any) {
      return res.status(400).json({ ok: false, message: "Không đọc được file Excel: " + (e?.message || e) });
    }
    if (!cohort.count) return res.status(400).json({ ok: false, message: "Không tìm thấy video hợp lệ trong file (cần cột Video ID + chỉ số)." });

    const cohortId = "c" + Math.random().toString(36).slice(2, 10);
    const created = new Date().toISOString();
    const owner = String(email || "").toLowerCase().trim();
    await runQuery(
      "INSERT INTO ads_cohorts (id, product, product_slug, created, count, summary, insight, owner) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
      [cohortId, product, productSlug(product), created, cohort.count,
        JSON.stringify({ count: cohort.count, benchmarks: cohort.benchmarks, thresholds: cohort.thresholds, summary: cohort.summary }), owner]
    );

    const av = ["linear-gradient(150deg,#3c7a5e,#2a5a44)", "linear-gradient(150deg,#b06a16,#7a4a10)", "linear-gradient(150deg,#9e3a3a,#6a2424)", "linear-gradient(150deg,#3a2a16,#5a4326)", "linear-gradient(150deg,#2f6b8a,#1e4a60)"];
    let enq = 0;
    for (const v of cohort.items) {
      const id = "e" + Math.random().toString(36).slice(2, 8);
      const meta = { apiKey, model, form: { product, platform: "TikTok / Douyin" }, tiktokUrl: v.link, tokapiKey, email, ads: toAdsReport(v), cohortId };
      await runQuery(
        "INSERT INTO history (id, title, platform, product, date, score, analysis, thumb, status, queue_meta, cohort_id, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, `#${v.stt ?? "?"} · ${product}`, "TikTok / Douyin", product, "Hôm nay", v.efficiencyScore, "{}", av[enq % av.length], "pending", JSON.stringify(meta), cohortId, owner]
      );
      enq++;
    }
    res.json({ ok: true, cohortId, product, count: cohort.count, summary: cohort.summary, benchmarks: cohort.benchmarks });
  } catch (err: any) {
    cleanup();
    console.error("Lỗi import chỉ số:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi import file chỉ số." });
  }
});

// Tìm video TikTok theo TỪ KHÓA (qua tokapi) + lọc like/view → tạo cụm campaign
// rồi mổ xẻ nội dung nền để tìm điểm chung của video tương tác cao.
// BƯỚC 1 — chỉ TÌM và trả danh sách video để người dùng DUYỆT (không tạo cohort,
// không tốn Gemini). Tìm nhiều từ khóa dễ lẫn category (vd "khử mùi" → "khử mùi tủ
// lạnh"), nên phải xem trước rồi mới chọn video đưa vào phân tích.
app.post("/api/campaign/search", requireEditor, async (req, res) => {
  try {
    const rawKeyword = String(req.body?.keyword || "").trim();
    const keywords = parseKeywords(rawKeyword);
    if (!keywords.length) return res.status(400).json({ ok: false, message: "Vui lòng nhập từ khóa." });
    const tokapiKey = resolveTokapiKey(req.body?.tokapiKey);
    if (!tokapiKey) return res.status(400).json({ ok: false, error: "no-tokapi-key", message: "Chưa cấu hình RapidAPI key (TOKAPI_RAPIDAPI_KEY)." });
    const minLikes = Math.max(0, Number(req.body?.minLikes) || 0);
    const minViews = Math.max(0, Number(req.body?.minViews) || 0);
    const target = Math.min(Math.max(1, Number(req.body?.target) || 50), 300);

    // Ngân sách lệnh search rộng tay để gom đủ (đa luồng sort/publish_time gộp dedup),
    // scale theo số keyword (mỗi keyword ~90 lệnh để vét cạn nguồn).
    const maxPages = Math.min(keywords.length * 100, 800);
    const { videos, scanned, exhausted, perKeyword } = await searchVideos({ keywords, key: tokapiKey, minLikes, minViews, target, maxPages });
    if (!videos.length) {
      return res.status(400).json({ ok: false, message: `Không tìm thấy video nào cho "${keywords[0]}" đạt ngưỡng (đã quét ${scanned} kết quả).` });
    }
    res.json({ ok: true, keywords, perKeyword, count: videos.length, scanned, exhausted, videos });
  } catch (err: any) {
    console.error("Lỗi campaign search:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi tìm kiếm video." });
  }
});

// BƯỚC 2 — nhận danh sách video ĐÃ DUYỆT, tạo cohort + xếp hàng Gemini mổ xẻ.
// Xếp hạng tương tác (eng) tính lại trên đúng tập đã chọn để percentile chuẩn.
app.post("/api/campaign/create", requireEditor, async (req, res) => {
  try {
    const keywords: string[] = Array.isArray(req.body?.keywords) ? req.body.keywords.map((k: any) => String(k)).filter(Boolean) : parseKeywords(String(req.body?.keyword || ""));
    if (!keywords.length) return res.status(400).json({ ok: false, message: "Thiếu từ khóa." });
    const keyword = keywords.length > 1 ? `${keywords[0]} (+${keywords.length - 1})` : keywords[0];
    const apiKey = resolveKey(req.body?.apiKey);
    if (!apiKey) return res.status(400).json({ ok: false, error: "no-key", message: "Chưa kết nối Gemini API." });
    const tokapiKey = resolveTokapiKey(req.body?.tokapiKey);
    const model = req.body?.model || DEFAULT_MODEL;
    const email = req.user?.email;

    // Lọc + chuẩn hoá video người dùng gửi lên (chỉ giữ video có link hợp lệ).
    const incoming: any[] = Array.isArray(req.body?.videos) ? req.body.videos : [];
    const videos = incoming
      .filter((v) => v && v.link && v.stats)
      .map((v) => ({ awemeId: String(v.awemeId || ""), desc: String(v.desc || ""), author: String(v.author || ""), nickname: String(v.nickname || ""), link: String(v.link), stats: v.stats }));
    if (!videos.length) return res.status(400).json({ ok: false, message: "Chưa chọn video nào để phân tích." });

    const engs = rankEngagement(videos as any); // cùng thứ tự với videos, percentile trên tập đã chọn
    const tot = engs.filter((e) => e.tier === "tốt").length;
    const kha = engs.filter((e) => e.tier === "khá").length;
    const thap = engs.filter((e) => e.tier === "thấp").length;
    const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 0; };
    const summary = {
      count: videos.length, keyword, keywords, minLikes: Math.max(0, Number(req.body?.minLikes) || 0),
      summary: { tot, kha, thap, medianLikes: med(engs.map((e) => e.likes)), medianRate: med(engs.map((e) => e.engagementRate)) },
    };

    const cohortId = "c" + Math.random().toString(36).slice(2, 10);
    const owner = String(email || "").toLowerCase().trim();
    await runQuery(
      "INSERT INTO ads_cohorts (id, product, product_slug, created, count, summary, insight, kind, owner) VALUES (?, ?, ?, ?, ?, ?, NULL, 'campaign', ?)",
      [cohortId, keyword, productSlug(keyword), new Date().toISOString(), videos.length, JSON.stringify(summary), owner]
    );
    const av = ["linear-gradient(150deg,#3c7a5e,#2a5a44)", "linear-gradient(150deg,#b06a16,#7a4a10)", "linear-gradient(150deg,#9e3a3a,#6a2424)", "linear-gradient(150deg,#3a2a16,#5a4326)", "linear-gradient(150deg,#2f6b8a,#1e4a60)"];
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const id = "e" + Math.random().toString(36).slice(2, 8);
      const meta = { apiKey, model, form: { product: keyword, platform: "TikTok / Douyin" }, tiktokUrl: v.link, tokapiKey, email, eng: engs[i], cohortId };
      await runQuery(
        "INSERT INTO history (id, title, platform, product, date, score, analysis, thumb, status, queue_meta, cohort_id, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, (v.desc || "Video TikTok").slice(0, 80), "TikTok / Douyin", keyword, "Hôm nay", engs[i].score, "{}", av[i % av.length], "pending", JSON.stringify(meta), cohortId, owner]
      );
    }
    res.json({ ok: true, cohortId, keyword, count: videos.length });
  } catch (err: any) {
    console.error("Lỗi campaign create:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi tạo campaign." });
  }
});

// Danh sách cụm (kèm tiến độ mổ xẻ + loại cụm).
app.get("/api/ads/cohorts", requireEditor, async (req, res) => {
  try {
    const rows = isAdminReq(req)
      ? await allQuery("SELECT id, product, created, count, insight, kind FROM ads_cohorts ORDER BY created DESC")
      : await allQuery("SELECT id, product, created, count, insight, kind FROM ads_cohorts WHERE owner = ? ORDER BY created DESC", [ownerEmail(req)]);
    const out = [];
    for (const r of rows) {
      const prog = await getQuery<{ done: number; total: number }>(
        "SELECT SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done, COUNT(*) AS total FROM history WHERE cohort_id = ?", [r.id]);
      out.push({ id: r.id, product: r.product, created: r.created, count: r.count, done: prog?.done || 0, total: prog?.total || 0, hasInsight: !!r.insight, kind: r.kind || "ads" });
    }
    res.json(out);
  } catch (e) { res.status(500).json({ ok: false }); }
});

// Chi tiết 1 cụm: tổng hợp chỉ số + kết luận content↔chỉ số + bảng video xếp hạng.
app.get("/api/ads/cohort/:id", requireEditor, async (req, res) => {
  try {
    const c = await getQuery<any>("SELECT * FROM ads_cohorts WHERE id = ?", [req.params.id]);
    if (!c) return res.status(404).json({ ok: false, message: "Không tìm thấy cụm." });
    if (!isAdminReq(req) && String(c.owner || "").toLowerCase().trim() !== ownerEmail(req)) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy cụm." });
    }
    const rows = await allQuery<any>("SELECT id, title, status, score, analysis FROM history WHERE cohort_id = ? ORDER BY score DESC", [req.params.id]);
    const videos = rows.map((r) => {
      let a: any = {};
      try { a = JSON.parse(r.analysis); } catch {}
      return { id: r.id, title: r.title, status: r.status, score: r.score, ads: a.ads || null, eng: a.eng || null, hasContent: !!a.checklist };
    });
    res.json({ ok: true, cohort: { id: c.id, product: c.product, created: c.created, count: c.count, kind: c.kind || "ads", summary: JSON.parse(c.summary || "{}"), insight: c.insight ? JSON.parse(c.insight) : null }, videos });
  } catch (e: any) { console.error("Lỗi lấy cụm:", e); res.status(500).json({ ok: false }); }
});

// Ép chốt cụm ngay (dựng kết luận + kho kiến thức từ các video đã xong).
app.post("/api/ads/cohort/:id/finalize", requireEditor, async (req, res) => {
  try {
    const c = await getQuery<any>("SELECT owner FROM ads_cohorts WHERE id = ?", [req.params.id]);
    if (!c) return res.status(404).json({ ok: false, message: "Không tìm thấy cụm." });
    if (!isAdminReq(req) && String(c.owner || "").toLowerCase().trim() !== ownerEmail(req)) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy cụm." });
    }
    res.json({ ok: true, done: await finalizeCohortIfDone(req.params.id, new Date().toISOString()) });
  }
  catch (e: any) { res.status(500).json({ ok: false, message: e?.message }); }
});

// Kho kiến thức theo sản phẩm: liệt kê / xem / sửa.
app.get("/api/knowledge", requireEditor, async (_req, res) => {
  try { res.json(await allQuery("SELECT slug, product, updated, length(content) AS size FROM product_knowledge ORDER BY updated DESC")); }
  catch { res.status(500).json({ ok: false }); }
});
app.get("/api/knowledge/:slug", requireEditor, async (req, res) => {
  const row = await getQuery("SELECT slug, product, content, updated FROM product_knowledge WHERE slug = ?", [req.params.slug]);
  if (!row) return res.status(404).json({ ok: false });
  res.json({ ok: true, ...row });
});
app.put("/api/knowledge/:slug", requireEditor, async (req, res) => {
  const content = String(req.body?.content || "");
  const product = String(req.body?.product || req.params.slug);
  await saveProductKnowledge(product, content, new Date().toISOString());
  res.json({ ok: true });
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
  let tiktokStats: import("./tiktok.js").EngagementStats | null = null; // chỉ số tương tác TikTok
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
      tiktokStats = dl.stats;
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

    // Gắn chỉ số tương tác thật (like/share/comment/lưu + điểm tương tác) vào phiếu.
    if (tiktokStats) {
      (analysis as any).stats = tiktokStats;
    }
    // Lưu link video gốc để đối chứng nội dung trong phiếu.
    const srcUrl = tiktokUrl || youtubeUrl || "";
    if (srcUrl) (analysis as any).sourceUrl = srcUrl;

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
