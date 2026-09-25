import { useEffect, useState } from "react";
import { css as c } from "../lib/csx";
import { pickStyle, createStyle, getStyleHealth, fmtN } from "./styleApi";

export function PickForm({ showToast, onCreated, onCancel }: { showToast: (m: string) => void; onCreated: (id: string) => void; onCancel: () => void }) {
  const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null); const [off, setOff] = useState<Set<string>>(new Set()); const [ex, setEx] = useState<Set<string>>(new Set());
  // Ngưỡng tối thiểu lấy từ server (STYLE_MIN_VIDEOS) — server cũng chặn ở /create; 15 là mặc định khi chưa tải được.
  const [minVideos, setMinVideos] = useState(15);
  useEffect(() => { let alive = true; getStyleHealth().then((h: any) => { if (alive && h?.ok && Number(h.minVideos) > 0) setMinVideos(Number(h.minVideos)); }); return () => { alive = false; }; }, []);
  const selected = res ? res.videos.length - off.size : 0; const tooFew = selected < minVideos;
  const pick = async () => {
    if (!url.trim()) return showToast("Nhập link kênh trước.");
    setBusy(true); const r = await pickStyle(url.trim()); setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không lấy được video.");
    setRes(r); setOff(new Set()); setEx(new Set(r.exemplarIds));
  };
  const toggle = (s: Set<string>, id: string, set: (v: Set<string>) => void) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); set(n); };
  const create = async () => {
    const videos = res.videos.filter((v: any) => !off.has(v.awemeId)); const exemplarIds = [...ex].filter((id) => !off.has(id));
    if (videos.length < minVideos) return showToast(`Cần ít nhất ${minVideos} video.`);
    setBusy(true); const r = await createStyle({ account: res.account, videos, exemplarIds }); setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không tạo được."); showToast(`Đã xếp ${r.count} video vào hàng đợi.`); onCreated(r.profileId);
  };
  const box = c("background:#fff;border:1px solid #ece4d6;border-radius:16px;padding:18px;margin-bottom:14px");
  return (
    <div>
      <div style={box}>
        <div style={c("font-weight:600;margin-bottom:8px")}>Link kênh TikTok / Douyin</div>
        <div style={c("display:flex;gap:8px;flex-wrap:wrap")}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@kenh hoặc douyin.com/user/…" style={c("flex:1;min-width:240px;padding:10px 12px;border:1px solid #ddd3c2;border-radius:10px;font-size:14px")} />
          <button disabled={busy} onClick={pick} style={c("padding:10px 16px;border-radius:10px;border:0;background:#b06a16;color:#fff;font-weight:600;cursor:pointer")}>{busy ? <><span style={{ ...c("display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;vertical-align:-1px;margin-right:6px"), animation: "ns-spin .8s linear infinite" }} />Đang lấy video…</> : "Lấy video"}</button>
          <button onClick={onCancel} style={c("padding:10px 14px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>Huỷ</button>
        </div>
        <div style={c("font-size:12px;color:#8a7c67;margin-top:8px")}>Hệ thống lấy 100 video gần nhất → chọn 30 view cao nhất trong 90 ngày (nới dần nếu thiếu) → 5 view cao nhất là mẫu chuẩn (được tách timeline từng cut). Bỏ tick video lạc style trước khi chạy — cần giữ ít nhất {minVideos} video để tổng hợp.</div>
      </div>
      {res && (
        <div style={box}>
          <div style={c("display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px")}>
            <div><b>@{res.account.handle}</b> · {res.account.nickname} · {res.fetched} video lấy về · {res.note}</div>
            <div style={c("display:flex;flex-direction:column;align-items:flex-end;gap:4px")}>
              <button disabled={busy || tooFew} onClick={create} style={{ ...c("padding:10px 16px;border-radius:10px;border:0;background:#3c7a5e;color:#fff;font-weight:600;cursor:pointer"), ...(tooFew ? c("opacity:0.5;cursor:not-allowed") : {}) }}>{busy ? <><span style={{ ...c("display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;vertical-align:-1px;margin-right:6px"), animation: "ns-spin .8s linear infinite" }} />Đang xếp hàng…</> : `Phân tích style (${selected} video)`}</button>
              {tooFew && <div style={c("font-size:12px;color:#9e3a3a")}>Cần ít nhất {minVideos} video (đang chọn {selected}).</div>}
            </div>
          </div>
          {res.windowDays > 90 && <div style={c("margin-top:8px;padding:8px 12px;background:#fff6e5;border-radius:10px;font-size:13px")}>⚠ Kênh không đủ 30 video trong 90 ngày — đã nới lên {res.windowDays} ngày; video cũ tính trọng số 0,5.</div>}
          <table style={c("width:100%;margin-top:12px;font-size:13px;border-collapse:collapse")}>
            <thead><tr style={c("text-align:left;color:#8a7c67")}><th>Dùng</th><th>Mẫu chuẩn</th><th>Video</th><th style={c("text-align:right")}>View</th><th>Ngày</th></tr></thead>
            <tbody>{res.videos.map((v: any) => (
              <tr key={v.awemeId} style={{ opacity: off.has(v.awemeId) ? 0.45 : 1, borderTop: "1px solid #f1eadf" }}>
                <td><input type="checkbox" checked={!off.has(v.awemeId)} onChange={() => toggle(off, v.awemeId, setOff)} /></td>
                <td><input type="checkbox" checked={ex.has(v.awemeId)} onChange={() => toggle(ex, v.awemeId, setEx)} /></td>
                <td><a href={v.link} target="_blank" rel="noreferrer" style={c("color:#574a3a")}>{v.title || v.link}</a></td>
                <td style={c("text-align:right")}>{fmtN(v.views)}</td>
                <td>{v.createTime ? new Date(v.createTime * 1000).toLocaleDateString("vi-VN") : ""}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
