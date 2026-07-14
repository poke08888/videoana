/**
 * src/lib/reportMd.ts — dựng bản Markdown của Phiếu phân tích video.
 *
 * Dùng cho nút "Copy Markdown" ở màn báo cáo: copy vào clipboard để dán
 * thẳng vào Google Sheets (bảng tự tách cột) hoặc Docs. Bao đủ các phần
 * của phiếu: nhận định, hook, storyboard, checklist, công thức, kho lời
 * thoại/hình ảnh, đối chuẩn, điểm "steal" và chỉ số thật (nếu có).
 */
import type { Analysis } from "../types";

// Ô trong bảng markdown: bỏ xuống dòng + escape dấu | để không vỡ bảng.
const cell = (s: any): string => String(s == null ? "" : s).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

const LEVEL_LABEL: Record<string, string> = { ok: "Đạt", mid: "Một phần", low: "Yếu" };

const nf = (n: any): string => Number(n || 0).toLocaleString("vi-VN");

export function buildReportMarkdown(a: Analysis, title: string, opts?: { score?: number; date?: string }): string {
  const score = opts?.score ?? (a as any).score;
  let md = `# ${title}\n`;
  if (a.subtitle) md += `${a.subtitle}\n`;

  // Meta + điểm tổng
  const meta = a.meta || ({} as Analysis["meta"]);
  md += `\n| Nền tảng | Thời lượng | Thể loại | Sản phẩm | Gương mặt | CTA |\n|---|---|---|---|---|---|\n`;
  md += `| ${cell(meta.platform)} | ${cell(meta.duration)} | ${cell(meta.genre)} | ${cell(meta.product)} | ${cell(meta.face)} | ${cell(meta.cta)} |\n`;
  const infoBits = [
    score != null ? `**Điểm tổng: ${score}/100**` : "",
    opts?.date ? `Ngày phân tích: ${opts.date}` : "",
    a.sourceUrl ? `Video gốc: ${a.sourceUrl}` : "",
  ].filter(Boolean);
  if (infoBits.length) md += `\n${infoBits.join(" · ")}\n`;

  if (a.contentSummary) md += `\n## Tóm tắt nội dung\n${a.contentSummary}\n`;

  // Nhận định nhanh
  const verdict = Array.isArray(a.verdict) ? a.verdict : [];
  if (verdict.length) {
    md += `\n## Nhận định nhanh\n\n| Hạng mục | Đánh giá | Ghi chú |\n|---|---|---|\n`;
    verdict.forEach((v) => { md += `| ${cell(v.label)} | ${cell(v.big)} | ${cell(v.note)} |\n`; });
  }
  if (a.verdictText) md += `\n${a.verdictText}\n`;

  // Hook
  if (a.hook) {
    md += `\n## Hook mở đầu\n`;
    if (a.hook.quote) md += `> "${a.hook.quote}"\n\n`;
    const bits = [
      a.hook.type ? `Kiểu: ${a.hook.type}` : "",
      a.hook.score != null ? `Điểm hook: ${a.hook.score}` : "",
      a.hook.viewerFirst != null ? (a.hook.viewerFirst ? "Viewer-first ✓" : "Creator-first") : "",
    ].filter(Boolean);
    if (bits.length) md += `${bits.join(" · ")}\n`;
    if (a.hook.note) md += `${a.hook.note}\n`;
  }

  // Storyboard
  const acts = Array.isArray(a.acts) ? a.acts : [];
  if (acts.length) {
    md += `\n## Storyboard\n`;
    acts.forEach((act, i) => {
      md += `\n### ${act.no || `Act ${i + 1}`} · ${act.range || ""} — ${act.title || ""}\n`;
      if (act.summary) md += `${act.summary}\n`;
      const beats = Array.isArray(act.beats) ? act.beats : [];
      if (beats.length) {
        md += `\n| Mốc | Cảnh quay | Lời thoại | Góc máy |\n|---|---|---|---|\n`;
        beats.forEach((b) => {
          const cam = [b.size, b.angle, b.move].filter(Boolean).join(" · ");
          md += `| ${cell(b.ts)} | ${cell(b.vi)}${b.note ? cell(` — ${b.note}`) : ""} | ${cell(b.voiceover)} | ${cell(cam)} |\n`;
        });
      }
    });
  }

  // Checklist
  const checklist = Array.isArray(a.checklist) ? a.checklist : [];
  if (checklist.length) {
    md += `\n## Checklist 7 điểm\n\n| Tiêu chí | Mức | Ghi chú |\n|---|---|---|\n`;
    checklist.forEach((r) => {
      const lv = (r as any).levelLabel || LEVEL_LABEL[String(r.level || "").toLowerCase()] || r.level || "";
      md += `| ${cell(r.crit)} | ${cell(lv)} | ${cell(r.note)} |\n`;
    });
  }

  // Công thức bùng nổ
  if (a.formulaVisual || a.formulaScript) {
    md += `\n## Công thức bùng nổ\n`;
    if (a.formulaVisual) md += `- **Trực quan:** ${a.formulaVisual}\n`;
    if (a.formulaScript) md += `- **Kịch bản:** ${a.formulaScript}\n`;
  }

  // Kho lời thoại / hình ảnh
  const quotes = Array.isArray(a.quotes) ? a.quotes : [];
  if (quotes.length) {
    md += `\n## Kho lời thoại đắt\n`;
    quotes.forEach((q) => { md += `- "${q}"\n`; });
  }
  const visuals = Array.isArray(a.visuals) ? a.visuals : [];
  if (visuals.length) {
    md += `\n## Kho hình ảnh / cảnh quay đắt\n`;
    visuals.forEach((v) => { md += `- ${v}\n`; });
  }

  // Đối chuẩn & góc quay mới
  if (a.objchuan?.type || a.objchuan?.note) {
    md += `\n## Đối chuẩn\n${[a.objchuan.type, a.objchuan.note].filter(Boolean).join(" — ")}\n`;
  }
  const angles = Array.isArray(a.newAngles) ? a.newAngles : [];
  if (angles.length) {
    md += `\n## Góc quay / hướng khai thác mới\n`;
    angles.forEach((x) => { md += `- ${x}\n`; });
  }

  // Điểm "steal"
  const steals = Array.isArray(a.steals) ? a.steals : [];
  if (steals.length) {
    md += `\n## Điểm "steal" đáng học\n\n| Thủ pháp | Tại thời điểm | Vì sao hiệu quả | Cách áp dụng |\n|---|---|---|---|\n`;
    steals.forEach((s) => { md += `| ${cell(s.thuphap)} | ${cell(s.at)} | ${cell(s.why)} | ${cell(s.how)} |\n`; });
  }

  // Chỉ số thật (nếu phiếu có)
  if (a.stats) {
    md += `\n## Chỉ số tương tác (${a.stats.source || "nền tảng"})\n\n| Views | Likes | Comments | Shares | Saves |\n|---|---|---|---|---|\n`;
    md += `| ${nf(a.stats.views)} | ${nf(a.stats.likes)} | ${nf(a.stats.comments)} | ${nf(a.stats.shares)} | ${nf(a.stats.saves)} |\n`;
  }
  if (a.ads) {
    md += `\n## Chỉ số ads trong cụm\n\n| Hiệu quả | Orders | Revenue | Traffic | CTR | CVR | ROAS |\n|---|---|---|---|---|---|---|\n`;
    md += `| ${cell(a.ads.label)} (${a.ads.efficiencyScore}) | ${nf(a.ads.orders)} | ${nf(a.ads.revenue)} | ${nf(a.ads.traffic)} | ${a.ads.ctr}% | ${a.ads.cvr}% | ${a.ads.roas}× |\n`;
  }

  return md;
}
