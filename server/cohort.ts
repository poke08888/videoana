/**
 * server/cohort.ts — vòng đời cụm phân tích chỉ số + kho kiến thức theo sản phẩm.
 *
 *  - getProductKnowledge / saveProductKnowledge: đọc-ghi kho kiến thức (bơm vào prompt).
 *  - finalizeCohortIfDone: khi mọi video của cụm đã mổ xẻ xong → dựng kết luận
 *    content↔chỉ số, lưu vào ads_cohorts.insight và cập nhật kho kiến thức sản phẩm.
 */
import { runQuery, getQuery, allQuery } from "./db.js";
import { slug } from "../src/lib/analysis.js";
import { buildCohortInsight, buildCampaignInsight, buildKnowledgeDoc, type CohortVideo } from "./contentInsight.js";

export function productSlug(product: string): string {
  return slug(product || "san-pham");
}

/** Lấy nội dung kho kiến thức của 1 sản phẩm (theo slug). null nếu chưa có. */
export async function getProductKnowledge(product: string): Promise<string | null> {
  if (!product) return null;
  const row = await getQuery<{ content: string }>(
    "SELECT content FROM product_knowledge WHERE slug = ?",
    [productSlug(product)]
  );
  return row?.content || null;
}

/** Tạo/ghi đè kho kiến thức của sản phẩm. */
export async function saveProductKnowledge(product: string, content: string, dateISO: string): Promise<void> {
  await runQuery(
    `INSERT INTO product_knowledge (slug, product, content, updated) VALUES (?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET product = excluded.product, content = excluded.content, updated = excluded.updated`,
    [productSlug(product), product, content, dateISO]
  );
}

/**
 * Nếu cụm đã xử lý xong toàn bộ (không còn pending/processing), dựng kết luận
 * content↔chỉ số + cập nhật kho kiến thức. An toàn khi gọi nhiều lần (idempotent).
 * Trả về true nếu vừa chốt xong.
 */
export async function finalizeCohortIfDone(cohortId: string, dateISO: string): Promise<boolean> {
  if (!cohortId) return false;
  const pending = await getQuery<{ n: number }>(
    "SELECT COUNT(*) AS n FROM history WHERE cohort_id = ? AND status IN ('pending','processing')",
    [cohortId]
  );
  if (pending && pending.n > 0) return false; // còn video đang chạy

  const cohort = await getQuery<{ id: string; product: string; summary: string; kind: string }>(
    "SELECT id, product, summary, kind FROM ads_cohorts WHERE id = ?",
    [cohortId]
  );
  if (!cohort) return false;
  const isCampaign = cohort.kind === "campaign";

  const rows = await allQuery<{ title: string; analysis: string }>(
    "SELECT title, analysis FROM history WHERE cohort_id = ? AND status = 'completed'",
    [cohortId]
  );
  const videos: CohortVideo[] = [];
  for (const r of rows) {
    let a: any = null;
    try {
      a = JSON.parse(r.analysis);
    } catch {
      continue;
    }
    if (!a || !a.checklist) continue;
    if (isCampaign && a.eng) videos.push({ eng: a.eng, analysis: a, title: r.title });
    else if (!isCampaign && a.ads) videos.push({ ads: a.ads, analysis: a, title: r.title });
  }
  if (videos.length < 3) return false; // chưa đủ để kết luận

  const insight = isCampaign ? buildCampaignInsight(videos) : buildCohortInsight(videos);
  await runQuery("UPDATE ads_cohorts SET insight = ? WHERE id = ?", [JSON.stringify(insight), cohortId]);

  let summary: any = {};
  try {
    summary = JSON.parse(cohort.summary || "{}");
  } catch {
    /* ignore */
  }
  const doc = buildKnowledgeDoc(
    cohort.product,
    {
      count: summary.count || videos.length,
      medianRoas: summary.summary?.medianRoas ?? 0,
      medianCtr: summary.summary?.medianCtr ?? 0,
      medianCvr: summary.summary?.medianCvr ?? 0,
    },
    insight
  );
  await saveProductKnowledge(cohort.product, doc, dateISO);
  return true;
}
