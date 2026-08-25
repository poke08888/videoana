/**
 * server/studio/engines/kenburns.ts — clip từ ẢNH TĨNH bằng ffmpeg zoompan, không gọi API.
 *
 * Vì sao có engine này: bench Bước 0 cho thấy chữ trên nhãn vỡ là do model video phân bố lại
 * pixel giữa các khung. Ảnh tĩnh + Ken Burns KHÔNG phân bố lại pixel — nhãn giữ nguyên từng
 * điểm ảnh suốt cảnh, vì nó chính là ảnh khoá đã được duyệt. Với cảnh packaging/label thì
 * cách này thắng Veo cả ba mặt: chữ đúng hơn, có chuyển động hơn biên độ thấp, và 0 đồng.
 * Ý tưởng mượn từ OpenShorts (MIT) — generate_broll() dựng b-roll bằng zoompan thay vì model.
 */
import { frameSize } from "../config.js";
import { runFfmpeg, probeDuration } from "../ffmpeg.js";
import type { VideoEngine, VideoRequest } from "./types.js";

/** zoom = tổng mức phóng thêm sau cả cảnh; panX = số pixel lia ngang (0 = đứng yên). */
export const KEN_BURNS_MOTION: Record<VideoRequest["motionLevel"], { zoom: number; panX: number }> = {
  low: { zoom: 0.08, panX: 0 },
  medium: { zoom: 0.15, panX: 10 },
  high: { zoom: 0.22, panX: 24 },
};

export function buildKenBurnsFilter(o: {
  width: number; height: number; durationSec: number; fps: number;
  motionLevel: VideoRequest["motionLevel"];
}): string {
  const frames = Math.round(o.durationSec * o.fps);
  const { zoom, panX } = KEN_BURNS_MOTION[o.motionLevel];
  // Phóng gấp đôi rồi crop đúng tỉ lệ TRƯỚC khi zoompan: zoompan lấy mẫu theo từng khung,
  // chạy thẳng trên ảnh cỡ đích sẽ giật thấy rõ.
  const up = `scale=${o.width * 2}:${o.height * 2}:force_original_aspect_ratio=increase,crop=${o.width * 2}:${o.height * 2}`;
  const x = panX === 0
    ? `iw/2-(iw/zoom/2)`
    : `iw/2-(iw/zoom/2)+${panX}*on/${frames}`;
  return `${up},zoompan=z='1+${zoom}*on/${frames}':x='${x}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${o.width}x${o.height}:fps=${o.fps},setsar=1`;
}

export function kenBurnsVideoEngine(fps = 24): VideoEngine {
  return {
    name: "kenburns",
    async generate(req) {
      const { width, height } = frameSize(req.aspectRatio);
      const vf = buildKenBurnsFilter({ width, height, durationSec: req.durationSec, fps, motionLevel: req.motionLevel });
      await runFfmpeg([
        "-loop", "1", "-i", req.firstFrame.path,
        "-vf", vf,
        "-t", String(req.durationSec),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-an", "-y", req.outPath,
      ]);
      return { path: req.outPath, durationSec: await probeDuration(req.outPath), costUsd: 0, model: "kenburns" };
    },
  };
}
