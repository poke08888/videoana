export interface EngagementStats {
  source: string;
  awemeId?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

export interface AdsReport {
  efficiencyScore: number;
  label: string;
  orders: number;
  revenue: number;
  traffic: number;
  clicks: number;
  ctr: number;
  cvr: number;
  cost: number;
  cpm: number;
  cpc: number;
  roas: number;
  ctrTier: string;
  cvrTier: string;
  roasTier: string;
  link?: string;
}

export interface Analysis {
  subtitle: string;
  sourceUrl?: string;
  stats?: EngagementStats;
  ads?: AdsReport;
  meta: {
    platform: string;
    duration: string;
    genre: string;
    product: string;
    face: string;
    cta: string;
  };
  verdict: { label: string; big: string; note: string }[];
  hook?: { quote?: string; type?: string; viewerFirst?: boolean; score?: number; note?: string };
  acts: {
    range: string;
    title: string;
    summary: string;
    no?: string;
    beats: {
      ts: string;
      frame?: string;
      vi: string;
      voiceover?: string;
      note?: string;
      size?: string;
      angle?: string;
      move?: string;
      action?: string;
      setting?: string;
      sound?: string;
      wardrobe?: string;
      cast?: string;
      matrix?: { k: string; en: string; v: string }[];
    }[];
  }[];
  checklist: { crit: string; level: "ok" | "mid" | "low"; note: string; levelLabel?: string }[];
  formulaVisual: string;
  formulaScript: string;
  verdictText: string;
  quotes: string[];
  visuals: string[];
  objchuan?: { type: string; note: string };
  newAngles?: string[];
  steals?: { thuphap: string; at: string; why: string; how: string }[];
}

const esc = (s: any): string =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const nfVi = (n: any): string => Number(n || 0).toLocaleString("vi-VN");

/** Khối "Chỉ số tương tác thực tế" — chỉ hiện khi có dữ liệu từ TikTok. */
function statsSection(a: Analysis): string {
  const s = a.stats;
  if (!s) return "";
  const cards = [
    ["Lượt xem", nfVi(s.views)],
    ["Lượt thích", nfVi(s.likes)],
    ["Bình luận", nfVi(s.comments)],
    ["Chia sẻ", nfVi(s.shares)],
    ["Lưu", nfVi(s.saves)],
  ]
    .map((m) => `<div class="vcard"><div class="vlabel">${esc(m[0])}</div><div class="vbig">${esc(m[1])}</div></div>`)
    .join("");
  return `<section class="sec"><div class="sh"><span class="sno">Tương tác</span><h2>Chỉ số tương tác thực tế · ${esc(s.source)}</h2></div><div class="verdict">${cards}</div></section>`;
}

const TIER_CHIP: Record<string, string> = { "tốt": "ok", "khá": "mid", "thấp": "low" };

/** Khối "Hiệu quả quảng cáo" — chỉ hiện khi video có chỉ số ads (từ import Excel). */
function adsSection(a: Analysis): string {
  const s = a.ads;
  if (!s) return "";
  const card = (label: string, val: string, tier?: string) =>
    `<div class="vcard"><div class="vlabel">${esc(label)}</div><div class="vbig">${esc(val)}</div>` +
    (tier ? `<p><span class="chip ${TIER_CHIP[tier] || "mid"}">${esc(tier)}</span></p>` : "") +
    `</div>`;
  const cards = [
    card("Điểm hiệu quả", `${s.efficiencyScore}/100`, s.label),
    card("ROAS", `${s.roas}×`, s.roasTier),
    card("CVR (chốt đơn)", `${s.cvr}%`, s.cvrTier),
    card("CTR (click)", `${s.ctr}%`, s.ctrTier),
    card("Đơn (SKU)", nfVi(s.orders)),
    card("Doanh thu", nfVi(s.revenue)),
  ].join("");
  return `<section class="sec"><div class="sh"><span class="sno">Chỉ số ads</span><h2>Hiệu quả quảng cáo · xếp loại ${esc(s.label)}</h2></div><div class="verdict">${cards}</div></section>`;
}

/** Tạo file HTML độc lập của phiếu phân tích. */
export function buildReportHTML(a: Analysis): string {
  const meta = a.meta;
  const src = a.sourceUrl || (a.ads && a.ads.link) || "";
  const srcBlock = src
    ? `<p class="srcl"><a href="${esc(src)}" target="_blank" rel="noopener">▶ Xem video gốc</a><span>${esc(src)}</span></p>`
    : "";
  const metaRow = [
    ["Nền tảng", meta.platform],
    ["Thời lượng", meta.duration],
    ["Thể loại", meta.genre],
    ["Sản phẩm", meta.product],
    ["Gương mặt", meta.face],
    ["CTA", meta.cta],
  ]
    .map((m) => `<div><dt>${esc(m[0])}</dt><dd>${esc(m[1])}</dd></div>`)
    .join("");
  const verdict = a.verdict
    .map((v) => `<div class="vcard"><div class="vlabel">${esc(v.label)}</div><div class="vbig">${esc(v.big)}</div><p>${esc(v.note)}</p></div>`)
    .join("");
  const acts = a.acts
    .map((act) => {
      const beats = act.beats
        .map((b) => {
          const mx = (b.matrix || [])
            .map((mr) => `<div class="mrow"><div class="mlbl"><b>${esc(mr.k)}</b><span>${esc(mr.en)}</span></div><div class="mval">${esc(mr.v)}</div></div>`)
            .join("");
          const frameInner = b.frame
            ? `<img class="fimg" src="${b.frame}" alt="${esc(b.ts)}"/>`
            : `<span class="ico">🎬</span>`;
          const vo = b.voiceover
            ? `<div class="vo"><span class="volbl">🎙 Voice-off</span><p>“${esc(b.voiceover)}”</p></div>`
            : "";
          return `<div class="beat"><div class="frame">${frameInner}<span class="ts">${esc(b.ts)}</span></div><div class="bb"><p class="vi">${esc(b.vi)}</p><p class="note">${esc(b.note)}</p>${vo}<div class="matrix"><div class="cam"><div class="mlbl"><b>Góc máy</b><span>CAMERA</span></div><div class="camp"><span><i>Cỡ cảnh</i>${esc(b.size)}</span><span><i>Góc</i>${esc(b.angle)}</span><span><i>Chuyển động</i>${esc(b.move)}</span></div></div><div class="mgrid">${mx}</div></div></div></div>`;
        })
        .join("");
      return `<section class="act"><div class="act-head"><div class="act-no">${esc(act.no)}</div><div><div class="act-range">${esc(act.range)}</div><h3>${esc(act.title)}</h3><p class="sum">${esc(act.summary)}</p></div></div><div class="beats">${beats}</div></section>`;
    })
    .join("");
  const chips: Record<string, string> = { ok: "ok", mid: "mid", low: "low" };
  const checklist = a.checklist
    .map((r) => `<tr><td class="cc">${esc(r.crit)}</td><td><span class="chip ${chips[r.level] || "ok"}">${esc(r.levelLabel)}</span></td><td class="cn">${esc(r.note)}</td></tr>`)
    .join("");
  const quotes = a.quotes.map((q) => `<li>${esc(q)}</li>`).join("");
  const visuals = a.visuals.map((v) => `<li>${esc(v)}</li>`).join("");
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phiếu phân tích video · ${esc(meta.product)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Space+Grotesk:wght@400;500;600;700&family=Be+Vietnam+Pro:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>:root{--ui:'Space Grotesk',sans-serif;--disp:'Fraunces',serif;--body:'Be Vietnam Pro',sans-serif}
*{box-sizing:border-box}body{margin:0;font-family:var(--body);color:#2a2016;line-height:1.62;background:radial-gradient(1100px 560px at 88% -8%,rgba(176,106,22,.10),transparent 60%),#f6f1e7;font-size:16px}
.wrap{max-width:1000px;margin:0 auto;padding:0 22px}
.hero{background:linear-gradient(160deg,#241a10,#3a2a16);color:#f6efe0;padding:56px 0 30px}
.eb{font-family:var(--ui);text-transform:uppercase;letter-spacing:.3em;font-size:11px;color:#e0a64e;font-weight:600}
h1{font-family:var(--disp);font-weight:900;font-size:clamp(38px,8vw,80px);line-height:.96;letter-spacing:-.02em;margin:18px 0 8px}
h1 em{font-style:italic;font-weight:400;color:#e8bd72}
.sub{font-family:var(--disp);font-style:italic;font-size:clamp(17px,3vw,24px);color:#cdbfa6;margin:0 0 16px}
.srcl{font-family:var(--ui);font-size:13px;margin:0 0 24px}.srcl a{color:#e8bd72;text-decoration:none;font-weight:600;border-bottom:1px solid rgba(232,189,114,.4)}.srcl span{color:#b3a489;word-break:break-all;margin-left:8px}
dl.meta{display:flex;flex-wrap:wrap;gap:0;border:1px solid rgba(224,166,78,.25);border-radius:14px;overflow:hidden;background:rgba(255,255,255,.04)}
dl.meta div{flex:1 1 150px;padding:15px 18px;border-right:1px solid rgba(224,166,78,.12)}
dl.meta dt{font-family:var(--ui);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#b3a489;margin-bottom:5px}
dl.meta dd{margin:0;font-weight:600;font-size:14px}
.sec{padding:54px 0;border-bottom:1px solid rgba(70,54,32,.12)}
.sh{display:flex;align-items:baseline;gap:14px;margin-bottom:26px}
.sno{font-family:var(--ui);font-weight:700;font-size:12px;color:#7a4a10;border:1px solid rgba(140,96,40,.3);border-radius:99px;padding:4px 12px}
h2{font-family:var(--disp);font-weight:600;font-size:clamp(22px,4vw,34px);margin:0;letter-spacing:-.015em}
.verdict{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.vcard{background:linear-gradient(160deg,#f7f0e2,#fffdf8);border:1px solid rgba(140,96,40,.22);border-radius:16px;padding:20px}
.vlabel{font-family:var(--ui);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;margin-bottom:9px}
.vbig{font-family:var(--disp);font-size:28px;font-weight:600;color:#9a5a12;line-height:1}
.vcard p{margin:10px 0 0;font-size:13px;color:#574a3a}
.act{margin-bottom:40px}
.act-head{display:flex;gap:16px;align-items:flex-start;margin-bottom:18px}
.act-no{font-family:var(--disp);font-weight:900;font-size:19px;color:#fff;background:#b06a16;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;flex:none;box-shadow:0 0 0 5px #f6f1e7,0 0 0 6px rgba(140,96,40,.25)}
.act-range{font-family:var(--ui);font-size:11px;letter-spacing:.12em;color:#b06a16;text-transform:uppercase;font-weight:600}
.act-head h3{font-family:var(--disp);font-size:21px;font-weight:600;margin:2px 0 5px}
.sum{margin:0;color:#574a3a;font-size:14px;max-width:66ch}
.beats{display:flex;flex-direction:column;gap:12px;margin-left:56px}
.beat{display:flex;gap:15px;background:#fffdf8;border:1px solid rgba(70,54,32,.13);border-radius:14px;padding:14px}
.frame{position:relative;flex:none;width:88px;height:152px;border-radius:10px;overflow:hidden;border:1px solid rgba(140,96,40,.22);background:linear-gradient(150deg,#e7d4b0,#c9a86f 55%,#a07c44);display:grid;place-items:center}
.frame .fimg{width:100%;height:100%;object-fit:cover;display:block}.frame .ico{font-size:26px;opacity:.55}.frame .ts{position:absolute;left:0;bottom:0;font-family:var(--ui);font-size:9px;font-weight:600;background:#b06a16;color:#fff;padding:1px 6px;border-top-right-radius:6px}
.bb{min-width:0;flex:1}.vi{font-size:13.5px;color:#9a5a12;margin:0 0 6px;font-weight:600;line-height:1.45}.note{font-size:11.5px;color:#8a7c67;margin:0 0 10px;line-height:1.5}.vo{background:rgba(60,122,94,.07);border-left:3px solid #3c7a5e;border-radius:0 8px 8px 0;padding:7px 10px;margin:0 0 10px}.vo .volbl{font-family:var(--ui);font-size:8px;letter-spacing:.13em;text-transform:uppercase;color:#2f6b4f;font-weight:600;display:block;margin-bottom:2px}.vo p{margin:0;font-size:12px;line-height:1.5;color:#2a3a30;font-style:italic}
.matrix{border-top:1px solid rgba(140,96,40,.18);padding-top:9px}
.cam{display:flex;gap:13px;background:rgba(176,106,22,.06);border-left:3px solid #b06a16;border-radius:0 9px 9px 0;padding:8px 11px;margin-bottom:8px}
.cam .mlbl{flex:none;width:70px}.camp{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 14px;flex:1}
.camp span{font-size:11.5px;line-height:1.35}.camp i{font-style:normal;font-family:var(--ui);font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#b06a16;display:block;margin-bottom:2px}
.mgrid{display:grid;grid-template-columns:1fr 1fr;gap:0 22px}
.mrow{display:flex;gap:10px;align-items:baseline;padding:4px 0;border-bottom:1px solid rgba(70,54,32,.1)}
.mlbl b{display:block;font-size:11.5px;font-weight:600}.mlbl span{display:block;font-family:var(--ui);font-size:8px;letter-spacing:.13em;color:#8a7c67}
.mval{font-size:11.5px;color:#574a3a;line-height:1.4}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-family:var(--ui);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;font-weight:600;padding:0 14px 12px;border-bottom:1px solid rgba(140,96,40,.3)}
td{padding:14px;border-bottom:1px solid rgba(70,54,32,.1);vertical-align:top}.cc{font-weight:600;width:24%}.cn{color:#574a3a;font-size:13px}
.chip{display:inline-block;font-family:var(--ui);font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;white-space:nowrap}
.chip.ok{background:rgba(60,122,94,.13);color:#2f6b4f;border:1px solid rgba(60,122,94,.4)}
.chip.mid{background:rgba(176,106,22,.14);color:#8a5614;border:1px solid rgba(176,106,22,.4)}
.chip.low{background:rgba(158,58,58,.12);color:#8f3232;border:1px solid rgba(158,58,58,.4)}
.formula{background:#f7f0e2;border:1px solid rgba(140,96,40,.22);border-left:3px solid #b06a16;border-radius:0 14px 14px 0;padding:18px 22px;margin-bottom:14px}
.fl{font-family:var(--ui);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#b06a16;margin-bottom:8px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.kh{font-family:var(--ui);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b06a16;font-weight:600;margin:0 0 8px}
ul.k{list-style:none;padding:0;margin:0}ul.k li{position:relative;padding:10px 0 10px 24px;border-bottom:1px solid rgba(70,54,32,.1);font-size:13.5px;color:#574a3a;line-height:1.5}
ul.k li:before{content:"";position:absolute;left:4px;top:17px;width:7px;height:7px;border-radius:50%;background:#b06a16}
footer{padding:40px 0 70px;color:#8a7c67;font-size:12.5px;font-family:var(--ui);letter-spacing:.04em}
@media(max-width:680px){.two{grid-template-columns:1fr}.beats{margin-left:0}.mgrid{grid-template-columns:1fr}.camp{grid-template-columns:1fr}table,tbody,tr,td{display:block;width:100%}thead{display:none}.cc{width:auto}td{border:none;padding:3px 0}tr{border-bottom:1px solid rgba(70,54,32,.1);padding:14px 0}}
</style></head><body>
<header class="hero"><div class="wrap"><span class="eb">Nonelab · Phân tích video · Khung Năm Lực</span><h1>Phiếu <em>phân tích</em> video</h1><p class="sub">${esc(a.subtitle)}</p>${srcBlock}<dl class="meta">${metaRow}</dl></div></header>
<main class="wrap">
<section class="sec"><div class="sh"><span class="sno">Chốt nhanh</span><h2>Vì sao nó chạy</h2></div><div class="verdict">${verdict}</div></section>
${adsSection(a)}
${statsSection(a)}
<section class="sec"><div class="sh"><span class="sno">Storyboard</span><h2>Phân tích theo phân cảnh</h2></div>${acts}</section>
<section class="sec"><div class="sh"><span class="sno">Checklist</span><h2>7 điểm hiệu quả</h2></div><table><thead><tr><th>Tiêu chí</th><th>Mức độ</th><th>Ghi chú</th></tr></thead><tbody>${checklist}</tbody></table></section>
<section class="sec"><div class="sh"><span class="sno">Công thức</span><h2>Tái dùng</h2></div><div class="formula"><div class="fl">Cấu trúc hình ảnh</div><div>${esc(a.formulaVisual)}</div></div><div class="formula"><div class="fl">Cấu trúc lời thoại</div><div>${esc(a.formulaScript)}</div></div><p style="color:#574a3a;max-width:66ch">${esc(a.verdictText)}</p></section>
<section class="sec" style="border:none"><div class="two"><div><div class="kh">Kho lời thoại · 文案库</div><ul class="k">${quotes}</ul></div><div><div class="kh">Kho hình ảnh · 画面库</div><ul class="k">${visuals}</ul></div></div></section>
</main>
<footer class="wrap">Nonelab · Hệ thống video bùng nổ — Phiếu phân tích theo khung Năm Lực. Xuất từ Nonelab Studio.</footer>
</body></html>`;
}
