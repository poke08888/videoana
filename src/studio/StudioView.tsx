import { useEffect, useRef, useState } from "react";
import { css } from "../lib/csx";
import { listStudioProjects, getStudioProject, deleteStudioProject, getStudioHealth } from "./studioApi";
import { STAGE_LABEL, vnd } from "./studioLabels";
import { NewProjectForm } from "./NewProjectForm";
import { ScriptSheet } from "./ScriptSheet";
import { ReviewGrid } from "./ReviewGrid";
import { RenderPanel } from "./RenderPanel";

export interface StudioBundle { project: any; shots: any[]; assets: any[]; render: any | null; maxSyllables: number }
const BUSY = new Set(["keyframe", "clip", "assemble"]);

export function StudioView({ isMobile, integration, showToast, isAdmin }: { isMobile: boolean; integration: { key: string; model: string }; showToast: (m: string) => void; isAdmin?: boolean }) {
  const [mode, setMode] = useState<"list" | "new" | "project">("list");
  const [projects, setProjects] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [bundle, setBundle] = useState<StudioBundle | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reloadList = async () => { const r = await listStudioProjects(); if (r?.ok) setProjects(r.projects); };
  const load = async (id: string) => { const r = await getStudioProject(id); if (r?.ok) setBundle(r); else showToast(r?.message || "Không tải được dự án."); return r; };
  useEffect(() => { reloadList(); getStudioHealth().then((h) => h?.ok && setHealth(h)); }, []);

  // Poll khi có việc chạy nền (ảnh/clip/ghép) hoặc còn shot pending/processing.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (mode !== "project" || !bundle) return;
    const busy = BUSY.has(bundle.project.stage) || bundle.shots.some((s) => ["pending", "processing"].includes(s.image_status) || ["pending", "processing"].includes(s.clip_status)) || bundle.project.assemble_status === "pending" || bundle.project.assemble_status === "processing";
    if (!busy) return;
    timer.current = setInterval(() => load(bundle.project.id), 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [mode, bundle?.project?.id, bundle?.project?.stage, bundle?.project?.assemble_status, JSON.stringify(bundle?.shots?.map((s) => [s.image_status, s.clip_status]))]);

  const open = async (id: string) => { await load(id); setMode("project"); };

  if (mode === "new") return <NewProjectForm showToast={showToast} onCancel={() => setMode("list")} onCreated={(id) => { reloadList(); open(id); }} />;

  if (mode === "project" && bundle) {
    const p = bundle.project;
    return (
      <div>
        <div style={css("display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap")}>
          <button onClick={() => { setMode("list"); reloadList(); }} style={css("border:1px solid #e6dcc8;background:#fff;border-radius:10px;padding:8px 12px;cursor:pointer;color:#574a3a")}>← Danh sách</button>
          <div style={css("font-family:Fraunces,serif;font-size:20px;font-weight:600;color:#2a2016")}>{p.name}</div>
          <span style={css("font-size:12px;padding:4px 10px;border-radius:999px;background:#fff3e0;color:#9a5a12;font-weight:600")}>{STAGE_LABEL[p.stage] || p.stage}</span>
          <span style={css("font-size:12px;color:#8a7c67")}>Đã tiêu ${Number(p.cost_usd || 0).toFixed(3)} ≈ {vnd(p.cost_usd || 0)}</span>
          {p.message && <span style={css("font-size:12px;color:#9e3a3a")}>{p.message}</span>}
        </div>
        <ScriptSheet bundle={bundle} integration={integration} showToast={showToast} reload={() => load(p.id)} />
        <ReviewGrid bundle={bundle} showToast={showToast} reload={() => load(p.id)} />
        <RenderPanel bundle={bundle} health={health} showToast={showToast} reload={() => load(p.id)} />
      </div>
    );
  }

  return (
    <div>
      <div style={css("display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px")}>
        <div style={css("color:#8a7c67;font-size:13px")}>
          {health ? <>Engine: ảnh <b>{health.engines.image}</b> · video <b>{health.engines.video}</b> · giọng <b>{health.engines.voice}</b> · hôm nay ${Number(health.spendTodayUsd).toFixed(2)}/{health.budgetUsd} · đĩa {(health.diskBytes / 1e9).toFixed(1)}GB{health.queue?.pausedUntil > Date.now() ? <span style={css("color:#9e3a3a")}> · HÀNG ĐỢI TẠM DỪNG: {health.queue.pauseReason}</span> : null}</> : "…"}
        </div>
        <button onClick={() => setMode("new")} style={css("padding:10px 16px;border-radius:12px;border:0;background:#b06a16;color:#fff;font-weight:700;cursor:pointer")}>+ Dự án mới</button>
      </div>
      {projects.length === 0 && <div style={css("color:#8a7c67;padding:30px;text-align:center;border:1px dashed #e6dcc8;border-radius:16px")}>Chưa có dự án. Bấm “+ Dự án mới”, cho ảnh sản phẩm vào là xong.</div>}
      <div style={css(`display:grid;grid-template-columns:repeat(${isMobile ? 1 : 3},1fr);gap:12px`)}>
        {projects.map((p) => (
          <div key={p.id} style={css("background:#fff;border:1px solid #efe6d4;border-radius:14px;padding:14px;cursor:pointer")} onClick={() => open(p.id)}>
            <div style={css("font-weight:700;color:#2a2016")}>{p.name}</div>
            <div style={css("font-size:12px;color:#8a7c67;margin-top:4px")}>{STAGE_LABEL[p.stage] || p.stage} · {p.clip_len}s/cảnh · {p.tier === "final" ? "Chốt" : "Nháp"} · ${Number(p.cost_usd || 0).toFixed(2)}</div>
            <div style={css("font-size:11px;color:#b3a48c;margin-top:6px")}>{new Date(p.created).toLocaleString("vi-VN")}{isAdmin ? ` · ${p.owner}` : ""}</div>
            <button onClick={async (e) => { e.stopPropagation(); if (confirm("Xoá dự án và toàn bộ file?")) { await deleteStudioProject(p.id); reloadList(); } }} style={css("margin-top:8px;font-size:11px;border:0;background:transparent;color:#9e3a3a;cursor:pointer;padding:0")}>Xoá</button>
          </div>
        ))}
      </div>
    </div>
  );
}
