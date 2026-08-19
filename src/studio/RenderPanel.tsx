import { useEffect, useState } from "react";
import { css } from "../lib/csx";
import type { StudioBundle } from "./StudioView";
import { requestStudioAssemble, getStudioEstimate, listStudioMusic, studioFileUrl } from "./studioApi";
import { TRANSITION_LABEL, vnd } from "./studioLabels";

const card = css("background:#fff;border:1px solid #efe6d4;border-radius:16px;padding:18px;margin-bottom:16px");
const h = css("font-family:Fraunces,serif;font-size:18px;font-weight:600;color:#2a2016;margin-bottom:4px");
const sel = css("padding:8px 10px;border:1px solid #e6dcc8;border-radius:8px;font-size:13px;background:#fff;color:#2a2016");

export function RenderPanel({ bundle, health, showToast, reload }: { bundle: StudioBundle; health: any; showToast: (m: string) => void; reload: () => Promise<any> }) {
  const { project: p, shots, render } = bundle;
  const approved = shots.filter((s) => s.approved === 1);
  const ready = approved.length > 0 && approved.every((s) => s.clip_status === "done");
  const [voice, setVoice] = useState(p.voice || health?.voiceDefault || "");
  const [rate, setRate] = useState(Number(p.voice_rate || 1));
  const [music, setMusic] = useState<string>(p.music || "");
  const [musics, setMusics] = useState<string[]>([]);
  const [transition, setTransition] = useState(p.transition || "fade");
  const [est, setEst] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listStudioMusic().then((r) => r?.ok && setMusics(r.files)); }, []);
  useEffect(() => { getStudioEstimate(p.id, p.tier).then((r) => r?.ok && setEst(r)); }, [p.id, p.tier, approved.length]);
  useEffect(() => { if (!voice && health?.voiceDefault) setVoice(health.voiceDefault); }, [health?.voiceDefault]);
  if (!approved.length && !render) return null;
  const assembling = p.assemble_status === "pending" || p.assemble_status === "processing";

  const go = async () => {
    setBusy(true); const r = await requestStudioAssemble(p.id, { voice, voiceRate: rate, music: music || null, transition }); setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không ghép được."); showToast("Đang ghép — vài chục giây."); reload();
  };
  const copy = (t: string) => { navigator.clipboard?.writeText(t); showToast("Đã copy."); };

  return (
    <div style={card}>
      <div style={h}>3 · Bản dựng</div>
      {est && <div style={css("font-size:12px;color:#8a7c67;margin-bottom:10px")}>Ước tính hạng {p.tier === "final" ? "chốt" : "nháp"}: ảnh ${est.estimate.imagesUsd} + clip ${est.estimate.clipsUsd} + giọng ${est.estimate.voiceUsd} = <b>${est.estimate.totalUsd}</b> ≈ {vnd(est.estimate.totalUsd)} · <b>Đã tiêu thật ${Number(est.spentUsd).toFixed(3)}</b></div>}
      <div style={css("display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
        <select style={sel} value={voice} onChange={(e) => setVoice(e.target.value)}>{(health?.voices || []).map((v: any) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
        <label style={css("font-size:12px;color:#574a3a")}>Tốc độ <input type="range" min={0.8} max={1.4} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} /> {rate.toFixed(2)}×</label>
        <select style={sel} value={music} onChange={(e) => setMusic(e.target.value)}><option value="">Không nhạc nền</option>{musics.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        <select style={sel} value={transition} onChange={(e) => setTransition(e.target.value)}>{Object.entries(TRANSITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button disabled={!ready || busy || assembling} style={css(`padding:10px 16px;border-radius:10px;border:0;background:${ready && !assembling ? "#3c7a5e" : "#d9cdb5"};color:#fff;font-weight:700;cursor:pointer`)} onClick={go}>{assembling ? "Đang ghép…" : render ? "Ghép lại" : "Ghép video hoàn chỉnh"}</button>
      </div>
      {!ready && !render && <div style={css("font-size:12px;color:#8a7c67;margin-top:8px")}>Chờ đủ clip của các cảnh đã duyệt.</div>}
      {render && (
        <div style={css("display:grid;grid-template-columns:260px 1fr;gap:16px;margin-top:16px;align-items:start")}>
          <video controls src={studioFileUrl(p.id, render.mp4_rel)} style={css("width:260px;aspect-ratio:9/16;border-radius:12px;background:#000")} />
          <div>
            <div style={css("font-size:13px;color:#2a2016")}>Thời lượng {Number(render.duration).toFixed(1)}s · giọng {render.voice}{render.music ? ` · nhạc ${render.music}` : ""}</div>
            <div style={css("display:flex;gap:8px;margin-top:8px;flex-wrap:wrap")}>
              <a href={studioFileUrl(p.id, render.mp4_rel)} download style={css("padding:8px 12px;border-radius:8px;background:#b06a16;color:#fff;text-decoration:none;font-size:13px;font-weight:700")}>Tải mp4</a>
              {render.cover_rel && <a href={studioFileUrl(p.id, render.cover_rel)} download style={css("padding:8px 12px;border-radius:8px;border:1px solid #e6dcc8;color:#574a3a;text-decoration:none;font-size:13px")}>Tải ảnh bìa</a>}
              {render.srt_rel && <a href={studioFileUrl(p.id, render.srt_rel)} download style={css("padding:8px 12px;border-radius:8px;border:1px solid #e6dcc8;color:#574a3a;text-decoration:none;font-size:13px")}>Tải .srt</a>}
            </div>
            <div style={css("margin-top:12px;font-size:12px;color:#8a7c67")}>Caption</div>
            <div style={css("background:#fffdf8;border:1px solid #efe6d4;border-radius:8px;padding:8px;font-size:13px;color:#2a2016;white-space:pre-wrap")}>{render.caption || "—"}</div>
            <div style={css("margin-top:8px;font-size:12px;color:#8a7c67")}>Hashtag</div>
            <div style={css("background:#fffdf8;border:1px solid #efe6d4;border-radius:8px;padding:8px;font-size:13px;color:#2a2016")}>{render.hashtags || "—"}</div>
            <button style={css("margin-top:8px;padding:8px 12px;border-radius:8px;border:1px solid #e6dcc8;background:#fff;cursor:pointer;font-size:12px;color:#574a3a")} onClick={() => copy(`${render.caption || ""}\n${render.hashtags || ""}`.trim())}>Copy caption + hashtag</button>
            {render.cover_rel && <img src={studioFileUrl(p.id, render.cover_rel)} style={css("display:block;width:90px;border-radius:8px;margin-top:10px;border:1px solid #efe6d4")} />}
          </div>
        </div>
      )}
    </div>
  );
}
