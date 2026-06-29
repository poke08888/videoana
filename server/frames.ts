/**
 * server/frames.ts — trích "frame thật" từ video phía server bằng ffmpeg
 * (binary đóng gói qua ffmpeg-static, không cần cài hệ thống).
 *
 * Dùng cho luồng HÀNG ĐỢI NỀN (batch) — nơi không có trình duyệt/Canvas để trích
 * frame. Mỗi frame được thu nhỏ (cao ~360px, JPEG) và nhúng vào beat dưới dạng
 * data-URL, giống hệt luồng phân tích đơn lẻ ở trình duyệt.
 */
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

// Ưu tiên FFMPEG_PATH (vd ffmpeg hệ thống trong Docker), rồi tới ffmpeg-static.
const FFMPEG = (process.env.FFMPEG_PATH || "").trim() || (ffmpegStatic as unknown as string) || "ffmpeg";

/** "0:02" → 2s, "1:34" → 94s, "01:02:03" → 3723s. */
function parseTs(ts: string): number {
  const parts = String(ts || "").trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/** Trích 1 frame ở giây `sec` → data-URL JPEG (hoặc null nếu lỗi). */
function grabFrame(videoPath: string, sec: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (!FFMPEG) return resolve(null);
    const args = [
      "-ss", String(sec),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", "scale=-2:360", // giữ tỉ lệ, cao 360px
      "-q:v", "5",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1",
    ];
    const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (val: string | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    // An toàn: tối đa 15s mỗi frame.
    const guard = setTimeout(() => {
      try { ff.kill("SIGKILL"); } catch { /* ignore */ }
      done(null);
    }, 15_000);

    ff.stdout.on("data", (c) => chunks.push(c as Buffer));
    ff.on("error", () => { clearTimeout(guard); done(null); });
    ff.on("close", () => {
      clearTimeout(guard);
      if (!chunks.length) return done(null);
      const b64 = Buffer.concat(chunks).toString("base64");
      done(`data:image/jpeg;base64,${b64}`);
    });
  });
}

/**
 * Gắn `beat.frame` (data-URL) cho mọi beat trong analysis bằng cách trích frame
 * tại timestamp tương ứng. Sửa tại chỗ và trả về cùng object. Không ném lỗi —
 * frame nào trích thất bại sẽ giữ nguyên placeholder.
 */
export async function embedFramesServer(videoPath: string, analysis: any): Promise<any> {
  try {
    const beats: any[] = (analysis?.acts || []).flatMap((act: any) => act?.beats || []);
    // Cache theo giây để không trích trùng cùng một mốc.
    const cache = new Map<number, string | null>();
    for (const b of beats) {
      const sec = parseTs(b.ts);
      if (!cache.has(sec)) {
        cache.set(sec, await grabFrame(videoPath, sec));
      }
      const img = cache.get(sec);
      if (img) b.frame = img;
    }
  } catch {
    /* giữ placeholder nếu trích frame thất bại */
  }
  return analysis;
}
