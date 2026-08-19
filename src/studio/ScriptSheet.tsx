import { useEffect, useState } from "react";
import { css } from "../lib/csx";
import type { StudioBundle } from "./StudioView";
import { genStudioScript, saveStudioShots, requestStudioKeyframes, patchStudioProject, countSyllables } from "./studioApi";
import { PURPOSE_LABEL, CAMERA_LABEL, MOTION_LABEL } from "./studioLabels";

const card = css("background:#fff;border:1px solid #efe6d4;border-radius:16px;padding:18px;margin-bottom:16px");
const h = css("font-family:Fraunces,serif;font-size:18px;font-weight:600;color:#2a2016;margin-bottom:4px");
const inp = css("width:100%;padding:8px 10px;border:1px solid #e6dcc8;border-radius:8px;font-size:13px;color:#2a2016;background:#fff");
const sel = css("padding:6px 8px;border:1px solid #e6dcc8;border-radius:8px;font-size:12px;background:#fff;color:#2a2016");
const btnP = css("padding:10px 16px;border-radius:10px;border:0;background:#b06a16;color:#fff;font-weight:700;cursor:pointer");
const btnS = css("padding:10px 16px;border-radius:10px;border:1px solid #e6dcc8;background:#fff;color:#574a3a;cursor:pointer");
const empty = () => ({ purpose: "product", camera: "medium", dialog: "", image_prompt: "", motion_prompt: "", motion_level: "medium" });

export function ScriptSheet({ bundle, integration, showToast, reload }: { bundle: StudioBundle; integration: { key: string; model: string }; showToast: (m: string) => void; reload: () => Promise<any> }) {
  const { project: p, maxSyllables } = bundle;
  const [shots, setShots] = useState<any[]>(bundle.shots.length ? bundle.shots : [empty()]);
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState("");
  const [caption, setCaption] = useState(p.caption || "");
  const [hashtags, setHashtags] = useState(p.hashtags || "");
  const locked = ["clip", "assemble", "done"].includes(p.stage) || bundle.shots.some((s) => s.clip_status === "done");
  useEffect(() => { if (bundle.shots.length) setShots(bundle.shots); setCaption(p.caption || ""); setHashtags(p.hashtags || ""); }, [bundle.project.updated, bundle.shots.length]);

  const over = shots.map((s) => countSyllables(s.dialog) > maxSyllables);
  const upd = (i: number, k: string, v: any) => setShots((arr) => arr.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  const genAI = async () => {
    setBusy("ai");
    const r = await genStudioScript(p.id, { source: "ai", notes, count, apiKey: integration.key || undefined, model: integration.model || undefined });
    setBusy("");
    if (!r?.ok) return showToast(r?.message || "AI không viết được kịch bản.");
    setShots(r.shots); setCaption(r.caption || ""); setHashtags((r.hashtags || []).join(" ")); showToast("Đã có kịch bản — sửa tay rồi bấm Dựng ảnh khoá."); reload();
  };
  const save = async () => {
    if (over.some(Boolean)) return showToast(`Có cảnh vượt ${maxSyllables} âm tiết — rút gọn thoại trước.`);
    setBusy("save");
    const r = await saveStudioShots(p.id, shots.map((s) => ({ purpose: s.purpose, camera: s.camera, dialog: s.dialog, image_prompt: s.image_prompt, motion_prompt: s.motion_prompt, motion_level: s.motion_level })));
    await patchStudioProject(p.id, { caption, hashtags });
    setBusy("");
    if (!r?.ok) return showToast(r?.message || "Không lưu được.");
    await reload(); return true;
  };
  const keyframes = async () => {
    if (!(await save())) return;
    setBusy("kf");
    const r = await requestStudioKeyframes(p.id);
    setBusy("");
    if (!r?.ok) return showToast(r?.message || "Không xếp hàng được.");
    showToast(`Đang dựng ${r.count} ảnh khoá — theo dõi ở mục Chốt duyệt.`); reload();
  };

  return (
    <div style={card}>
      <div style={h}>1 · Phiếu kịch bản</div>
      <div style={css("font-size:12px;color:#8a7c67;margin-bottom:12px")}>Mỗi cảnh = 1 clip {p.clip_len}s. Thoại tối đa <b>{maxSyllables} âm tiết</b>/cảnh (nhịp giọng × thời lượng). Sửa tay được mọi ô.</div>
      {!locked && (
        <div style={css("display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px")}>
          <input style={css("flex:1;min-width:220px;padding:8px 10px;border:1px solid #e6dcc8;border-radius:8px;font-size:13px")} placeholder="Ghi chú cho AI (điểm bán, đối tượng, giọng điệu…)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <select style={sel} value={count} onChange={(e) => setCount(Number(e.target.value))}>{[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} cảnh</option>)}</select>
          <button style={btnP} disabled={!!busy} onClick={genAI}>{busy === "ai" ? "AI đang viết…" : "AI viết kịch bản từ ảnh"}</button>
          <button style={btnS} onClick={() => setShots((a) => [...a, empty()])}>+ Thêm cảnh</button>
        </div>
      )}
      <div style={css("display:grid;gap:10px")}>
        {shots.map((s, i) => (
          <div key={s.id || i} style={css(`border:1px solid ${over[i] ? "#e08a8a" : "#efe6d4"};border-radius:12px;padding:12px;background:${over[i] ? "#fff5f5" : "#fffdf8"}`)}>
            <div style={css("display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px")}>
              <b style={css("color:#2a2016")}>Cảnh {i + 1}</b>
              <select disabled={locked} style={sel} value={s.purpose} onChange={(e) => upd(i, "purpose", e.target.value)}>{Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select disabled={locked} style={sel} value={s.camera} onChange={(e) => upd(i, "camera", e.target.value)}>{Object.entries(CAMERA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select disabled={locked} style={sel} value={s.motion_level} onChange={(e) => upd(i, "motion_level", e.target.value)}>{Object.entries(MOTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <span style={css(`margin-left:auto;font-size:12px;font-weight:700;color:${over[i] ? "#c0392b" : "#3c7a5e"}`)}>{countSyllables(s.dialog)}/{maxSyllables} âm tiết</span>
              {!locked && shots.length > 1 && <button onClick={() => setShots((a) => a.filter((_, j) => j !== i))} style={css("border:0;background:transparent;color:#9e3a3a;cursor:pointer;font-size:12px")}>Xoá</button>}
            </div>
            <textarea disabled={locked} style={{ ...inp, minHeight: 44 }} placeholder="Lời đọc tiếng Việt…" value={s.dialog} onChange={(e) => upd(i, "dialog", e.target.value)} />
            <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px")}>
              <textarea disabled={locked} style={{ ...inp, minHeight: 56, fontSize: 12 }} placeholder="Image prompt (English) — khung hình tĩnh" value={s.image_prompt} onChange={(e) => upd(i, "image_prompt", e.target.value)} />
              <textarea disabled={locked} style={{ ...inp, minHeight: 56, fontSize: 12 }} placeholder="Motion prompt (English) — chuyển động từ khung đó" value={s.motion_prompt} onChange={(e) => upd(i, "motion_prompt", e.target.value)} />
            </div>
          </div>
        ))}
      </div>
      <div style={css("display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:12px")}>
        <input style={inp} placeholder="Caption đăng bài" value={caption} onChange={(e) => setCaption(e.target.value)} />
        <input style={inp} placeholder="#hashtag #cách #nhau" value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
      </div>
      {!locked && (
        <div style={css("display:flex;gap:8px;margin-top:14px")}>
          <button style={btnS} disabled={!!busy} onClick={save}>{busy === "save" ? "Đang lưu…" : "Lưu kịch bản"}</button>
          <button style={btnP} disabled={!!busy || shots.some((s) => !s.image_prompt.trim())} onClick={keyframes}>{busy === "kf" ? "Đang xếp hàng…" : `Dựng ${shots.length} ảnh khoá →`}</button>
        </div>
      )}
      {locked && <div style={css("font-size:12px;color:#8a7c67;margin-top:10px")}>Kịch bản đã khoá vì đã có clip. Muốn sửa: sinh lại ảnh khoá của cảnh đó ở mục Chốt duyệt.</div>}
    </div>
  );
}
