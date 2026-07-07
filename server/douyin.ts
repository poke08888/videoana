/**
 * server/douyin.ts — tải video Douyin về server từ một link chia sẻ, qua RapidAPI
 * "douyin-api6" của TikHub team
 * (https://rapidapi.com/tikhub-team-tikhub-team-default/api/douyin-api6).
 *
 * Luồng: link Douyin (v.douyin.com/… hoặc www.douyin.com/video/…) ->
 * GET /api/v1/douyin/web/fetch_one_video_by_share_url?share_url=<link> ->
 * lấy aweme_detail.video.play_addr.url_list[0] -> tải MP4 về thư mục uploads ->
 * đưa vào pipeline phân tích như video TikTok.
 *
 * Key: RapidAPI dùng CHUNG một key cho mọi API đã subscribe trong cùng app —
 * ưu tiên key gửi kèm, rồi DOUYIN_RAPIDAPI_KEY, fallback TOKAPI_RAPIDAPI_KEY.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { computeEngagement, type EngagementStats } from "./tiktok.js";

const DOUYIN_HOST = "douyin-api6.p.rapidapi.com";

/** Có phải link Douyin không (gồm link rút gọn v.douyin.com và iesdouyin.com). */
export function isDouyinUrl(url: string): boolean {
  return /(^|\.)(douyin|iesdouyin)\.com\//i.test(String(url || "").trim());
}

/** Lấy RapidAPI key cho Douyin: key gửi kèm → DOUYIN_RAPIDAPI_KEY → TOKAPI_RAPIDAPI_KEY. */
export function resolveDouyinKey(reqKey?: string): string | null {
  for (const k of [reqKey, process.env.DOUYIN_RAPIDAPI_KEY, process.env.TOKAPI_RAPIDAPI_KEY]) {
    const v = (k || "").trim();
    if (v.length >= 10) return v;
  }
  return null;
}

async function douyinGet(pathname: string, params: Record<string, string>, key: string): Promise<any> {
  const u = new URL(`https://${DOUYIN_HOST}${pathname}`);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": DOUYIN_HOST },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new Error(
        /quota/i.test(body)
          ? "Hết hạn mức gói RapidAPI cho Douyin (douyin-api6) — nâng cấp gói tại rapidapi.com rồi thử lại."
          : "Douyin API đang bị giới hạn nhịp gọi (429) — thử lại sau ít phút."
      );
    }
    throw new Error(`Douyin API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Gom MỌI link MP4 ứng viên từ dữ liệu video (play/download/h264 + các bit_rate).
 * Mỗi nguồn có ~3 URL trên các CDN khác nhau — tải file lớn hay đứt kết nối giữa
 * chừng nên phải có danh sách dự phòng để thử lần lượt.
 */
function candidateUrls(video: any): string[] {
  const urls: string[] = [];
  const push = (u: any) => {
    if (typeof u === "string" && /^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
  };
  for (const f of [video?.play_addr, video?.download_addr, video?.play_addr_h264]) {
    for (const u of f?.url_list || []) push(u);
  }
  for (const br of video?.bit_rate || []) {
    for (const u of br?.play_addr?.url_list || []) push(u);
  }
  return urls;
}

/** Gọi douyin-api6 lấy thông tin video từ link Douyin → các link MP4 tải được. */
export async function fetchDouyinInfo(
  douyinUrl: string,
  key: string
): Promise<{ playUrls: string[]; awemeId: string; desc: string; stats: EngagementStats }> {
  const j = await douyinGet("/api/v1/douyin/web/fetch_one_video_by_share_url", { share_url: douyinUrl }, key);
  const detail = j?.data?.aweme_detail || j?.data?.aweme_details?.[0] || j?.aweme_detail;
  if (!detail) {
    throw new Error("Douyin API không trả về dữ liệu video — kiểm tra lại link Douyin hoặc RapidAPI key.");
  }
  const playUrls = candidateUrls(detail.video || {});
  if (!playUrls.length) {
    throw new Error("Không tìm thấy link tải video trong dữ liệu Douyin API (có thể là bài ảnh, không phải video).");
  }
  const awemeId = String(detail.aweme_id || "");
  const stats = { ...computeEngagement(detail.statistics, awemeId || undefined), source: "Douyin" };
  return { playUrls, awemeId, desc: String(detail.desc || ""), stats };
}

/** Tải MP4 từ CDN Douyin về đường dẫn đích — stream xuống đĩa, không giữ trong RAM. */
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
      Referer: "https://www.douyin.com/",
      Range: "bytes=0-",
    },
  });
  if ((!res.ok && res.status !== 206) || !res.body) {
    throw new Error(`Tải video Douyin lỗi HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(destPath));
}

/**
 * Tải video Douyin về thư mục uploads. Trả về đường dẫn file + mô tả (desc) để
 * dùng làm tiêu đề mặc định. Ném lỗi nếu file rỗng/không hợp lệ.
 */
export async function downloadDouyin(
  douyinUrl: string,
  key: string,
  uploadDir: string
): Promise<{ path: string; desc: string; awemeId: string; stats: EngagementStats }> {
  const { playUrls, awemeId, desc, stats } = await fetchDouyinInfo(douyinUrl, key);
  const safeId = awemeId || `${Date.now()}`;
  const dest = path.join(uploadDir, `douyin_${safeId}.mp4`);
  let lastErr: any = null;
  for (const playUrl of playUrls) {
    try {
      await downloadToFile(playUrl, dest);
      const st = await fs.promises.stat(dest).catch(() => null);
      if (!st || st.size < 1024) throw new Error("file rỗng");
      return { path: dest, desc, awemeId: safeId, stats };
    } catch (e) {
      lastErr = e;
      await fs.promises.unlink(dest).catch(() => {});
      console.warn(`[nonelab] Tải Douyin lỗi ở 1 CDN (thử link kế tiếp): ${String((e as any)?.message || e)}`);
    }
  }
  throw new Error(`Tải video Douyin thất bại trên cả ${playUrls.length} link CDN — ${String(lastErr?.message || lastErr)}`);
}
