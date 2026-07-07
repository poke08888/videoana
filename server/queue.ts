import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, runQuery, getQuery, allQuery } from "./db.js";
import { analyzeVideo } from "./gemini.js";
import { decorate, scoreOf } from "../src/lib/analysis.js";
import { embedFramesServer } from "./frames.js";
import { downloadTikTok, resolveTokapiKey } from "./tiktok.js";
import { isDouyinUrl, downloadDouyin, resolveDouyinKey } from "./douyin.js";
import { getProductKnowledge, finalizeCohortIfDone } from "./cohort.js";

const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "uploads");

// Số video xử lý SONG SONG tối đa cùng lúc. Tăng để chạy nhanh hơn khi nhiều
// video / nhiều tài khoản tải lên cùng lúc, nhưng càng cao càng dễ vượt
// rate-limit/quota của Gemini. Cấu hình qua QUEUE_CONCURRENCY (.env).
const MAX_CONCURRENCY = Math.max(1, Number(process.env.QUEUE_CONCURRENCY || 10));

let active = 0;        // số video đang xử lý ngay lúc này
let claiming = false;  // khoá để vòng lặp "nhận việc" không chạy chồng nhau

export async function startQueueProcessor() {
  console.log(`[nonelab] Khởi động bộ xử lý hàng đợi (song song tối đa ${MAX_CONCURRENCY} video)...`);

  // Phục hồi sau sự cố: mọi video kẹt ở 'processing' (do backend tắt giữa chừng)
  // được đưa lại 'pending' để nhận xử lý lại.
  try {
    const reset = await runQueryChanges(
      "UPDATE history SET status = 'pending' WHERE status = 'processing'"
    );
    if (reset > 0) console.log(`[nonelab] Đưa lại ${reset} video kẹt 'processing' về hàng đợi.`);
  } catch (err) {
    console.error("[nonelab] Lỗi phục hồi hàng đợi:", err);
  }

  // Vòng lặp nhận việc: lấp đầy các "slot" song song còn trống bằng video pending.
  setInterval(async () => {
    if (claiming || active >= MAX_CONCURRENCY) return;
    claiming = true;
    try {
      while (active < MAX_CONCURRENCY) {
        // Lấy video chờ cũ nhất (FIFO theo ROWID).
        const item = await getQuery("SELECT * FROM history WHERE status = 'pending' ORDER BY rowid ASC LIMIT 1");
        if (!item) break;

        // Claim ngay (đổi sang 'processing') TRƯỚC khi lặp tiếp, để không nhận trùng.
        await runQuery("UPDATE history SET status = 'processing' WHERE id = ?", [item.id]);
        active++;
        console.log(`[nonelab] Bắt đầu phân tích (đang chạy ${active}/${MAX_CONCURRENCY}): ${item.title}`);

        // Chạy nền — KHÔNG await ở đây để cho phép song song.
        processItem(item)
          .catch((err) => console.error("[nonelab] Lỗi xử lý item:", err))
          .finally(() => { active--; });
      }
    } catch (err) {
      console.error("[nonelab] Lỗi trong vòng lặp hàng đợi:", err);
    } finally {
      claiming = false;
    }
  }, 3000);
}

// Tiêu đề có chữ Trung/Nhật/Hàn không (caption Douyin) — nếu có thì thay bằng
// tóm tắt tiếng Việt của phiếu sau khi phân tích xong.
const hasCJK = (s: any): boolean => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(String(s || ""));

// Helper: chạy câu lệnh và trả về số dòng bị ảnh hưởng (this.changes).
function runQueryChanges(sql: string, params: any[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (this: any, err: any) {
      if (err) reject(err);
      else resolve(this.changes || 0);
    });
  });
}

async function processItem(item: any) {
  let meta: any = null;
  try {
    // Cấu hình (gồm apiKey) nằm ở cột riêng queue_meta, không nằm trong analysis.
    meta = item.queue_meta ? JSON.parse(item.queue_meta) : null;
  } catch (err) {
    console.error("[nonelab] Lỗi phân tách dữ liệu cấu hình hàng đợi:", err);
    await runQuery("UPDATE history SET status = 'failed', queue_meta = NULL WHERE id = ?", [item.id]);
    return;
  }

  if (!meta) {
    await runQuery("UPDATE history SET status = 'failed', queue_meta = NULL WHERE id = ?", [item.id]);
    return;
  }

  // Cập nhật trạng thái thành 'processing'
  await runQuery("UPDATE history SET status = 'processing' WHERE id = ?", [item.id]);

  let videoPath: string | undefined = meta.videoPath;
  let tiktokTemp: string | null = null;
  let tiktokStats: any = null; // chỉ số tương tác TikTok (nếu phân tích từ link)

  // ── TÁI DÙNG KHO: nếu video này (cùng link gốc) đã từng được mổ xẻ xong, lấy
  // lại phần phân tích NỘI DUNG thay vì tải + gọi Gemini lại (tiết kiệm chi phí).
  // Chỉ overlay chỉ số theo cụm (eng/ads) của lần này lên trên.
  const srcUrlForReuse = String(meta.tiktokUrl || meta.youtubeUrl || "").trim();
  if (srcUrlForReuse) {
    try {
      const prior = await getQuery(
        "SELECT title, analysis FROM history WHERE source_url = ? AND status = 'completed' AND id != ? ORDER BY rowid DESC LIMIT 1",
        [srcUrlForReuse, item.id]
      );
      if (prior?.analysis) {
        const base = JSON.parse(prior.analysis);
        if (base && base.checklist && base.acts) {
          // Bỏ chỉ số cũ thuộc cụm khác, gắn chỉ số của lần này.
          delete base.ads; delete base.eng;
          if (meta.ads) base.ads = meta.ads;
          if (meta.eng) base.eng = meta.eng;
          base.sourceUrl = srcUrlForReuse;
          const reuseScore = scoreOf(base);
          let reuseTitle = prior.title || meta.form?.title;
          if (hasCJK(reuseTitle) && base.subtitle) reuseTitle = String(base.subtitle).slice(0, 120);
          await runQuery(
            "UPDATE history SET status = 'completed', score = ?, analysis = ?, source_url = ?, title = COALESCE(NULLIF(?, ''), title), queue_meta = NULL WHERE id = ?",
            [reuseScore, JSON.stringify(base), srcUrlForReuse, reuseTitle || "", item.id]
          );
          if (meta.email) await runQuery("UPDATE users SET count = count + 1 WHERE email = ?", [meta.email.toLowerCase().trim()]).catch(() => {});
          console.log(`[nonelab] TÁI DÙNG kho cho link trùng (bỏ qua Gemini): ${srcUrlForReuse}`);
          if (meta.cohortId) {
            try { await finalizeCohortIfDone(meta.cohortId, new Date().toISOString()); } catch (e) { console.error("[nonelab] Lỗi chốt cụm (reuse):", e); }
          }
          return; // xong — không tải video, không gọi Gemini.
        }
      }
    } catch (e) {
      console.warn("[nonelab] Lỗi tra cứu tái dùng kho (bỏ qua, phân tích bình thường):", e);
    }
  }

  try {
    // Link TikTok/Douyin: tự nhận diện theo domain rồi tải video về server
    // (TikTok qua RapidAPI tokapi, Douyin qua TikHub) trước khi phân tích.
    if (meta.tiktokUrl) {
      let dl: { path: string; desc: string; stats: any };
      if (isDouyinUrl(meta.tiktokUrl)) {
        const dyKey = resolveDouyinKey(meta.douyinKey);
        if (!dyKey) throw new Error("Thiếu RapidAPI key (TOKAPI_RAPIDAPI_KEY / DOUYIN_RAPIDAPI_KEY) để tải video Douyin.");
        console.log(`[nonelab] Đang tải video Douyin: ${meta.tiktokUrl}`);
        dl = await downloadDouyin(meta.tiktokUrl, dyKey, UPLOAD_DIR);
      } else {
        const tkKey = resolveTokapiKey(meta.tokapiKey);
        if (!tkKey) throw new Error("Thiếu RapidAPI key (TOKAPI_RAPIDAPI_KEY) để tải video TikTok.");
        console.log(`[nonelab] Đang tải video TikTok: ${meta.tiktokUrl}`);
        dl = await downloadTikTok(meta.tiktokUrl, tkKey, UPLOAD_DIR);
      }
      videoPath = dl.path;
      tiktokTemp = dl.path;
      tiktokStats = dl.stats;
      if (dl.desc) {
        const t = dl.desc.slice(0, 120);
        meta.form = { ...meta.form, title: meta.form?.title || t };
        await runQuery("UPDATE history SET title = ? WHERE id = ?", [t, item.id]);
        item.title = t; // để bước hoàn tất biết tiêu đề hiện tại (kiểm tra tiếng Trung)
      }
    }

    // Kho kiến thức riêng cho sản phẩm (nếu đã có) → bơm vào prompt Gemini.
    const productKnowledge = (await getProductKnowledge(meta.form?.product || "").catch(() => null)) || undefined;

    console.log(`[nonelab] Đang gọi Gemini API phân tích cho: ${item.title}`);
    const analysisRaw = await analyzeVideo({
      apiKey: meta.apiKey,
      model: meta.model,
      form: meta.form,
      videoPath,
      mimeType: meta.mimeType,
      youtubeUrl: meta.tiktokUrl ? undefined : meta.youtubeUrl,
      productKnowledge
    });

    // Chuẩn hóa kết quả phân tích theo khung Năm Lực của Nonelab
    const decoratedAnalysis = decorate(analysisRaw, meta.form);

    // Gắn chỉ số tương tác thật (like/share/comment/lưu + điểm tương tác) vào phiếu.
    if (tiktokStats) {
      (decoratedAnalysis as any).stats = tiktokStats;
    }
    // Gắn chỉ số ads + đánh giá hiệu quả (nếu video đến từ import Excel chỉ số).
    if (meta.ads) {
      (decoratedAnalysis as any).ads = meta.ads;
    }
    // Gắn xếp loại tương tác (nếu video đến từ campaign tìm theo từ khóa).
    if (meta.eng) {
      (decoratedAnalysis as any).eng = meta.eng;
    }
    // Lưu link video gốc vào phiếu để đối chứng nội dung (link còn trong queue_meta).
    const srcUrl = meta.tiktokUrl || meta.youtubeUrl || "";
    if (srcUrl) (decoratedAnalysis as any).sourceUrl = srcUrl;

    // Trích frame thật từ video (phía server bằng ffmpeg) khi có file cục bộ —
    // để phiếu từ hàng đợi nền cũng có khung hình thật như luồng đơn lẻ.
    if (videoPath && fs.existsSync(videoPath)) {
      console.log(`[nonelab] Đang trích frame thật từ video: ${item.title}`);
      await embedFramesServer(videoPath, decoratedAnalysis);
    }

    const score = scoreOf(decoratedAnalysis);

    // Tiêu đề là tiếng Trung/Nhật/Hàn (caption Douyin) → thay bằng tóm tắt tiếng
    // Việt của phiếu (subtitle) cho dễ đọc trong danh sách.
    const viTitle = hasCJK(item.title) ? String((decoratedAnalysis as any).subtitle || "").slice(0, 120) : "";

    // Cập nhật kết quả phân tích thành công — xóa queue_meta để không lưu lại apiKey.
    // Lưu source_url để lần sau gặp video trùng link thì tái dùng, không gọi Gemini.
    await runQuery(
      "UPDATE history SET status = 'completed', score = ?, analysis = ?, source_url = ?, title = COALESCE(NULLIF(?, ''), title), queue_meta = NULL WHERE id = ?",
      [score, JSON.stringify(decoratedAnalysis), srcUrl || null, viTitle, item.id]
    );

    // Tăng lượt phân tích của người dùng
    if (meta.email) {
      await runQuery("UPDATE users SET count = count + 1 WHERE email = ?", [meta.email.toLowerCase().trim()]).catch(() => {});
    }

    console.log(`[nonelab] Phân tích thành công video: ${item.title} (Điểm: ${score})`);

  } catch (err: any) {
    console.error(`[nonelab] Phân tích video thất bại [${item.title}]:`, err);

    // Lưu lỗi vào trường analysis để debug + GIỮ LẠI link video gốc (source_url
    // và analysis.sourceUrl) để người dùng bấm "Phân tích lại" không phải tìm link.
    const errorMsg = String(err.message || err);
    const failSrc = String(meta.tiktokUrl || meta.youtubeUrl || "").trim();
    await runQuery(
      "UPDATE history SET status = 'failed', analysis = ?, source_url = ?, queue_meta = NULL WHERE id = ?",
      [JSON.stringify(failSrc ? { error: errorMsg, sourceUrl: failSrc } : { error: errorMsg }), failSrc || null, item.id]
    );
  } finally {
    // Xóa file video cục bộ (tải lên hoặc tải từ TikTok) để giải phóng ổ cứng.
    for (const p of [meta.videoPath, tiktokTemp]) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          console.log(`[nonelab] Đã xóa file video tạm: ${p}`);
        } catch (err) {
          console.error("[nonelab] Lỗi xóa file tạm:", err);
        }
      }
    }
    // Nếu thuộc một cụm import chỉ số: thử chốt cụm (dựng kết luận + kho kiến thức)
    // khi đây là video cuối cùng hoàn tất.
    if (meta.cohortId) {
      try {
        const done = await finalizeCohortIfDone(meta.cohortId, new Date().toISOString());
        if (done) console.log(`[nonelab] Đã chốt cụm ${meta.cohortId}: dựng kết luận + cập nhật kho kiến thức.`);
      } catch (err) {
        console.error("[nonelab] Lỗi chốt cụm:", err);
      }
    }
  }
}
