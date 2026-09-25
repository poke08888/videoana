import { css as c } from "../lib/csx";
import { styleZipUrl, fmtN } from "./styleApi";

const LAYER: Record<string, string> = { structure: "Cấu trúc & nhịp", visual: "Hình ảnh & khung", text: "Text & đồ hoạ", audio: "Âm thanh", content: "Nội dung & giọng điệu", brand: "Nhận diện thương hiệu" };
const card = c("background:#fff;border:1px solid #ece4d6;border-radius:16px;padding:18px;margin-bottom:14px");

export function ProfileView({ bundle, isMobile }: { bundle: any; isMobile: boolean }) {
  const p = bundle.profile; const sp = p.profile; if (!sp) return null;
  const m = sp.metrics; const row = (k: string, s: any, unit = "") => <tr key={k}><td>{k}</td><td style={c("text-align:right")}><b>{s.median}</b>{unit}</td><td style={c("text-align:right;color:#8a7c67")}>{s.p25}–{s.p75}</td><td style={c("text-align:right;color:#8a7c67")}>{s.n}</td></tr>;
  const list = (xs: string[], color: string) => (xs.length ? <ul style={c("margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.5")}>{xs.map((x, i) => <li key={i} style={{ color }}>{x}</li>)}</ul> : <div style={c("font-size:13px;color:#8a7c67")}>—</div>);
  return (
    <div>
      <div style={card}>
        <div style={c("display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px")}>
          <div><b>@{sp.channel.handle}</b> · {sp.channel.nickname} · tổng hợp từ {sp.videos.used}/{sp.videos.total} video ({sp.videos.outliers.length} lệch style bị loại) · {sp.analyzedAt.slice(0, 10)}</div>
          <a href={styleZipUrl(p.id)} style={c("padding:10px 16px;border-radius:10px;background:#b06a16;color:#fff;font-weight:600;text-decoration:none")}>⬇ Tải skill .zip</a>
        </div>
      </div>
      <div style={{ ...c("display:grid;gap:14px"), gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
        <div style={card}><div style={c("font-weight:600;margin-bottom:6px")}>Số đo cốt lõi</div>
          <table style={c("width:100%;font-size:13px;border-collapse:collapse")}><thead><tr style={c("color:#8a7c67;text-align:right")}><th style={c("text-align:left")}>Chỉ số</th><th>Trung vị</th><th>P25–P75</th><th>n</th></tr></thead>
            <tbody>{row("Độ dài video", m.duration, " s")}{row("Nhịp cắt", m.cutsPerMin, " cut/phút")}{row("Độ dài shot", m.shotLen, " s")}{row("Âm lượng", m.loudness, " LUFS")}{row("Talking-head", m.talkingHeadRatio)}{row("B-roll", m.brollRatio)}</tbody></table></div>
        <div style={card}><div style={c("font-weight:600")}>KHÔNG BAO GIỜ</div>{list(sp.rules.never, "#9e3a3a")}</div>
        <div style={card}><div style={c("font-weight:600")}>Quy tắc cứng (≥ 70 %)</div>{list(sp.rules.hard, "#2a5a44")}</div>
        <div style={card}><div style={c("font-weight:600")}>Quy tắc mềm (40–69 %)</div>{list(sp.rules.soft, "#574a3a")}</div>
      </div>
      <div style={{ ...c("display:grid;gap:14px"), gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr" }}>
        {Object.keys(LAYER).map((L) => (
          <div key={L} style={card}><div style={c("font-weight:600;margin-bottom:6px")}>{LAYER[L]}</div>
            <table style={c("width:100%;font-size:12px;border-collapse:collapse")}><tbody>{Object.entries(sp.layers[L] || {}).filter(([, f]: any) => f.rule !== "none").map(([k, f]: any) => (
              <tr key={k} style={c("border-top:1px solid #f1eadf")}><td style={c("color:#8a7c67")}>{k}</td><td><b>{f.value}</b></td><td style={c("text-align:right")}>{Math.round(f.share * 100)} %</td><td style={{ color: f.rule === "hard" ? "#2a5a44" : "#b06a16" }}>{f.rule === "hard" ? "cứng" : "mềm"}</td></tr>))}</tbody></table>
            {Object.entries(sp.evidence || {}).filter(([k]) => k.startsWith(L + ".")).slice(0, 2).map(([k, urls]: any) => <div key={k} style={c("display:flex;gap:6px;margin-top:8px")}>{urls.slice(0, 3).map((u: string, i: number) => <img key={i} src={u} alt={k} style={c("height:72px;border-radius:8px")} />)}</div>)}
          </div>))}
      </div>
      <div style={card}><div style={c("font-weight:600;margin-bottom:6px")}>Công thức lặp lại</div>
        {(["opening", "closing", "cta"] as const).map((k) => <div key={k} style={c("margin-bottom:8px")}><div style={c("font-size:12px;color:#8a7c67;text-transform:uppercase")}>{k === "opening" ? "Mở đầu" : k === "closing" ? "Chốt" : "CTA"}</div>{sp.formulas[k].length ? sp.formulas[k].map((f: any, i: number) => <div key={i} style={c("font-size:13px")}>• <b>{f.text}</b> — {f.count} lần{f.examples?.[0] ? ` · “${f.examples[0]}”` : ""}</div>) : <div style={c("font-size:13px;color:#8a7c67")}>—</div>}</div>)}
      </div>
      {sp.exemplars.map((e: any, i: number) => (
        <div key={e.videoId} style={card}><div style={c("font-weight:600;margin-bottom:6px")}>Mẫu chuẩn {i + 1} · <a href={e.link} target="_blank" rel="noreferrer">{e.link}</a> · {fmtN(e.views)} view{e.duration ? ` · ${e.duration} s` : ""}</div>
          <div style={c("overflow-x:auto")}><table style={c("width:100%;font-size:12px;border-collapse:collapse;min-width:640px")}><thead><tr style={c("color:#8a7c67;text-align:left")}><th>Từ–đến</th><th>Shot</th><th>Chữ</th><th>Anim</th><th>SFX</th><th>Nhạc</th><th>Lời</th></tr></thead>
            <tbody>{e.timeline.map((t: any, j: number) => <tr key={j} style={c("border-top:1px solid #f1eadf")}><td>{t.from}–{t.to}</td><td>{t.shot}</td><td>{t.textOnScreen}</td><td>{t.textAnim}</td><td>{t.sfx}</td><td>{t.music}</td><td>{t.voice}</td></tr>)}</tbody></table></div></div>))}
      {sp.videos.outliers.length > 0 && <div style={card}><div style={c("font-weight:600;margin-bottom:6px")}>Video bị loại khi tổng hợp (lệch style)</div><ul style={c("margin:0;padding-left:18px;font-size:13px")}>{sp.videos.outliers.map((o: any) => <li key={o.videoId}>{o.videoId}: {o.reasons.join("; ")}</li>)}</ul></div>}
    </div>
  );
}
