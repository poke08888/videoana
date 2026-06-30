/**
 * server/tiktok.ts — tải video TikTok về server từ một link TikTok, qua RapidAPI
 * "tokapi-mobile-version" (https://rapidapi.com/Sonjik/api/tokapi-mobile-version).
 *
 * Luồng: link TikTok -> GET /v1/post?video_url=<link> -> lấy
 * aweme_detail.video.play_addr.url_list[0] (MP4 không/ít watermark) -> tải file
 * về thư mục uploads -> đưa vào pipeline phân tích như video tải lên bình thường.
 *
 * Key: ưu tiên key người dùng gửi lên, sau đó tới TOKAPI_RAPIDAPI_KEY trong .env.
 */
import fs from "node:fs";
import path from "node:path";

const TOKAPI_HOST = "tokapi-mobile-version.p.rapidapi.com";

/** Chỉ số tương tác thật từ TikTok (đồng bộ với EngagementStats ở src/types.ts). */
export interface EngagementStats {
  source: string;
  awemeId?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

const toNum = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Lấy chỉ số tương tác từ object statistics của TokAPI (không chấm điểm). */
export function computeEngagement(statistics: any, awemeId?: string): EngagementStats {
  const s = statistics || {};
  return {
    source: "TikTok",
    awemeId,
    views: toNum(s.play_count),
    likes: toNum(s.digg_count),
    comments: toNum(s.comment_count),
    // Gộp mọi dạng chia sẻ/đăng lại mà TokAPI trả về.
    shares: toNum(s.share_count) + toNum(s.repost_count) + toNum(s.forward_count),
    saves: toNum(s.collect_count),
  };
}

/** Lấy RapidAPI key: ưu tiên key gửi kèm, fallback biến môi trường. */
export function resolveTokapiKey(reqKey?: string): string | null {
  const k = (reqKey || "").trim();
  if (k.length >= 10) return k;
  const env = (process.env.TOKAPI_RAPIDAPI_KEY || "").trim();
  return env.length >= 10 ? env : null;
}

/** Có phải link TikTok không (gồm cả link rút gọn vm./vt.tiktok.com). */
export function isTikTokUrl(url: string): boolean {
  return /(^|\.)tiktok\.com\//i.test(String(url || "").trim());
}

async function tokapiGet(pathname: string, params: Record<string, string>, key: string): Promise<any> {
  const u = new URL(`https://${TOKAPI_HOST}${pathname}`);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": TOKAPI_HOST },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tokapi HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Gọi tokapi lấy thông tin video từ link TikTok → link MP4 tải được. */
export async function fetchTikTokInfo(
  tiktokUrl: string,
  key: string
): Promise<{ playUrl: string; awemeId: string; desc: string; stats: EngagementStats }> {
  const data = await tokapiGet("/v1/post", { video_url: tiktokUrl, region: "GB" }, key);
  const detail = data?.aweme_detail || data?.aweme_details?.[0];
  if (!detail) {
    throw new Error("Tokapi không trả về dữ liệu video — kiểm tra lại link TikTok hoặc RapidAPI key.");
  }
  const video = detail.video || {};
  const playUrl: string | undefined =
    video?.play_addr?.url_list?.[0] ||
    video?.download_addr?.url_list?.[0] ||
    video?.bit_rate?.[0]?.play_addr?.url_list?.[0] ||
    video?.play_addr_h264?.url_list?.[0];
  if (!playUrl) {
    throw new Error("Không tìm thấy link tải video trong dữ liệu Tokapi.");
  }
  const awemeId = String(detail.aweme_id || "");
  const stats = computeEngagement(detail.statistics, awemeId || undefined);
  return { playUrl, awemeId, desc: String(detail.desc || ""), stats };
}

/** Tải MP4 từ CDN TikTok về đường dẫn đích. */
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
      Referer: "https://www.tiktok.com/",
      Range: "bytes=0-",
    },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Tải video TikTok lỗi HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(destPath, buf);
}

/**
 * Tải video TikTok về thư mục uploads. Trả về đường dẫn file + mô tả (desc) để
 * dùng làm tiêu đề mặc định. Ném lỗi nếu file rỗng/không hợp lệ.
 */
export async function downloadTikTok(
  tiktokUrl: string,
  key: string,
  uploadDir: string
): Promise<{ path: string; desc: string; awemeId: string; stats: EngagementStats }> {
  const { playUrl, awemeId, desc, stats } = await fetchTikTokInfo(tiktokUrl, key);
  const safeId = awemeId || `${Date.now()}`;
  const dest = path.join(uploadDir, `tiktok_${safeId}.mp4`);
  await downloadToFile(playUrl, dest);
  const st = await fs.promises.stat(dest).catch(() => null);
  if (!st || st.size < 1024) {
    await fs.promises.unlink(dest).catch(() => {});
    throw new Error("Video TikTok tải về rỗng hoặc không hợp lệ.");
  }
  return { path: dest, desc, awemeId: safeId, stats };
}
