/**
 * server/synthesize.ts — TỔNG HỢP LÝ DO THÀNH CÔNG từ nhiều phiếu mổ xẻ.
 *
 * Người dùng tick chọn các phiếu ở màn Lịch sử → backend chắt mỗi phiếu thành
 * một "digest" gọn (verdict, hook, checklist đạt/yếu, công thức, steal, thoại
 * đắt) → đưa cả rổ vào Gemini (thuần chữ, không video) → nhận về 1 báo cáo
 * JSON: các lý do thành công CHUNG kèm bằng chứng + cách áp dụng.
 */

export interface SourceVideo {
  id: string;
  title: string;
  score: number;
  analysis: any; // phiếu mổ xẻ đã hoàn tất
}

/** Chắt 1 phiếu thành digest gọn cho prompt (bỏ storyboard chi tiết cho đỡ dài). */
function digestOf(v: SourceVideo): any {
  const a = v.analysis || {};
  const ok: string[] = [];
  const low: string[] = [];
  for (const r of a.checklist || []) {
    const lv = String(r.level || "").toLowerCase();
    const crit = String(r.crit || "").trim();
    if (lv === "ok") ok.push(crit);
    else if (lv === "low") low.push(crit);
  }
  return {
    title: v.title,
    score: v.score,
    genre: a.meta?.genre || "",
    product: a.meta?.product || "",
    verdict: (a.verdict || []).map((x: any) => ({ label: x.label, big: x.big, note: x.note })),
    hook: a.hook ? { type: a.hook.type, quote: a.hook.quote, score: a.hook.score, viewerFirst: !!a.hook.viewerFirst } : null,
    checklistDat: ok,
    checklistYeu: low,
    formulaVisual: a.formulaVisual || "",
    formulaScript: a.formulaScript || "",
    verdictText: a.verdictText || "",
    steals: (a.steals || []).slice(0, 4).map((s: any) => ({ thuphap: s.thuphap, why: s.why })),
    quotes: (a.quotes || []).slice(0, 3),
    stats: a.stats ? { likes: a.stats.likes, views: a.stats.views } : undefined,
  };
}

const REPORT_SCHEMA = `
Trả về DUY NHẤT một object JSON hợp lệ (không kèm markdown), theo schema:
{
  "title": "tên báo cáo ngắn gọn (vd 'Điểm chung 5 video bùng nổ ngành mỹ phẩm')",
  "overview": "3-4 câu tổng quan: nhóm video nói về gì, chất lượng chung, điểm nổi bật nhất",
  "reasons": [   // 4-8 LÝ DO THÀNH CÔNG CHUNG, xếp theo mức độ phổ biến giảm dần
    {
      "reason": "tên lý do ngắn (1 cụm)",
      "share": "x/y video có",
      "detail": "2-3 câu giải thích cơ chế vì sao yếu tố này khiến video chạy",
      "evidence": ["bằng chứng cụ thể, ghi rõ từ video nào: 'Tên video — chi tiết/câu thoại'"],
      "apply": "1-2 câu hướng dẫn áp dụng ngay khi sản xuất video mới"
    }
  ],
  "hookPattern": "khuôn hook chung của nhóm: kiểu hook nào thắng, viewer-first hay không, kèm 1-2 ví dụ",
  "formula": "công thức chung đúc từ cả nhóm, dạng mũi tên →: [Mở đầu] ... → [Nội dung] ... → [Sản phẩm] ... → [Chốt] ...",
  "differences": "điểm khác biệt đáng chú ý giữa video điểm cao và video điểm thấp trong nhóm (nếu nhóm khá đều thì nói rõ)",
  "actionChecklist": ["5-8 việc CỤ THỂ cần làm khi quay video mới theo khung thắng này"]
}
`.trim();

/** Dựng prompt tổng hợp từ danh sách phiếu đã chọn. */
export function buildSynthesisPrompt(videos: SourceVideo[]): string {
  const digests = videos.map(digestOf);
  return `Bạn là chuyên gia "mổ xẻ" video bán hàng short-form theo hệ thống Nonelab (TikTok
Shop / Douyin). Dưới đây là ${videos.length} PHIẾU MỔ XẺ đã hoàn tất (mỗi phiếu là kết quả
phân tích 1 video). Nhiệm vụ: TỔNG HỢP các LÝ DO THÀNH CÔNG LẶP LẠI giữa các video —
điểm chung nào xuất hiện ở nhiều video nhất chính là đòn bẩy đáng tin nhất.

YÊU CẦU:
- Chỉ rút lý do có mặt ở ÍT NHẤT 2 video (ghi rõ "x/y video có"). Không bịa.
- Bằng chứng phải CỤ THỂ: nêu tên video + chi tiết/câu thoại thật lấy từ phiếu.
- Giọng tiếng Việt trực tiếp, thực chiến; toàn bộ báo cáo bằng TIẾNG VIỆT.
- Mục tiêu cuối: người đọc cầm báo cáo là quay được video mới theo khung thắng.

DỮ LIỆU ${videos.length} PHIẾU (JSON):
${JSON.stringify(digests, null, 1)}

${REPORT_SCHEMA}`;
}
