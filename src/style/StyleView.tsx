import { useEffect, useRef, useState } from "react";
import { css as c } from "../lib/csx";
import { listStyleProfiles, getStyleProfile, deleteStyleProfile, fmtN } from "./styleApi";
import { PickForm } from "./PickForm";
import { ProgressPanel } from "./ProgressPanel";
import { ProfileView } from "./ProfileView";

export function StyleView({ isMobile, showToast }: { isMobile: boolean; integration: { key: string; model: string }; showToast: (m: string) => void; isAdmin?: boolean }) {
  const [mode, setMode] = useState<"list" | "new" | "profile">("list");
  const [profiles, setProfiles] = useState<any[]>([]); const [bundle, setBundle] = useState<any>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reloadList = async () => { const r = await listStyleProfiles(); if (r?.ok) setProfiles(r.profiles); };
  const load = async (id: string) => { const r = await getStyleProfile(id); if (r?.ok) setBundle(r); else showToast(r?.message || "Không tải được profile."); };
  useEffect(() => { reloadList(); }, []);
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (mode !== "profile" || !bundle) return;
    const busy = ["running", "aggregating"].includes(bundle.profile.status);
    if (!busy) return;
    timer.current = setInterval(() => load(bundle.profile.id), 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [mode, bundle?.profile?.id, bundle?.profile?.status]);
  const open = async (id: string) => { await load(id); setMode("profile"); };

  if (mode === "new") return <PickForm showToast={showToast} onCancel={() => setMode("list")} onCreated={(id) => { reloadList(); open(id); }} />;
  if (mode === "profile" && bundle) return (
    <div>
      <button onClick={() => { setMode("list"); reloadList(); }} style={c("margin-bottom:12px;padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>← Danh sách</button>
      <ProgressPanel bundle={bundle} showToast={showToast} reload={() => load(bundle.profile.id)} />
      {bundle.profile.status === "done" && <ProfileView bundle={bundle} isMobile={isMobile} />}
    </div>);
  return (
    <div>
      <div style={c("display:flex;justify-content:space-between;align-items:center;margin-bottom:12px")}>
        <div style={c("color:#8a7c67;font-size:13px")}>Mỗi kênh → 1 Style Profile → 1 skill .zip cho AI dựng clip cùng phong cách.</div>
        <button onClick={() => setMode("new")} style={c("padding:10px 16px;border-radius:10px;border:0;background:#b06a16;color:#fff;font-weight:600;cursor:pointer")}>＋ Phân tích kênh mới</button>
      </div>
      {profiles.length === 0 && <div style={c("background:#fff;border:1px dashed #ddd3c2;border-radius:16px;padding:28px;text-align:center;color:#8a7c67")}>Chưa có profile nào.</div>}
      {profiles.map((p) => (
        <div key={p.id} onClick={() => open(p.id)} style={c("background:#fff;border:1px solid #ece4d6;border-radius:14px;padding:14px 16px;margin-bottom:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap")}>
          <div><b>@{p.handle}</b> · {p.nickname} · {p.platform}<div style={c("font-size:12px;color:#8a7c67")}>{p.done}/{p.total} video · {p.failed} lỗi · {p.status} · {new Date(p.created_at).toLocaleString("vi-VN")}{p.owner ? ` · ${p.owner}` : ""}</div></div>
          <button onClick={async (e) => { e.stopPropagation(); if (!confirm(`Xoá profile @${p.handle}?`)) return; const r = await deleteStyleProfile(p.id); showToast(r?.ok ? "Đã xoá." : r?.message || "Lỗi"); reloadList(); }} style={c("padding:6px 10px;border-radius:8px;border:1px solid #ddd3c2;background:#fff;cursor:pointer;font-size:12px")}>Xoá</button>
        </div>))}
    </div>
  );
}
