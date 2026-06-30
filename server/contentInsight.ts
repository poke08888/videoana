/**
 * server/contentInsight.ts — đối chiếu NỘI DUNG (phiếu mổ xẻ) với CHỈ SỐ ads để
 * rút ra: content như thế nào thì CTR tốt / CVR tốt / ROAS tốt.
 *
 * Cách làm (minh bạch, không hộp đen): với mỗi chỉ số, chia video thành nhóm "tốt"
 * và nhóm "thấp" theo tier đã chấm, rồi đo TẦN SUẤT mỗi đặc điểm nội dung xuất hiện
 * ở 2 nhóm. Đặc điểm nào nổi bật ở nhóm tốt mà hiếm ở nhóm thấp = đòn bẩy nội dung.
 */
import type { AdsReport } from "./reportHtml.js";

export interface CohortVideo {
  ads?: AdsReport;
  eng?: { tier: string }; // campaign: xếp loại tương tác
  analysis: any; // phiếu mổ xẻ (Analysis) đã hoàn tất
  title?: string;
  videoId?: string;
}

/** Ví dụ cụ thể rút từ 1 video thắng để minh hoạ cách làm (như mổ xẻ 1 video). */
export interface TraitExample {
  title?: string;
  link?: string;
  hook?: string; // câu hook nguyên văn
  lines: string[]; // lời thoại/voice-off đắt
  shots: { ts: string; vi: string; cam: string }[]; // cảnh quay + góc máy
}

export interface TraitDiff {
  trait: string;
  goodRate: number; // % video nhóm tốt có đặc điểm này
  badRate: number; // % video nhóm thấp có đặc điểm này
  lift: number; // goodRate - badRate (đòn bẩy)
  goodCount: number;
  total: number; // số video nhóm tốt
  examples: TraitExample[]; // ví dụ thật: gọi như thế nào, quay cảnh nào
}

export interface MetricInsight {
  metric: string; // ctr | cvr | roas | engagement
  goodN: number;
  badN: number;
  drivers: TraitDiff[]; // đặc điểm đẩy chỉ số LÊN
  drags: TraitDiff[]; // đặc điểm kéo chỉ số XUỐNG
  conclusion: string;
}

export interface CohortInsight {
  analyzed: number;
  metrics: MetricInsight[];
}

/** Bóc các đặc điểm nội dung (categorical) từ một phiếu mổ xẻ. */
function extractTraits(a: any): string[] {
  const t: string[] = [];
  if (!a || typeof a !== "object") return t;
  const genre = a.meta?.genre;
  if (genre) t.push(`Thể loại: ${String(genre).trim()}`);
  if (a.hook?.type) t.push(`Hook: ${String(a.hook.type).split("|")[0].trim()}`);
  if (a.hook?.viewerFirst) t.push("Hook hướng người xem (viewer-first)");
  // 7 tiêu chí checklist — đặc điểm = tiêu chí ĐẠT.
  for (const r of a.checklist || []) {
    const lv = String(r.level || "").toLowerCase();
    if (lv === "ok") t.push(`Đạt: ${String(r.crit || "").replace(/^[①②③④⑤⑥⑦]\s*/, "").trim()}`);
  }
  return t.filter(Boolean);
}


/** Rút ví dụ cụ thể từ 1 phiếu mổ xẻ: câu hook, lời thoại đắt, cảnh quay + góc máy. */
function exampleFrom(v: CohortVideo): TraitExample {
  const a = v.analysis || {};
  const lines: string[] = (a.quotes || []).map((q: any) => String(q).trim()).filter(Boolean).slice(0, 3);
  const shots: { ts: string; vi: string; cam: string }[] = [];
  for (const act of a.acts || []) {
    for (const b of act.beats || []) {
      if (!b.vi) continue;
      const cam = [b.size, b.angle, b.move].filter(Boolean).join(" · ");
      shots.push({ ts: String(b.ts || ""), vi: String(b.vi), cam });
      if (shots.length >= 3) break;
    }
    if (shots.length >= 3) break;
  }
  return {
    title: v.title,
    link: a.sourceUrl || (a.ads && a.ads.link) || "",
    hook: a.hook?.quote ? String(a.hook.quote) : "",
    lines,
    shots,
  };
}

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0);

function contrast(videos: CohortVideo[], getTier: (v: CohortVideo) => string, metric: string, short: string): MetricInsight {
  const good = videos.filter((v) => getTier(v) === "tốt");
  const bad = videos.filter((v) => getTier(v) === "thấp");
  const goodTraits = good.map((v) => new Set(extractTraits(v.analysis)));
  const badTraits = bad.map((v) => new Set(extractTraits(v.analysis)));

  // Tập đặc điểm xuất hiện ở ≥1 video.
  const all = new Set<string>();
  for (const s of [...goodTraits, ...badTraits]) for (const x of s) all.add(x);

  const diffs: TraitDiff[] = [];
  for (const trait of all) {
    const gc = goodTraits.filter((s) => s.has(trait)).length;
    const bc = badTraits.filter((s) => s.has(trait)).length;
    const goodRate = pct(gc, good.length);
    const badRate = pct(bc, bad.length);
    // Bỏ đặc điểm quá hiếm ở nhóm tốt (nhiễu).
    if (gc < Math.max(2, Math.ceil(good.length * 0.25))) continue;
    // Ví dụ thật: lấy tối đa 3 video nhóm tốt CÓ đặc điểm này để minh hoạ cách làm.
    const examples = good
      .filter((v) => new Set(extractTraits(v.analysis)).has(trait))
      .slice(0, 3)
      .map(exampleFrom);
    diffs.push({ trait, goodRate, badRate, lift: goodRate - badRate, goodCount: gc, total: good.length, examples });
  }

  const drivers = diffs.filter((d) => d.lift > 10).sort((a, b) => b.lift - a.lift).slice(0, 6);
  const drags = diffs.filter((d) => d.lift < -10).sort((a, b) => a.lift - b.lift).slice(0, 4);

  const name = short;
  let conclusion: string;
  if (good.length < 3) {
    conclusion = `Chưa đủ video nhóm ${name} tốt (${good.length}) để kết luận chắc chắn — cần thêm dữ liệu.`;
  } else if (!drivers.length) {
    conclusion = `Nhóm ${name} tốt và thấp không khác biệt rõ về nội dung trong tập này.`;
  } else {
    const top = drivers.slice(0, 3).map((d) => `“${d.trait}” (${d.goodRate}% nhóm tốt vs ${d.badRate}% nhóm thấp)`);
    conclusion = `Video có ${name} tốt thường: ${top.join("; ")}.`;
  }
  return { metric, goodN: good.length, badN: bad.length, drivers, drags, conclusion };
}

/** Kết luận content↔chỉ số ads (cụm import Excel): CVR · ROAS · CTR. */
export function buildCohortInsight(videos: CohortVideo[]): CohortInsight {
  const usable = videos.filter((v) => v.analysis && v.analysis.checklist && v.ads);
  return {
    analyzed: usable.length,
    metrics: [
      contrast(usable, (v) => v.ads!.cvrTier, "cvr", "CVR"),
      contrast(usable, (v) => v.ads!.roasTier, "roas", "ROAS"),
      contrast(usable, (v) => v.ads!.ctrTier, "ctr", "CTR"),
    ],
  };
}

/** Kết luận điểm chung của video TƯƠNG TÁC CAO (cụm campaign tìm theo từ khóa). */
export function buildCampaignInsight(videos: CohortVideo[]): CohortInsight {
  const usable = videos.filter((v) => v.analysis && v.analysis.checklist && v.eng);
  return {
    analyzed: usable.length,
    metrics: [contrast(usable, (v) => v.eng!.tier, "engagement", "tương tác")],
  };
}

/**
 * Chắt lọc kho kiến thức (markdown) cho 1 sản phẩm từ kết luận cụm — dùng để hiển
 * thị, cho sửa, và BƠM vào prompt Gemini cho các phân tích sau của sản phẩm đó.
 */
export function buildKnowledgeDoc(
  product: string,
  cohortSummary: { count: number; medianRoas: number; medianCtr: number; medianCvr: number },
  insight: CohortInsight
): string {
  const lines: string[] = [];
  lines.push(`# Kho kiến thức nội dung — ${product}`);
  lines.push(
    `Chắt lọc từ ${cohortSummary.count} video có chỉ số ads thực tế (đã mổ xẻ ${insight.analyzed}). ` +
      `Mốc cụm: ROAS ~${cohortSummary.medianRoas}, CTR ~${cohortSummary.medianCtr}%, CVR ~${cohortSummary.medianCvr}%.`
  );
  const labelOf: Record<string, string> = {
    cvr: "CHỐT ĐƠN (CVR) — đòn bẩy ra đơn",
    roas: "HIỆU QUẢ CHI PHÍ (ROAS)",
    ctr: "THU HÚT CLICK (CTR)",
    engagement: "TƯƠNG TÁC CAO — điểm chung video viral",
  };
  for (const mi of insight.metrics) {
    lines.push(`\n## ${labelOf[mi.metric]}`);
    lines.push(mi.conclusion);
    if (mi.drivers.length) {
      lines.push("Nên có (đặc điểm đẩy chỉ số lên) — kèm cách làm cụ thể từ video thắng:");
      for (const d of mi.drivers) {
        lines.push(`\n### ${d.trait} — ${d.goodRate}% video tốt có (vs ${d.badRate}% video kém)`);
        const ex = (d.examples || [])[0];
        if (ex) {
          if (ex.hook) lines.push(`- Câu mở (hook) nói như: “${ex.hook}”`);
          if (ex.lines?.length) lines.push(`- Lời thoại đắt: ${ex.lines.map((l) => `“${l}”`).join(" · ")}`);
          if (ex.shots?.length) {
            lines.push(`- Quay cảnh:`);
            for (const s of ex.shots) lines.push(`  · [${s.ts}] ${s.vi}${s.cam ? ` — góc máy: ${s.cam}` : ""}`);
          }
          if (ex.title) lines.push(`- (Mẫu từ video: ${ex.title}${ex.link ? ` — ${ex.link}` : ""})`);
        }
      }
    }
    if (mi.drags.length) {
      lines.push("Nên tránh / không phân hoá:");
      for (const d of mi.drags) lines.push(`- ${d.trait} — phổ biến hơn ở nhóm kém.`);
    }
  }
  lines.push(
    `\n## Quy tắc áp dụng\nƯu tiên nội dung làm bật CHỐT ĐƠN (CVR) — chứng minh kết quả nhìn thấy, ` +
      `so sánh trước/sau, CTA rõ — thay vì chỉ chạy theo view/CTR. Lắp sản phẩm ${product} vào các khung thắng ở trên.`
  );
  return lines.join("\n");
}
