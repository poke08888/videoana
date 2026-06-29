/**
 * frames.ts — trích "frame thật" từ video File ngay trên trình duyệt (Canvas API)
 * và nhúng vào phiếu mổ xẻ dưới dạng data-URL, để frame được LƯU LẠI và hiển thị
 * trong mọi phiếu (lịch sử, link chia sẻ, file HTML xuất ra) — không chỉ ngay sau
 * khi vừa phân tích.
 *
 * Ảnh được thu nhỏ (cao tối đa ~360px, JPEG q≈0.72) để mỗi frame chỉ vài KB,
 * tránh phình to JSON khi lưu vào SQLite.
 */
import type { Analysis } from "../types";

/** "0:02" → 2s, "1:34" → 94s, "12" → 12s. */
export function parseTs(ts: string): number {
  const parts = (ts || "").trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

const MAX_H = 360; // chiều cao tối đa của thumbnail
const JPEG_Q = 0.72;

/** Mở 1 video File và trích frame ở từng mốc thời gian (giây). Trả về map giây → dataURL. */
export function captureFramesAt(file: File, secondsList: number[]): Promise<Map<number, string>> {
  return new Promise((resolve) => {
    const out = new Map<number, string>();
    const uniq = Array.from(new Set(secondsList)).sort((a, b) => a - b);
    if (!uniq.length) return resolve(out);

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.preload = "auto";
    (video as any).playsInline = true;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    let idx = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      resolve(out);
    };

    // An toàn: nếu video lỗi/treo thì trả về những gì đã có sau 20s.
    const guard = setTimeout(finish, 20_000);

    const seekNext = () => {
      if (idx >= uniq.length) {
        clearTimeout(guard);
        return finish();
      }
      const target = uniq[idx];
      const dur = video.duration || target + 1;
      video.currentTime = Math.max(0, Math.min(target, dur - 0.05));
    };

    video.addEventListener("loadeddata", seekNext);
    video.addEventListener("error", () => { clearTimeout(guard); finish(); });
    video.addEventListener("seeked", () => {
      if (ctx && video.videoWidth) {
        const scale = Math.min(1, MAX_H / video.videoHeight);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          out.set(uniq[idx], canvas.toDataURL("image/jpeg", JPEG_Q));
        } catch { /* tainted canvas — bỏ qua */ }
      }
      idx++;
      seekNext();
    });
    video.load();
  });
}

/**
 * Trích frame cho TẤT CẢ beat trong analysis và gắn `beat.frame` (data-URL).
 * Trả về cùng object analysis (đã sửa tại chỗ). Không ném lỗi — lỗi sẽ giữ nguyên
 * placeholder.
 */
export async function embedFrames(file: File, a: Analysis): Promise<Analysis> {
  try {
    const beats = (a.acts || []).flatMap((act) => act.beats || []);
    const secs = beats.map((b) => parseTs(b.ts));
    const map = await captureFramesAt(file, secs);
    for (const b of beats) {
      const img = map.get(parseTs(b.ts));
      if (img) b.frame = img;
    }
  } catch {
    /* giữ placeholder nếu trích frame thất bại */
  }
  return a;
}
