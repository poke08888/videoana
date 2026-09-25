import { css as c } from "../lib/csx";
import { retryStyleFailed, aggregateStyle } from "./styleApi";

export function ProgressPanel({ bundle, showToast, reload }: { bundle: any; showToast: (m: string) => void; reload: () => void }) {
  const vids: any[] = bundle.videos; const done = vids.filter((v) => v.status === "done").length; const failed = vids.filter((v) => v.status === "failed");
  const p = bundle.profile;
  return (
    <div style={c("background:#fff;border:1px solid #ece4d6;border-radius:16px;padding:18px;margin-bottom:14px")}>
      <div style={c("display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px")}>
        <div><b>{done}/{vids.length}</b> video đã phân tích · {failed.length} lỗi · trạng thái: <b>{p.status}</b>{p.message ? ` — ${p.message}` : ""}</div>
        <div style={c("display:flex;gap:8px")}>
          {failed.length > 0 && <button onClick={async () => { const r = await retryStyleFailed(p.id); showToast(r?.ok ? `Đã đẩy lại ${r.requeued} video.` : r?.message || "Lỗi"); reload(); }} style={c("padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>Chạy lại video lỗi</button>}
          {(p.status === "failed" || p.status === "done") && done > 0 && <button onClick={async () => { const r = await aggregateStyle(p.id); showToast(r?.ok ? (r.started ? "Đang tổng hợp lại…" : "Đã tổng hợp lại.") : r?.message || "Lỗi"); reload(); }} style={c("padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>Tổng hợp lại</button>}
        </div>
      </div>
      <div style={c("height:8px;background:#f1eadf;border-radius:6px;margin-top:10px;overflow:hidden")}><div style={{ ...c("height:100%;background:#3c7a5e"), width: `${vids.length ? (done / vids.length) * 100 : 0}%` }} /></div>
      {failed.length > 0 && <ul style={c("margin:10px 0 0;padding-left:18px;font-size:13px;color:#9e3a3a")}>{failed.map((v) => <li key={v.id}><a href={v.link} target="_blank" rel="noreferrer">{v.title || v.link}</a>: {v.error}</li>)}</ul>}
    </div>
  );
}
