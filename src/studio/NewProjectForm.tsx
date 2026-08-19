import { useState } from "react";
import { css } from "../lib/csx";
import { INDUSTRIES } from "./studioLabels";
import { createStudioProject } from "./studioApi";

const inp = css("width:100%;padding:10px 12px;border:1px solid #e6dcc8;border-radius:10px;background:#fff;font-size:14px;color:#2a2016");
const lab = css("font-size:12px;font-weight:600;color:#8a7c67;letter-spacing:.04em;text-transform:uppercase;margin:14px 0 6px;display:block");
const btn = css("padding:12px 18px;border-radius:12px;border:0;background:#b06a16;color:#fff;font-weight:700;cursor:pointer;font-size:14px");

export function NewProjectForm({ onCreated, onCancel, showToast }: { onCreated: (id: string) => void; onCancel: () => void; showToast: (m: string) => void }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("food");
  const [clipLen, setClipLen] = useState(8);
  const [tier, setTier] = useState<"draft" | "final">("draft");
  const [products, setProducts] = useState<File[]>([]);
  const [background, setBackground] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return showToast("Nhập tên sản phẩm.");
    if (!products.length) return showToast("Chọn ít nhất 1 ảnh sản phẩm.");
    setBusy(true);
    const fd = new FormData();
    fd.append("name", name.trim()); fd.append("industry", industry); fd.append("clipLen", String(clipLen)); fd.append("ratio", "9:16"); fd.append("tier", tier); fd.append("scriptSource", "ai");
    products.slice(0, 10).forEach((f) => fd.append("products", f, f.name));
    if (background) fd.append("background", background, background.name);
    const r = await createStudioProject(fd);
    setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Không tạo được dự án.");
    onCreated(r.project.id);
  };

  return (
    <div style={css("max-width:720px;background:#fff;border:1px solid #efe6d4;border-radius:16px;padding:22px")}>
      <div style={css("font-family:Fraunces,serif;font-size:22px;font-weight:600;color:#2a2016")}>Dự án mới</div>
      <div style={css("color:#8a7c67;font-size:13px;margin-top:4px")}>Ảnh sản phẩm + ảnh bối cảnh → kịch bản → ảnh khoá → duyệt → clip → mp4 đăng được ngay.</div>
      <label style={lab}>Tên sản phẩm</label>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Mẹt đốt chua xua tẩm ớt" />
      <label style={lab}>Ngành hàng</label>
      <select style={inp} value={industry} onChange={(e) => setIndustry(e.target.value)}>{INDUSTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <div style={css("display:flex;gap:16px")}>
        <div style={css("flex:1")}><label style={lab}>Thời lượng mỗi cảnh</label>
          <div style={css("display:flex;gap:8px")}>{[4, 6, 8].map((n) => <button key={n} onClick={() => setClipLen(n)} style={css(`flex:1;padding:10px;border-radius:10px;border:1px solid ${clipLen === n ? "#b06a16" : "#e6dcc8"};background:${clipLen === n ? "#fff3e0" : "#fff"};cursor:pointer;font-weight:600;color:#2a2016`)}>{n}s</button>)}</div></div>
        <div style={css("flex:1")}><label style={lab}>Hạng render</label>
          <div style={css("display:flex;gap:8px")}>{(["draft", "final"] as const).map((t) => <button key={t} onClick={() => setTier(t)} style={css(`flex:1;padding:10px;border-radius:10px;border:1px solid ${tier === t ? "#b06a16" : "#e6dcc8"};background:${tier === t ? "#fff3e0" : "#fff"};cursor:pointer;font-weight:600;color:#2a2016`)}>{t === "draft" ? "Nháp (rẻ)" : "Chốt (đẹp)"}</button>)}</div></div>
      </div>
      <label style={lab}>Ảnh sản phẩm (1–10, mặt trước, đủ sáng)</label>
      <input type="file" accept="image/*" multiple onChange={(e) => setProducts(Array.from(e.target.files || []))} />
      <div style={css("display:flex;gap:6px;flex-wrap:wrap;margin-top:8px")}>{products.map((f, i) => <img key={i} src={URL.createObjectURL(f)} style={css("width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #efe6d4")} />)}</div>
      <label style={lab}>Ảnh bối cảnh (1, tuỳ chọn)</label>
      <input type="file" accept="image/*" onChange={(e) => setBackground(e.target.files?.[0] || null)} />
      {background && <img src={URL.createObjectURL(background)} style={css("width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #efe6d4;margin-top:8px;display:block")} />}
      <div style={css("display:flex;gap:10px;margin-top:22px")}>
        <button style={btn} disabled={busy} onClick={submit}>{busy ? "Đang tạo…" : "Tạo dự án → dựng kịch bản"}</button>
        <button style={css("padding:12px 18px;border-radius:12px;border:1px solid #e6dcc8;background:#fff;cursor:pointer;color:#574a3a")} onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}
