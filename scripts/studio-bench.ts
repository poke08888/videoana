/**
 * scripts/studio-bench.ts — Bước 0: bench Veo Lite / Veo Fast (Kling chấm tay trên kling.ai
 * bằng CÙNG ảnh khoá). Không đụng DB. Kết quả vào --out, kèm scores.md để chấm 4 tiêu chí.
 *
 *   npx tsx scripts/studio-bench.ts --product ga.jpg --background ban.jpg \
 *     --prompt "Close-up: a hand picks up one piece of fried chicken from the tray" \
 *     --models veo-3.1-lite-generate-preview,veo-3.1-fast-generate-preview --runs 2 --out ./data/bench
 *   Thêm --keyframe path.png để bỏ qua bước sinh ảnh; --dry để chỉ in kế hoạch.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { nanoImageEngine } from "../server/studio/engines/image.js";
import { veoVideoEngine } from "../server/studio/engines/video.js";
import { videoCost, imageCost, usdToVnd } from "../server/studio/pricing.js";
import { STUDIO } from "../server/studio/config.js";

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) out[k] = true; else { out[k] = v; i++; }
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const out = String(a.out || "./data/bench");
  const runs = Number(a.runs || 2);
  const models = String(a.models || `${STUDIO.videoModelDraft},${STUDIO.videoModelFinal}`).split(",").map((s) => s.trim()).filter(Boolean);
  const prompt = String(a.prompt || "");
  const dry = !!a.dry;
  if (!prompt) throw new Error("Thiếu --prompt");
  fs.mkdirSync(out, { recursive: true });

  const plan = [`Ảnh khoá: ${a.keyframe ? "dùng sẵn " + a.keyframe : "sinh bằng " + STUDIO.imageModel + " (~$" + imageCost(STUDIO.imageModel, "2K") + ")"}`];
  let est = a.keyframe ? 0 : imageCost(STUDIO.imageModel, "2K");
  for (const m of models) { plan.push(`${m} × ${runs} lượt × 8s = $${(videoCost(m, 8) * runs).toFixed(2)}`); est += videoCost(m, 8) * runs; }
  console.log(plan.join("\n") + `\nƯớc tính: $${est.toFixed(2)} ≈ ${usdToVnd(est).toLocaleString("vi-VN")} đ`);
  if (dry) return;

  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("Thiếu GEMINI_API_KEY trong .env");

  let keyframe = a.keyframe ? String(a.keyframe) : "";
  let spent = 0;
  if (!keyframe) {
    const refs = [String(a.product), String(a.background)].filter((p) => p && p !== "undefined").map((p) => ({ path: p, mimeType: p.endsWith(".png") ? "image/png" : "image/jpeg" }));
    keyframe = path.join(out, "keyframe.png");
    const r = await nanoImageEngine(key).generate({ prompt: `${prompt}. Photorealistic 9:16 vertical product shot, the exact product from the reference images placed in the reference background, hands only, no face.`, refs, aspectRatio: "9:16", size: "2K", outPath: keyframe });
    spent += r.costUsd;
    console.log(`Ảnh khoá → ${keyframe} ($${r.costUsd})`);
  }

  const rows: string[] = [];
  for (const m of models) {
    const eng = veoVideoEngine(key, { draft: m, final: m });
    for (let i = 1; i <= runs; i++) {
      const outPath = path.join(out, `${m}_run${i}.mp4`);
      const t0 = Date.now();
      try {
        const r = await eng.generate({ prompt, firstFrame: { path: keyframe, mimeType: "image/png" }, durationSec: 8, aspectRatio: "9:16", tier: "draft", motionLevel: "medium", outPath });
        spent += r.costUsd;
        rows.push(`| ${path.basename(outPath)} | ${m} | ${((Date.now() - t0) / 1000).toFixed(0)}s | $${r.costUsd} |  |  |  |  |`);
        console.log(`✓ ${outPath} (${((Date.now() - t0) / 1000).toFixed(0)}s, $${r.costUsd})`);
      } catch (e: any) {
        rows.push(`| (lỗi) | ${m} | — | — | — | — | — | — | ${e?.message || e} |`);
        console.error(`✗ ${m} lượt ${i}: ${e?.message || e}`);
      }
    }
  }
  for (let i = 1; i <= runs; i++) rows.push(`| kling-3.0-pro_run${i}.mp4 (tải tay từ kling.ai, cùng keyframe) | kling-3.0-pro | — | $${videoCost("kling-3.0-pro", 8)} |  |  |  |  |`);

  const md = [
    `# Bench Bước 0 — ${new Date().toISOString().slice(0, 10)}`, "",
    `Prompt: ${prompt}`, `Ảnh khoá: ${keyframe}`, `Đã tiêu (API): $${spent.toFixed(3)} ≈ ${usdToVnd(spent).toLocaleString("vi-VN")} đ`, "",
    "Chấm 1–5 mỗi cột. Điểm cao = tốt.", "",
    "| File | Model | Thời gian | Giá | Chữ bao bì không méo | Bàn tay không dị dạng | Chuyển động tự nhiên | Bám khung đầu | Ghi chú |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
  fs.writeFileSync(path.join(out, "scores.md"), md);
  console.log(`\nPhiếu chấm: ${path.join(out, "scores.md")}`);
}

if (process.argv[1] && process.argv[1].endsWith("studio-bench.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
