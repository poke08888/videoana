import { css as c } from "../lib/csx";
import { retryStyleFailed, aggregateStyle } from "./styleApi";

export function ProgressPanel({ bundle, showToast, reload }: { bundle: any; showToast: (m: string) => void; reload: () => void }) {
  const vids: any[] = bundle.videos; const done = vids.filter((v) => v.status === "done").length; const failed = vids.filter((v) => v.status === "failed");
  const p = bundle.profile;
  const busy = p.status === "picking" || p.status === "running" || p.status === "aggregating";
  const STATUS: Record<string, string> = { picking: "đang lấy danh sách video từ kênh", running: "đang phân tích từng video", aggregating: "đang tổng hợp 6 lớp + viết skill (thường 1–2 phút)", done: "hoàn tất", failed: "thất bại" };
  const Spinner = () => <span aria-label="đang chạy" style={{ ...c("display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid #e3d9c8;border-top-color:#b06a16;vertical-align:-2px;margin-right:6px"), animation: "ns-spin .8s linear infinite" }} />;
  return (
    <div style={c("background:#fff;border:1px solid #ece4d6;border-radius:16px;padding:18px;margin-bottom:14px")}>
      <div style={c("display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px")}>
        <div>{busy && <Spinner />}<b>{done}/{vids.length}</b> video đã phân tích · {failed.length} lỗi · <b>{STATUS[p.status] || p.status}</b>{p.message ? ` — ${p.message}` : ""}</div>
        <div style={c("display:flex;gap:8px")}>
          {failed.length > 0 && <button onClick={async () => { const r = await retryStyleFailed(p.id); showToast(r?.ok ? `Đã đẩy lại ${r.requeued} video.` : r?.message || "Lỗi"); reload(); }} style={c("padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>Chạy lại video lỗi</button>}
          {(p.status === "failed" || p.status === "done") && done > 0 && <button onClick={async () => { const r = await aggregateStyle(p.id); showToast(r?.ok ? (r.started ? "Đang tổng hợp lại…" : "Đã tổng hợp lại.") : r?.message || "Lỗi"); reload(); }} style={c("padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>Tổng hợp lại</button>}
        </div>
      </div>
      <div style={c("height:8px;background:#f1eadf;border-radius:6px;margin-top:10px;overflow:hidden")}><div style={{ ...c("height:100%;background:#3c7a5e;transition:width .4s"), width: `${vids.length ? (done / vids.length) * 100 : 0}%`, ...(p.status === "aggregating" ? { backgroundImage: "linear-gradient(90deg,#3c7a5e 0%,#6fae8f 50%,#3c7a5e 100%)", backgroundSize: "200% 100%", animation: "ns-bar 1.2s linear infinite" } : {}) }} /></div>
      {busy && <div style={c("font-size:12px;color:#8a7c67;margin-top:6px")}>Trang tự cập nhật mỗi 5 giây — không cần tải lại.</div>}
      {failed.length > 0 && <ul style={c("margin:10px 0 0;padding-left:18px;font-size:13px;color:#9e3a3a")}>{failed.map((v) => <li key={v.id}><a href={v.link} target="_blank" rel="noreferrer">{v.title || v.link}</a>: {v.error}</li>)}</ul>}
    </div>
  );
}
