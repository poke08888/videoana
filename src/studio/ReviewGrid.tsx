import { useState } from "react";
import { css } from "../lib/csx";
import type { StudioBundle } from "./StudioView";
import { approveStudioShot, regenerateStudioShot, requestStudioClips, studioFileUrl } from "./studioApi";
import { PURPOSE_LABEL, STATUS_LABEL } from "./studioLabels";

const card = css("background:#fff;border:1px solid #efe6d4;border-radius:16px;padding:18px;margin-bottom:16px");
const h = css("font-family:Fraunces,serif;font-size:18px;font-weight:600;color:#2a2016;margin-bottom:4px");
const small = css("font-size:11px;padding:5px 9px;border-radius:8px;border:1px solid #e6dcc8;background:#fff;cursor:pointer;color:#574a3a");

export function ReviewGrid({ bundle, showToast, reload }: { bundle: StudioBundle; showToast: (m: string) => void; reload: () => Promise<any> }) {
  const { project: p, shots } = bundle;
  const [editing, setEditing] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const withImage = shots.filter((s) => s.image_status !== "idle");
  if (!withImage.length) return null;
  const approved = shots.filter((s) => s.approved === 1 && s.image_status === "done");
  const rendering = shots.some((s) => ["pending", "processing"].includes(s.clip_status));

  const toggle = async (s: any) => { await approveStudioShot(s.id, s.approved ? 0 : 1); reload(); };
  const regen = async (s: any) => { setBusy(true); const r = await regenerateStudioShot(s.id, editing === s.id ? prompt : undefined); setBusy(false); setEditing(null); if (!r?.ok) showToast(r?.message || "Lỗi"); reload(); };
  const clips = async (tier: "draft" | "final") => {
    if (!confirm(`Render ${approved.length} cảnh hạng ${tier === "final" ? "CHỐT (đắt)" : "nháp"}?`)) return;
    setBusy(true); const r = await requestStudioClips(p.id, tier); setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không render được.");
    showToast(`Đã xếp hàng ${r.count} clip.`); reload();
  };

  return (
    <div style={card}>
      <div style={h}>2 · Chốt duyệt ảnh khoá</div>
      <div style={css("font-size:12px;color:#8a7c67;margin-bottom:12px")}>Chỉ ảnh <b>được duyệt</b> mới đi render clip (mất tiền). Ảnh xấu: sinh lại (rẻ) trước, đừng render.</div>
      <div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px")}>
        {withImage.map((s) => (
          <div key={s.id} style={css(`border:2px solid ${s.approved ? "#3c7a5e" : "#efe6d4"};border-radius:12px;overflow:hidden;background:#fffdf8`)}>
            <div style={css("aspect-ratio:9/16;background:#f3ede0;display:flex;align-items:center;justify-content:center;position:relative")}>
              {s.image_status === "done" && s.image_rel ? <img src={studioFileUrl(p.id, s.image_rel)} style={css("width:100%;height:100%;object-fit:cover")} /> : <span style={css("font-size:12px;color:#8a7c67")}>{STATUS_LABEL[s.image_status]}{s.image_status === "processing" ? "…" : ""}</span>}
              {s.approved === 1 && <span style={css("position:absolute;top:6px;right:6px;background:#3c7a5e;color:#fff;border-radius:999px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px")}>✓</span>}
              {s.clip_status !== "idle" && <span style={css(`position:absolute;bottom:6px;left:6px;font-size:10px;padding:2px 6px;border-radius:6px;background:${s.clip_status === "done" ? "#3c7a5e" : s.clip_status === "failed" ? "#9e3a3a" : "#b06a16"};color:#fff`)}>Clip: {STATUS_LABEL[s.clip_status]}</span>}
            </div>
            <div style={css("padding:8px")}>
              <div style={css("font-size:12px;font-weight:700;color:#2a2016")}>Cảnh {s.idx + 1} · {PURPOSE_LABEL[s.purpose] || s.purpose}</div>
              {s.error && <div style={css("font-size:10px;color:#9e3a3a;margin-top:2px")}>{s.error.slice(0, 120)}</div>}
              <div style={css("display:flex;gap:4px;flex-wrap:wrap;margin-top:6px")}>
                {s.image_status === "done" && <button style={{ ...small, ...(s.approved ? css("background:#3c7a5e;color:#fff;border-color:#3c7a5e") : {}) }} onClick={() => toggle(s)}>{s.approved ? "Đã duyệt" : "Duyệt"}</button>}
                {["done", "failed"].includes(s.image_status) && <button style={small} disabled={busy} onClick={() => regen(s)}>Sinh lại</button>}
                {["done", "failed"].includes(s.image_status) && <button style={small} onClick={() => { setEditing(editing === s.id ? null : s.id); setPrompt(s.image_prompt); }}>Sửa prompt</button>}
                {s.clip_status === "done" && s.clip_rel && <a style={{ ...small, textDecoration: "none" }} href={studioFileUrl(p.id, s.clip_rel)} target="_blank">Xem clip</a>}
              </div>
              {editing === s.id && (<div style={css("margin-top:6px")}><textarea style={css("width:100%;font-size:11px;min-height:60px;border:1px solid #e6dcc8;border-radius:8px;padding:6px")} value={prompt} onChange={(e) => setPrompt(e.target.value)} /><button style={small} disabled={busy} onClick={() => regen(s)}>Sinh lại với prompt này</button></div>)}
            </div>
          </div>
        ))}
      </div>
      <div style={css("display:flex;gap:8px;align-items:center;margin-top:14px;flex-wrap:wrap")}>
        <span style={css("font-size:13px;color:#574a3a")}>Đã duyệt <b>{approved.length}</b>/{withImage.length}</span>
        <button disabled={!approved.length || busy || rendering} style={css(`padding:10px 16px;border-radius:10px;border:0;background:${approved.length && !rendering ? "#b06a16" : "#d9cdb5"};color:#fff;font-weight:700;cursor:pointer`)} onClick={() => clips("draft")}>Render nháp (rẻ)</button>
        <button disabled={!approved.length || busy || rendering} style={css(`padding:10px 16px;border-radius:10px;border:1px solid #b06a16;background:#fff;color:${approved.length && !rendering ? "#9a5a12" : "#c9b899"};font-weight:700;cursor:pointer`)} onClick={() => clips("final")}>Render chốt (đẹp)</button>
        {rendering && <span style={css("font-size:12px;color:#8a7c67")}>Đang render… trang tự cập nhật.</span>}
      </div>
    </div>
  );
}
