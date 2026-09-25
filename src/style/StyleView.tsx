import { useEffect, useRef, useState } from "react";
import { css as c } from "../lib/csx";
import { listStyleProfiles, getStyleProfile, deleteStyleProfile, startStyle } from "./styleApi";
import { ProgressPanel } from "./ProgressPanel";
import { ProfileView } from "./ProfileView";

const ACTIVE = ["picking", "running", "aggregating"];
const statusLabel = (p: any) => ({ picking: "đang lấy danh sách video", running: `đang phân tích ${p.done || 0}/${p.total || 0}`, aggregating: "đang tổng hợp", done: "hoàn tất", failed: "thất bại" } as Record<string, string>)[p.status] || p.status;
const Spin = ({ light }: { light?: boolean }) => <span style={{ ...c(`display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid ${light ? "rgba(255,255,255,.45)" : "#e3d9c8"};border-top-color:${light ? "#fff" : "#b06a16"};vertical-align:-1px;margin-right:6px`), animation: "ns-spin .8s linear infinite" }} />;
const btn = c("padding:6px 10px;border-radius:8px;border:1px solid #ddd3c2;background:#fff;cursor:pointer;font-size:12px");
const errBox = c("background:#fff6f4;border:1px solid #efd2cb;border-radius:14px;padding:14px 16px;margin-bottom:10px;color:#9e3a3a;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap");

/** Thanh nhập duy nhất: dán link → server nhận ngay, xoá ô để dán kênh tiếp (chạy song song nhiều kênh). */
function StartBar({ showToast, onStarted }: { showToast: (m: string) => void; onStarted: () => void }) {
  const [url, setUrl] = useState(""); const [sending, setSending] = useState(false);
  const submit = async () => {
    const u = url.trim(); if (!u) return showToast("Nhập link kênh trước.");
    setSending(true); const r = await startStyle(u); setSending(false);
    if (!r?.ok) return showToast(r?.message || "Không nhận được kênh.");
    // Chỉ xoá nếu người dùng chưa gõ link khác trong lúc chờ.
    setUrl((cur) => (cur.trim() === u ? "" : cur)); showToast(`Đã nhận kênh @${r.handle} — đang lấy video…`); onStarted();
  };
  return (
    <div style={c("background:#fff;border:1px solid #ece4d6;border-radius:16px;padding:14px 16px;margin-bottom:12px")}>
      <div style={c("display:flex;gap:8px;flex-wrap:wrap")}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !sending) submit(); }} placeholder="https://www.tiktok.com/@kenh hoặc douyin.com/user/…" style={c("flex:1;min-width:0;width:100%;max-width:100%;padding:10px 12px;border:1px solid #ddd3c2;border-radius:10px;font-size:14px;box-sizing:border-box;flex-basis:240px")} />
        <button disabled={sending} onClick={submit} style={c("padding:10px 16px;border-radius:10px;border:0;background:#b06a16;color:#fff;font-weight:600;cursor:pointer")}>{sending ? <><Spin light />Đang gửi…</> : "Phân tích kênh"}</button>
      </div>
      <div style={c("font-size:12px;color:#8a7c67;margin-top:8px")}>Hệ thống tự lấy 100 video gần nhất → 30 view cao nhất trong 90 ngày (nới dần nếu thiếu) → 5 video cao nhất là mẫu chuẩn. Dán kênh tiếp theo ngay, không cần chờ.</div>
    </div>
  );
}

export function StyleView({ isMobile, showToast }: { isMobile: boolean; integration: { key: string; model: string }; showToast: (m: string) => void; isAdmin?: boolean }) {
  const [mode, setMode] = useState<"list" | "profile">("list");
  const [profiles, setProfiles] = useState<any[]>([]);
  // Trạng thái danh sách tường minh: chỉ hiện "Chưa có profile nào." khi API trả ok + mảng rỗng.
  const [listState, setListState] = useState<{ kind: "loading" | "ok" | "error"; message?: string }>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null); const [bundle, setBundle] = useState<any>(null); const [loadErr, setLoadErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null); const listTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const retried = useRef(false); const retryT = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** silent = poll nền: lỗi tạm thời không xoá danh sách đang hiện (lần poll sau thử lại). */
  const reloadList = async (silent = false) => {
    if (!silent) setListState((s) => (s.kind === "ok" ? s : { kind: "loading" }));
    const r = await listStyleProfiles();
    if (r?.ok) { setProfiles(r.profiles || []); setListState({ kind: "ok" }); retried.current = false; return; }
    if (silent) return;
    setListState({ kind: "error", message: r?.message || "Lỗi không rõ." });
    // Tự thử lại 1 lần sau 3 s (vd. container khởi động lại ~10 s khi deploy).
    if (!retried.current) { retried.current = true; if (retryT.current) clearTimeout(retryT.current); retryT.current = setTimeout(() => reloadList(), 3000); }
  };
  const load = async (id: string) => {
    const r = await getStyleProfile(id);
    if (r?.ok) { setBundle(r); setLoadErr(null); } else setLoadErr(r?.message || "Không tải được profile.");
  };
  useEffect(() => { reloadList(); return () => { if (retryT.current) clearTimeout(retryT.current); }; }, []);
  // Poll danh sách 5 s khi còn profile đang chạy; dừng khi không còn.
  const anyActive = profiles.some((p) => ACTIVE.includes(p.status));
  useEffect(() => {
    if (listTimer.current) clearInterval(listTimer.current);
    if (mode !== "list" || !anyActive) return;
    listTimer.current = setInterval(() => reloadList(true), 5000);
    return () => { if (listTimer.current) clearInterval(listTimer.current); };
  }, [mode, anyActive]);
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (mode !== "profile" || !bundle) return;
    if (!ACTIVE.includes(bundle.profile.status)) return;
    timer.current = setInterval(() => load(bundle.profile.id), 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [mode, bundle?.profile?.id, bundle?.profile?.status]);
  const open = async (id: string) => { setOpenId(id); setBundle(null); setLoadErr(null); setMode("profile"); await load(id); };
  const back = () => { setMode("list"); setOpenId(null); setBundle(null); setLoadErr(null); reloadList(); };
  const rerun = async (p: any) => {
    const r = await startStyle(p.source_url);
    if (!r?.ok) return showToast(r?.message || "Không chạy lại được.");
    // Dòng cũ chỉ là vỏ lỗi chưa có video (total 0) → xoá cho gọn, không mất dữ liệu.
    await deleteStyleProfile(p.id);
    showToast(`Đã nhận kênh @${r.handle} — đang lấy video…`); reloadList();
  };

  if (mode === "profile") return (
    <div>
      <button onClick={back} style={c("margin-bottom:12px;padding:8px 12px;border-radius:10px;border:1px solid #ddd3c2;background:#fff;cursor:pointer")}>← Danh sách</button>
      {loadErr && <div style={errBox}><span>Không tải được profile: {loadErr}</span><button onClick={() => openId && load(openId)} style={btn}>Thử lại</button></div>}
      {!bundle && !loadErr && <div style={c("color:#8a7c67;padding:12px")}><Spin />Đang tải…</div>}
      {bundle && <ProgressPanel bundle={bundle} showToast={showToast} reload={() => load(bundle.profile.id)} />}
      {bundle?.profile.status === "done" && <ProfileView bundle={bundle} isMobile={isMobile} />}
    </div>);
  return (
    <div>
      <div style={c("color:#8a7c67;font-size:13px;margin-bottom:10px")}>Mỗi kênh → 1 Style Profile → 1 skill .zip cho AI dựng clip cùng phong cách.</div>
      <StartBar showToast={showToast} onStarted={() => reloadList()} />
      {listState.kind === "loading" && profiles.length === 0 && <div style={c("color:#8a7c67;padding:12px")}><Spin />Đang tải danh sách…</div>}
      {listState.kind === "error" && <div style={errBox}><span>Không tải được danh sách: {listState.message}</span><button onClick={() => { retried.current = false; reloadList(); }} style={btn}>Thử lại</button></div>}
      {listState.kind === "ok" && profiles.length === 0 && <div style={c("background:#fff;border:1px dashed #ddd3c2;border-radius:16px;padding:28px;text-align:center;color:#8a7c67")}>Chưa có profile nào.</div>}
      {profiles.map((p) => (
        <div key={p.id} onClick={() => open(p.id)} style={c("background:#fff;border:1px solid #ece4d6;border-radius:14px;padding:14px 16px;margin-bottom:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap")}>
          <div style={c("min-width:0")}>{ACTIVE.includes(p.status) && <span style={{ ...c("display:inline-block;width:8px;height:8px;border-radius:50%;background:#b06a16;margin-right:8px"), animation: "ns-fade 1s ease-in-out infinite alternate" }} />}<b>@{p.handle}</b> · {p.nickname} · {p.platform}
            <div style={c("font-size:12px;color:#8a7c67")}>{p.status === "picking" ? "" : `${p.done || 0}/${p.total || 0} video · ${p.failed || 0} lỗi · `}<b style={c(p.status === "failed" ? "color:#9e3a3a" : "")}>{statusLabel(p)}</b> · {new Date(p.created_at).toLocaleString("vi-VN")}{p.owner ? ` · ${p.owner}` : ""}</div>
            {p.status === "failed" && p.message && <div style={c("font-size:12px;color:#9e3a3a;margin-top:2px;overflow-wrap:anywhere")}>{p.message}</div>}
          </div>
          <div style={c("display:flex;gap:6px")}>
            {p.status === "failed" && p.source_url && Number(p.total) === 0 && <button onClick={(e) => { e.stopPropagation(); rerun(p); }} style={btn}>Chạy lại</button>}
            <button onClick={async (e) => { e.stopPropagation(); if (!confirm(`Xoá profile @${p.handle}?`)) return; const r = await deleteStyleProfile(p.id); showToast(r?.ok ? "Đã xoá." : r?.message || "Lỗi"); reloadList(); }} style={btn}>Xoá</button>
          </div>
        </div>))}
    </div>
  );
}
