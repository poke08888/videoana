import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { css as c } from "./lib/csx";
import { decorate, makeEntry, presetPerms, scoreOf, seedUsers, slug } from "./lib/analysis";
import { buildReportHTML } from "./lib/reportHtml";
import { buildRaw, seedDates, seedForms } from "./data/sampleAnalysis";
import { analyzeVideo, testGemini } from "./lib/api";
import type { AdminUser, Analysis, FormState, HistoryEntry, Level, Perms, User } from "./types";

const STAGES = [
  "Trích khung hình & phân cảnh",
  "Nhận diện sản phẩm & gương mặt",
  "Bóc tách lời thoại song ngữ",
  "Chấm theo khung Năm Lực",
  "Tổng hợp phiếu mổ xẻ",
];
const PLATFORMS = ["TikTok / Douyin", "TikTok", "Douyin", "Reels (Instagram)", "YouTube Shorts"];
const GENRES = ["Reviewer độc thoại (Vlog + Test)", "Trải nghiệm sản phẩm", "Before / After", "Storytelling", "Unboxing", "Khác"];
const GEM_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-preview-05-20", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const inputStyle = "width:100%;padding:13px 15px;border:1px solid rgba(140,96,40,.28);border-radius:12px;background:#fffdf8;font-size:15px;transition:.2s";

function seedHistory(): HistoryEntry[] {
  return seedForms.map((f, i) => {
    const a = decorate(buildRaw(f), f);
    return makeEntry(a, f, seedDates[i]);
  });
}

/* ── Responsive hook ── */
function useIsMobile() {
  const [mob, setMob] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  useEffect(() => {
    const fn = () => setMob(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mob;
}

/* ── VideoFrame: trích frame thật từ video file bằng Canvas API ── */
function VideoFrame({ file, ts, width = 86, height = 150 }: { file: File | null; ts: string; width?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!file || !canvasRef.current) return;
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";

    // Parse timestamp "0:02" → 2s, "1:34" → 94s
    const parts = ts.replace(/^\s*|\s*$/g, "").split(":").map(Number);
    const secs = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];

    const onSeeked = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = video.videoWidth || width * 2;
      canvas.height = video.videoHeight || height * 2;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setReady(true);
      video.removeEventListener("seeked", onSeeked);
      URL.revokeObjectURL(url);
    };

    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(secs, video.duration - 0.1);
    });
    video.addEventListener("seeked", onSeeked);
    video.load();

    return () => {
      video.removeEventListener("seeked", onSeeked);
      try { URL.revokeObjectURL(url); } catch(e){}
    };
  }, [file, ts]);

  return (
    <div style={c(`position:relative;flex:none;width:${width}px;height:${height}px;border-radius:10px;overflow:hidden;border:1px solid rgba(140,96,40,.22);background:linear-gradient(150deg,#e7d4b0,#c9a86f 55%,#a07c44)`)}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", objectFit: "cover", display: ready ? "block" : "none" }} />
      {!ready && <span style={c("position:absolute;inset:0;display:grid;place-items:center;font-size:24px;opacity:.55")}>🎬</span>}
      <span style={c("position:absolute;left:0;bottom:0;font-family:'Space Grotesk',sans-serif;font-size:9px;font-weight:600;background:#b06a16;color:#fff;padding:1px 5px;border-top-right-radius:6px;letter-spacing:.04em")}>{ts}</span>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<string>("auth");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [user, setUser] = useState<User | null>(null);
  const [auth, setAuth] = useState({ email: "", pass: "", name: "" });

  const [form, setForm] = useState<FormState>({ title: "", platform: "TikTok / Douyin", product: "", genre: "Reviewer độc thoại (Vlog + Test)", notes: "", file: "" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");

  const [progress, setProgress] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [analyzeNote, setAnalyzeNote] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const isMobile = useIsMobile();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(seedHistory);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>(seedUsers);
  const [permIndex, setPermIndex] = useState<number | null>(null);
  const [permDraft, setPermDraft] = useState<AdminUser | null>(null);
  const [integration, setIntegration] = useState({ key: "", model: GEM_MODELS[0], connected: false, testing: false, showKey: false });
  const [exportOpen, setExportOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState("");
  const [analyzeError, setAnalyzeError] = useState<{ title: string; detail: string }| null>(null);

  const mainRef = useRef<HTMLElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef(0);

  // load saved Gemini integration
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nonelab_gemini");
      if (raw) {
        const g = JSON.parse(raw);
        setIntegration((s) => ({ ...s, key: g.key || "", model: g.model || GEM_MODELS[0], connected: !!g.connected }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [screen, analysis]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2800);
  }
  const go = (s: string) => setScreen(s);
  const setFormPatch = (patch: Partial<FormState>) => setForm((s) => ({ ...s, ...patch }));
  const setAuthPatch = (patch: Partial<typeof auth>) => setAuth((s) => ({ ...s, ...patch }));

  function saveIntegration(patch: Partial<typeof integration>) {
    setIntegration((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem("nonelab_gemini", JSON.stringify({ key: next.key, model: next.model, connected: next.connected }));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function testConnection() {
    const key = (integration.key || "").trim();
    if (key.length < 20) {
      showToast("API key chưa hợp lệ (quá ngắn)");
      return;
    }
    setIntegration((s) => ({ ...s, testing: true }));
    const r = await testGemini(key, integration.model);
    saveIntegration({ testing: false, connected: r.ok });
    showToast(r.message);
  }

  function pickFile(file: File | null) {
    if (!file) return;
    setSelectedFile(file);
    setFormPatch({ file: file.name });
  }
  function triggerFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "video/mp4,video/*";
    inp.onchange = () => {
      if (inp.files && inp.files[0]) pickFile(inp.files[0]);
    };
    inp.click();
  }
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const fl = e.dataTransfer?.files?.[0];
    if (fl) pickFile(fl);
  };

  function progressTick() {
    setProgress((p) => {
      let np = p;
      if (np < 92) np = Math.min(92, np + Math.random() * 7 + 2.5);
      progressRef.current = np;
      return np;
    });
    setStageIdx(() => Math.min(STAGES.length - 1, Math.floor(progressRef.current / (100 / STAGES.length))));
  }

  async function startAnalyze() {
    const f = form;
    if (!selectedFile && !youtubeUrl && !f.title && !f.product && !f.notes) {
      showToast("Hãy tải video .mp4 lên, dán link, hoặc nhập tiêu đề / sản phẩm / mô tả");
      return;
    }
    setAnalyzeError(null);
    setScreen("analyzing");
    setProgress(6);
    setStageIdx(0);
    setAnalyzeNote(selectedFile || youtubeUrl ? "Gemini đang xem video…" : "Suy luận từ mô tả…");
    if (ivRef.current) clearInterval(ivRef.current);
    ivRef.current = setInterval(progressTick, 340);

    try {
      const r = await analyzeVideo({
        form: { title: f.title, platform: f.platform, product: f.product, genre: f.genre, notes: f.notes },
        file: selectedFile,
        youtubeUrl: youtubeUrl || undefined,
        apiKey: integration.key || undefined,
        model: integration.model,
      });

      if (ivRef.current) clearInterval(ivRef.current);

      if (r.ok && r.analysis) {
        const result = decorate(r.analysis, f);
        setProgress(100);
        setStageIdx(STAGES.length - 1);
        await sleep(520);
        const entry = makeEntry(result, f, "Vừa xong");
        setAnalysis(result);
        setHistory((h) => [entry, ...h]);
        setScreen("report");
        showToast(r.watchedVideo ? "Phân tích hoàn tất — Gemini đã xem video" : "Phân tích hoàn tất bằng Gemini (từ mô tả)");
      } else {
        // API trả về lỗi có thật — hiển thị thẳng, không dùng data mẫu
        const errTitle = r.error === "no-key"
          ? "Chưa kết nối Gemini API"
          : r.error === "gemini-failed"
          ? "Gemini trả về lỗi"
          : "Phân tích thất bại";
        setAnalyzeError({ title: errTitle, detail: r.message || "Không rõ lỗi." });
        setScreen("error");
      }
    } catch (err: any) {
      if (ivRef.current) clearInterval(ivRef.current);
      setAnalyzeError({
        title: "Không kết nối được server",
        detail: err?.message || "Kiểm tra lại kết nối mạng hoặc backend đã chạy chưa.",
      });
      setScreen("error");
    }
  }

  function doDownload() {
    const a = analysis;
    if (!a) return;
    const html = buildReportHTML(a);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "phieu-mo-xe-" + slug(a.meta.product || a.subtitle) + ".html";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setExportOpen(false);
    showToast("Đã tải file HTML");
  }
  async function copyHtml() {
    const a = analysis;
    if (!a) return;
    try {
      await navigator.clipboard.writeText(buildReportHTML(a));
      showToast("Đã sao chép mã HTML");
    } catch {
      showToast("Không sao chép được — hãy dùng nút Tải");
    }
  }

  // ---------- derived ----------
  const isAuth = screen === "auth";
  const isAnalyzing = screen === "analyzing";
  const isApp = !isAuth && !isAnalyzing;
  const isSignup = authMode === "signup";
  const a = analysis;

  const navDef = [
    { key: "dashboard", icon: "◇", label: "Bảng điều khiển" },
    { key: "history", icon: "≡", label: "Lịch sử" },
    { key: "admin", icon: "⚙", label: "Quản trị" },
  ];
  const titles: Record<string, [string, string]> = {
    dashboard: ["Bảng điều khiển", "Tổng quan hoạt động mổ xẻ video"],
    upload: ["Phân tích video mới", "Tải video & nhập thông tin để AI mổ xẻ"],
    report: ["Phiếu mổ xẻ", "Kết quả phân tích theo khung Năm Lực"],
    history: ["Lịch sử phân tích", "Tất cả phiếu mổ xẻ đã tạo"],
    admin: ["Quản trị người dùng", "Quản lý tài khoản & phân quyền"],
  };
  const [screenTitle, screenSub] = titles[screen] || ["", ""];

  const metaList = a
    ? ([
        ["Nền tảng", a.meta.platform],
        ["Thời lượng", a.meta.duration],
        ["Thể loại", a.meta.genre],
        ["Sản phẩm", a.meta.product],
        ["Gương mặt", a.meta.face],
        ["CTA", a.meta.cta],
      ] as [string, string][])
    : [];

  const stats = [
    { label: "Video đã mổ xẻ", value: String(history.length), sub: "tổng số phiếu" },
    { label: "Phiếu đã xuất", value: String(Math.max(1, history.length - 1)), sub: "file .html" },
    { label: "Nền tảng phủ", value: "4", sub: "TikTok · Douyin · Reels…" },
  ];

  const activeCount = adminUsers.filter((x) => x.active).length;
  const adminStats = [
    { label: "Tổng người dùng", value: String(adminUsers.length) },
    { label: "Đang hoạt động", value: String(activeCount) },
    { label: "Phân tích / tháng", value: String(adminUsers.reduce((t, x) => t + x.count, 0)) },
  ];

  const roleList = ["Quản trị", "Biên tập", "Cộng tác", "Khách"];
  const permDefs: [keyof Perms, string, string][] = [
    ["analyze", "Tạo phân tích video", "Tải video lên và chạy mổ xẻ bằng AI"],
    ["export", "Xuất file HTML", "Tải / sao chép phiếu mổ xẻ ra .html"],
    ["history", "Lịch sử toàn hệ thống", "Xem phiếu mổ xẻ của mọi thành viên"],
    ["manage", "Quản trị người dùng", "Phân quyền, khoá / mở tài khoản"],
  ];

  const openReport = (h: HistoryEntry) => {
    setAnalysis(h.analysis);
    setScreen("report");
  };

  const dropTitle = form.file ? form.file : "Kéo thả video .mp4 vào đây";
  const dropSub = form.file ? "Đã chọn — bấm để đổi file khác" : "hoặc bấm để chọn từ máy · tối đa 200MB";
  const dropBorder = dragOver ? "#b06a16" : "rgba(140,96,40,.4)";
  const dropBg = dragOver ? "rgba(176,106,22,.08)" : "#fdfaf3";

  const label = (extra?: string): CSSProperties =>
    c("display:block;font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;margin-bottom:7px" + (extra ? ";" + extra : ""));

  const submitAuth = () => {
    if (!auth.email || auth.email.indexOf("@") < 0) {
      showToast("Nhập email hợp lệ để tiếp tục");
      return;
    }
    const name = auth.name || auth.email.split("@")[0].replace(/^./, (cc) => cc.toUpperCase());
    setUser({ name, email: auth.email, role: "admin" });
    setScreen("dashboard");
    showToast("Chào mừng tới Nonelab Studio");
  };

  // ================= AUTH =================
  if (isAuth) {
    return (
      <div style={c("min-height:100vh;background:radial-gradient(1100px 560px at 88% -8%,rgba(176,106,22,.10),transparent 60%),radial-gradient(820px 460px at -4% 24%,rgba(60,122,94,.07),transparent 60%),#f6f1e7;color:#2a2016")}>
        <div className="ns-fade" style={c(`min-height:100vh;display:grid;grid-template-columns:${isMobile ? "1fr" : "1.05fr .95fr"}`)}>
          {/* brand panel */}
          {!isMobile && (
            <div style={c("position:relative;overflow:hidden;background:linear-gradient(155deg,#241a10,#3a2a16 60%,#4a3416);color:#f6efe0;padding:56px 60px;display:flex;flex-direction:column;justify-content:space-between")}>
              <div style={c("display:flex;align-items:center;gap:12px")}>
                <div style={c("width:38px;height:38px;border-radius:11px;background:linear-gradient(150deg,#e0a64e,#b06a16);display:grid;place-items:center;font-family:'Fraunces',serif;font-weight:900;color:#241a10;font-size:20px;box-shadow:0 6px 18px rgba(176,106,22,.4)")}>N</div>
                <div style={c("font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:.02em;font-size:17px")}>Nonelab <span style={c("opacity:.6;font-weight:400")}>Studio</span></div>
              </div>
              <div>
                <div style={c("font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.34em;font-size:11px;color:#e0a64e;font-weight:600;margin-bottom:22px")}>Hệ thống video bùng nổ</div>
                <h1 style={c("font-family:'Fraunces',serif;font-weight:900;font-size:clamp(34px,4.4vw,60px);line-height:1.0;letter-spacing:-.02em;margin:0 0 18px")}>Mổ xẻ mọi <span style={c("font-style:italic;font-weight:400;color:#e8bd72")}>thước phim</span> viral.</h1>
                <p style={c("max-width:42ch;color:#cdbfa6;font-size:16px;line-height:1.65;margin:0")}>Tải video lên, AI bóc tách storyboard, lời thoại song ngữ và chấm theo khung Năm Lực — rồi xuất thành phiếu mổ xẻ HTML chỉ trong một cú nhấp.</p>
              </div>
              <div style={c("display:flex;gap:30px;font-family:'Space Grotesk',sans-serif")}>
                <div><div style={c("font-size:26px;font-weight:700;color:#e8bd72")}>6 lớp</div><div style={c("font-size:12px;color:#b3a489;letter-spacing:.04em")}>phân tích sản xuất</div></div>
                <div><div style={c("font-size:26px;font-weight:700;color:#e8bd72")}>Năm Lực</div><div style={c("font-size:12px;color:#b3a489;letter-spacing:.04em")}>khung chấm điểm</div></div>
                <div><div style={c("font-size:26px;font-weight:700;color:#e8bd72")}>.html</div><div style={c("font-size:12px;color:#b3a489;letter-spacing:.04em")}>xuất bản tức thì</div></div>
              </div>
              <div style={c("position:absolute;right:-90px;bottom:-90px;width:320px;height:320px;border-radius:50%;border:1px solid rgba(224,166,78,.25)")} />
              <div style={c("position:absolute;right:-40px;bottom:-40px;width:220px;height:220px;border-radius:50%;border:1px solid rgba(224,166,78,.18)")} />
            </div>
          )}
          {/* form panel */}
          <div style={c(`display:flex;align-items:center;justify-content:center;padding:${isMobile ? "20px 16px 40px" : "40px"}`)}>
            <div className="ns-pop" style={c(`width:100%;max-width:400px;background:#fffdf8;border:1px solid rgba(140,96,40,0.18);border-radius:24px;padding:${isMobile ? "28px 20px" : "36px 32px"};box-shadow:0 12px 40px rgba(36,26,16,0.06)`)}>
              {isMobile && (
                <div style={c("display:flex;align-items:center;gap:12px;margin-bottom:28px;justify-content:center")}>
                  <div style={c("width:38px;height:38px;border-radius:11px;background:linear-gradient(150deg,#e0a64e,#b06a16);display:grid;place-items:center;font-family:'Fraunces',serif;font-weight:900;color:#241a10;font-size:20px;box-shadow:0 6px 18px rgba(176,106,22,.4)")}>N</div>
                  <div style={c("font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:.02em;font-size:17px")}>Nonelab <span style={c("opacity:.6;font-weight:400")}>Studio</span></div>
                </div>
              )}
              <div style={c("font-family:'Fraunces',serif;font-size:28px;font-weight:600;letter-spacing:-.01em;margin-bottom:6px")}>{isSignup ? "Tạo tài khoản" : "Đăng nhập"}</div>
              <p style={c("color:#8a7c67;font-size:14px;margin:0 0 24px;line-height:1.45")}>{isSignup ? "Bắt đầu phân tích video chỉ trong vài phút." : "Tiếp tục mổ xẻ những thước phim viral."}</p>

              {isSignup && (
                <>
                  <label style={label()}>Họ và tên</label>
                  <input className="ns-in" value={auth.name} onChange={(e) => setAuthPatch({ name: e.target.value })} placeholder="Nguyễn Brand Manager" style={c(inputStyle + ";margin-bottom:16px")} />
                </>
              )}

              <label style={label()}>Email công việc</label>
              <input className="ns-in" value={auth.email} onChange={(e) => setAuthPatch({ email: e.target.value })} placeholder="ban@nonelab.asia" style={c(inputStyle + ";margin-bottom:16px")} />

              <label style={label()}>Mật khẩu</label>
              <input className="ns-in" value={auth.pass} onChange={(e) => setAuthPatch({ pass: e.target.value })} type="password" placeholder="••••••••" style={c(inputStyle + ";margin-bottom:22px")} />

              <button onClick={submitAuth} style={c("width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:15px;letter-spacing:.02em;cursor:pointer;box-shadow:0 8px 22px rgba(154,90,18,.32)")}>{isSignup ? "Tạo tài khoản →" : "Đăng nhập →"}</button>

              <div style={c("text-align:center;margin-top:20px;font-size:14px;color:#8a7c67")}>
                {isSignup ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
                <span onClick={() => setAuthMode(isSignup ? "login" : "signup")} style={c("color:#9a5a12;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px")}>{isSignup ? "Đăng nhập" : "Đăng ký"}</span>
              </div>
              <div style={c("margin-top:24px;padding:12px 14px;border-radius:11px;background:rgba(60,122,94,.08);border:1px solid rgba(60,122,94,.22);font-size:12.5px;color:#3a6b54;line-height:1.5")}>Demo: nhập email bất kỳ để vào. Tài khoản dùng thử có quyền <b>Quản trị</b>.</div>
            </div>
          </div>
        </div>
        {toast && <Toast text={toast} />}
      </div>
    );
  }

  // ================= ERROR SCREEN =================
  if (screen === "error" && analyzeError) {
    return (
      <div style={c("min-height:100vh;background:radial-gradient(1100px 560px at 88% -8%,rgba(176,106,22,.10),transparent 60%),#f6f1e7;color:#2a2016;display:flex;align-items:center;justify-content:center;padding:40px")}>
        <div className="ns-pop" style={c("width:100%;max-width:520px;background:#fffdf8;border:1px solid rgba(200,60,40,.22);border-radius:22px;padding:40px 36px;text-align:center;box-shadow:0 16px 50px rgba(36,26,16,.1)")}
        >
          <div style={c("width:60px;height:60px;margin:0 auto 20px;border-radius:50%;background:linear-gradient(150deg,#f87171,#c53030);display:grid;place-items:center;font-size:26px;box-shadow:0 6px 18px rgba(197,48,48,.3)")}>
            ✕
          </div>
          <div style={c("font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.22em;font-size:11px;color:#c53030;font-weight:700;margin-bottom:12px")}>Phân tích thất bại</div>
          <h2 style={c("font-family:'Fraunces',serif;font-size:26px;font-weight:700;margin:0 0 14px;letter-spacing:-.01em;color:#2a2016")}>{analyzeError.title}</h2>
          <div style={c("background:rgba(200,60,40,.07);border:1px solid rgba(200,60,40,.18);border-radius:12px;padding:16px 18px;text-align:left;font-size:14px;color:#7a2020;line-height:1.65;margin-bottom:28px;white-space:pre-wrap;word-break:break-word")}>
            {analyzeError.detail}
          </div>
          <div style={c("display:flex;gap:12px;justify-content:center")}>
            <button
              onClick={() => { setAnalyzeError(null); setScreen("upload"); }}
              style={c("padding:13px 24px;border:none;border-radius:12px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14.5px;cursor:pointer;box-shadow:0 6px 18px rgba(154,90,18,.28)")}
            >
              ← Thử lại
            </button>
            <button
              onClick={() => { setAnalyzeError(null); setScreen("admin"); }}
              style={c("padding:13px 24px;border:1px solid rgba(140,96,40,.3);border-radius:12px;background:#fffdf8;color:#574a3a;font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:14.5px;cursor:pointer")}
            >
              ⚙ Kiểm tra API key
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ================= ANALYZING =================
  if (isAnalyzing) {
    const pct = Math.round(progress) + "%";
    return (
      <div style={c("min-height:100vh;background:radial-gradient(1100px 560px at 88% -8%,rgba(176,106,22,.10),transparent 60%),#f6f1e7;color:#2a2016")}>
        <div className="ns-fade" style={c("min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px;background:radial-gradient(900px 500px at 50% 0%,rgba(176,106,22,.12),transparent 60%)")}>
          <div style={c("width:100%;max-width:560px;text-align:center")}>
            <div style={c("position:relative;width:104px;height:104px;margin:0 auto 30px")}>
              <div style={c("position:absolute;inset:0;border-radius:50%;border:3px solid rgba(140,96,40,.16)")} />
              <div style={c("position:absolute;inset:0;border-radius:50%;border:3px solid transparent;border-top-color:#b06a16;border-right-color:#b06a16;animation:ns-spin 1s linear infinite")} />
              <div style={c("position:absolute;inset:18px;border-radius:18px;background-image:repeating-linear-gradient(#241a10 0 8px,#3a2a16 8px 14px);animation:ns-reel 1.2s steps(7) infinite;opacity:.9")} />
              <div style={c("position:absolute;inset:0;display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:22px;color:#241a10")}>{pct}</div>
            </div>
            <div style={c("font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.3em;font-size:11px;color:#b06a16;font-weight:600;margin-bottom:10px")}>Đang mổ xẻ video</div>
            <h2 style={c("font-family:'Fraunces',serif;font-size:30px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em")}>{form.title || form.product || "Video của bạn"}</h2>
            <p style={c("color:#8a7c67;margin:0 0 30px;font-size:14.5px")}>{STAGES[stageIdx]}… <span style={c("color:#b06a16")}>{analyzeNote}</span></p>

            <div style={c("height:8px;border-radius:99px;background:rgba(140,96,40,.14);overflow:hidden;margin-bottom:34px")}>
              <div style={{ ...c("height:100%;border-radius:99px;background:linear-gradient(90deg,#c07c1e,#9a5a12);transition:width .4s ease"), width: pct }} />
            </div>

            <div style={c("display:flex;flex-direction:column;gap:11px;text-align:left;max-width:420px;margin:0 auto")}>
              {STAGES.map((st, i) => {
                const done = i < stageIdx;
                const active = i === stageIdx;
                const bg = active ? "rgba(176,106,22,.10)" : done ? "rgba(60,122,94,.07)" : "#fffdf8";
                const dotBg = done ? "#3c7a5e" : active ? "#b06a16" : "rgba(140,96,40,.14)";
                const dotColor = done || active ? "#fff" : "#8a7c67";
                const txtColor = active ? "#2a2016" : done ? "#3a6b54" : "#8a7c67";
                return (
                  <div key={i} style={{ ...c("display:flex;align-items:center;gap:13px;padding:12px 16px;border-radius:13px;border:1px solid rgba(140,96,40,.16)"), background: bg }}>
                    <div style={{ ...c("width:24px;height:24px;border-radius:50%;flex:none;display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:700"), background: dotBg, color: dotColor }}>{done ? "✓" : String(i + 1)}</div>
                    <div style={{ ...c("font-size:14px"), color: txtColor, fontWeight: active ? 600 : 500 }}>{st}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {toast && <Toast text={toast} />}
      </div>
    );
  }

  // ================= APP SHELL =================
  const userName = user ? user.name : "Khách";
  const userInitial = user ? (user.name[0] || "?").toUpperCase() : "?";
  const userRoleLabel = user && user.role === "admin" ? "Quản trị viên" : "Thành viên";

  const closeMobileNav = () => setNavOpen(false);

  return (
    <div style={c("min-height:100vh;background:radial-gradient(1100px 560px at 88% -8%,rgba(176,106,22,.10),transparent 60%),radial-gradient(820px 460px at -4% 24%,rgba(60,122,94,.07),transparent 60%),#f6f1e7;color:#2a2016")}>
      <div style={c("display:flex;min-height:100vh")}>
        {/* MOBILE OVERLAY */}
        {isMobile && navOpen && (
          <div onClick={closeMobileNav} style={c("position:fixed;inset:0;z-index:40;background:rgba(36,26,16,.45);backdrop-filter:blur(2px)")} />
        )}

        {/* SIDEBAR */}
        <aside style={{
          ...c("width:248px;flex:none;background:#fffdf8;border-right:1px solid rgba(140,96,40,.18);display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh;z-index:50;transition:transform .25s cubic-bezier(.4,0,.2,1)"),
          transform: isMobile ? (navOpen ? "translateX(0)" : "translateX(-100%)") : "translateX(0)",
          boxShadow: isMobile && navOpen ? "4px 0 32px rgba(36,26,16,.18)" : "none",
        }}>
          <div style={c("padding:22px 22px 16px;display:flex;align-items:center;gap:11px;border-bottom:1px solid rgba(140,96,40,.12)")}>
            <div style={c("width:34px;height:34px;border-radius:10px;background:linear-gradient(150deg,#e0a64e,#b06a16);display:grid;place-items:center;font-family:'Fraunces',serif;font-weight:900;color:#241a10;font-size:18px")}>N</div>
            <div style={c("font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:15px")}>Nonelab <span style={c("opacity:.55;font-weight:400")}>Studio</span></div>
          </div>
          <nav style={c("padding:14px 12px;display:flex;flex-direction:column;gap:3px;flex:1")}>
            {navDef.map((it) => {
              const on = screen === it.key;
              return (
                <div key={it.key} onClick={() => { go(it.key); closeMobileNav(); }} style={{ ...c("display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:11px;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:14px;transition:.18s"), fontWeight: on ? 600 : 500, color: on ? "#9a5a12" : "#574a3a", background: on ? "rgba(176,106,22,.12)" : "transparent" }}>
                  <span style={c("font-size:17px;width:20px;text-align:center")}>{it.icon}</span>
                  {it.label}
                </div>
              );
            })}
            <button onClick={() => { setScreen("upload"); closeMobileNav(); }} style={c("margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:none;border-radius:12px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 6px 16px rgba(154,90,18,.28)")}>＋ Phân tích mới</button>
          </nav>
          <div style={c("padding:14px;border-top:1px solid rgba(140,96,40,.12)")}>
            <div style={c("display:flex;align-items:center;gap:11px;padding:8px 6px")}>
              <div style={c("width:36px;height:36px;border-radius:50%;background:linear-gradient(150deg,#3c7a5e,#2a5a44);color:#fff;display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px")}>{userInitial}</div>
              <div style={c("min-width:0;flex:1")}>
                <div style={c("font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{userName}</div>
                <div style={c("font-size:11px;color:#8a7c67")}>{userRoleLabel}</div>
              </div>
              <span onClick={() => { setUser(null); setScreen("auth"); setAuth({ email: "", pass: "", name: "" }); closeMobileNav(); }} title="Đăng xuất" style={c("cursor:pointer;color:#8a7c67;font-size:16px;padding:4px")}>⎋</span>
            </div>
          </div>
        </aside>

        {/* SPACER for desktop sidebar */}
        {!isMobile && <div style={{ width: 248, flexShrink: 0 }} />}

        {/* MAIN */}
        <main ref={mainRef} className="ns-scroll" style={c("flex:1;min-width:0;height:100vh;overflow-y:auto")}>
          {/* topbar */}
          <div style={c("position:sticky;top:0;z-index:20;backdrop-filter:blur(8px);background:rgba(246,241,231,.82);border-bottom:1px solid rgba(140,96,40,.14);padding:14px 20px;display:flex;align-items:center;justify-content:space-between")}>
            <div style={c("display:flex;align-items:center;gap:12px")}>
              {/* hamburger on mobile */}
              {isMobile && (
                <button onClick={() => setNavOpen(v => !v)} style={c("width:38px;height:38px;border:none;background:transparent;cursor:pointer;display:grid;place-items:center;border-radius:9px;color:#574a3a;font-size:20px;flex:none")} aria-label="Menu">☰</button>
              )}
              <div>
                <div style={c("font-family:'Fraunces',serif;font-size:clamp(17px,3vw,22px);font-weight:600;letter-spacing:-.01em")}>{screenTitle}</div>
                {!isMobile && <div style={c("font-size:12.5px;color:#8a7c67")}>{screenSub}</div>}
              </div>
            </div>
            <div style={c("display:flex;gap:8px;align-items:center")}>
              {screen === "report" && (
                <>
                  {!isMobile && <button onClick={() => setScreen("upload")} style={c("padding:9px 15px;border:1px solid rgba(140,96,40,.3);border-radius:10px;background:#fffdf8;color:#574a3a;font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:13px;cursor:pointer")}>↻ Phân tích lại</button>}
                  <button onClick={() => setExportOpen(true)} style={c("padding:9px 14px;border:none;border-radius:10px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13px;cursor:pointer;box-shadow:0 5px 14px rgba(154,90,18,.26)")}>⬇ {isMobile ? "" : "Xuất HTML"}</button>
                </>
              )}
            </div>
          </div>

          <div style={c(`padding:${isMobile ? "16px 16px 90px" : "30px 34px 60px"}`)}>
            {screen === "dashboard" && <Dashboard stats={stats} recent={history.slice(0, 3)} onOpen={openReport} onAll={() => go("history")} isMobile={isMobile} />}
            {screen === "history" && <HistoryView history={history} onOpen={openReport} />}
            {screen === "upload" && (
              <UploadView
                form={form}
                setFormPatch={setFormPatch}
                youtubeUrl={youtubeUrl}
                setYoutubeUrl={setYoutubeUrl}
                triggerFile={triggerFile}
                onDragOver={onDragOver}
                onDrop={onDrop}
                dropTitle={dropTitle}
                dropSub={dropSub}
                dropBorder={dropBorder}
                dropBg={dropBg}
                startAnalyze={startAnalyze}
                label={label}
                isMobile={isMobile}
              />
            )}
            {screen === "report" && a && <ReportView a={a} metaList={metaList} videoFile={selectedFile} isMobile={isMobile} />}
            {screen === "admin" && (
              <AdminView
                adminStats={adminStats}
                adminUsers={adminUsers}
                integration={integration}
                gemModels={GEM_MODELS}
                onGemKey={(v: string) => setIntegration((s) => ({ ...s, key: v, connected: false }))}
                onGemModel={(v: string) => saveIntegration({ model: v })}
                toggleGemKey={() => setIntegration((s) => ({ ...s, showKey: !s.showKey }))}
                testConnection={testConnection}
                disconnectGem={() => { saveIntegration({ key: "", connected: false }); showToast("Đã ngắt kết nối Gemini"); }}
                onManage={(i: number) => { setPermIndex(i); setPermDraft({ ...adminUsers[i], perms: { ...adminUsers[i].perms } }); }}
              />
            )}
          </div>
        </main>
      </div>

      {/* MOBILE BOTTOM NAV */}
      {isMobile && isApp && (
        <nav style={c("position:fixed;bottom:0;left:0;right:0;z-index:30;background:rgba(255,253,248,.96);backdrop-filter:blur(12px);border-top:1px solid rgba(140,96,40,.16);display:flex;align-items:stretch;height:60px;padding:0 6px;safe-area-inset-bottom:env(safe-area-inset-bottom,0)")}
          role="navigation"
        >
          {navDef.map((it) => {
            const on = screen === it.key;
            return (
              <button key={it.key} onClick={() => { go(it.key); closeMobileNav(); }} style={{ ...c("flex:1;border:none;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;border-radius:10px;transition:.15s"), color: on ? "#9a5a12" : "#8a7c67" }}>
                <span style={{ fontSize: 20 }}>{it.icon}</span>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 10, fontWeight: on ? 700 : 500 }}>{it.label}</span>
              </button>
            );
          })}
          <button onClick={() => { setScreen("upload"); closeMobileNav(); }} style={c("flex:none;width:50px;border:none;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;border-radius:12px;margin:6px 4px;cursor:pointer;font-size:22px;display:grid;place-items:center;box-shadow:0 4px 14px rgba(154,90,18,.35)")}>＋</button>
        </nav>
      )}

      {/* PERMISSION MODAL */}
      {permDraft && (
        <PermissionModal
          draft={permDraft}
          roleList={roleList}
          permDefs={permDefs}
          onRole={(r) => setPermDraft((s) => (s ? { ...s, role: r, perms: presetPerms(r) } : s))}
          onToggle={(k) => setPermDraft((s) => (s ? { ...s, perms: { ...s.perms, [k]: !s.perms[k] } } : s))}
          onToggleActive={() => setPermDraft((s) => (s ? { ...s, active: !s.active } : s))}
          onClose={() => { setPermIndex(null); setPermDraft(null); }}
          onSave={() => {
            const i = permIndex;
            const draft = permDraft;
            setAdminUsers((us) => us.map((x, j) => (j === i ? { ...draft } : x)));
            setPermIndex(null);
            setPermDraft(null);
            showToast("Đã lưu phân quyền " + draft.name);
          }}
        />
      )}

      {/* EXPORT MODAL */}
      {exportOpen && a && (
        <ExportModal
          filename={"phieu-mo-xe-" + slug(a.meta.product || a.subtitle) + ".html"}
          size={Math.round(buildReportHTML(a).length / 1024) + " KB"}
          onClose={() => setExportOpen(false)}
          onDownload={doDownload}
          onCopy={copyHtml}
        />
      )}

      {toast && <Toast text={toast} />}
    </div>
  );
}

/* ===================== SUB-COMPONENTS ===================== */

function Toast({ text }: { text: string }) {
  return (
    <div className="ns-pop" style={c("position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:80;background:#241a10;color:#f6efe0;padding:13px 22px;border-radius:13px;font-size:13.5px;font-weight:500;box-shadow:0 14px 40px rgba(36,26,16,.4);display:flex;align-items:center;gap:10px")}>
      <span style={c("color:#e8bd72")}>✓</span>
      {text}
    </div>
  );
}

function Dashboard({ stats, recent, onOpen, onAll, isMobile }: { stats: { label: string; value: string; sub: string }[]; recent: HistoryEntry[]; onOpen: (h: HistoryEntry) => void; onAll: () => void; isMobile: boolean }) {
  return (
    <div className="ns-fade">
      <div className="ns-rise" style={c(`display:grid;grid-template-columns:${isMobile ? "1fr 1fr" : "repeat(auto-fit,minmax(170px,1fr))"};gap:${isMobile ? "10px" : "16px"};margin-bottom:30px`)}>
        {stats.map((s, i) => (
          <div key={i} style={c(`background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:16px;padding:${isMobile ? "14px 16px" : "20px 22px"}`)}>
            <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;margin-bottom:8px")}>{s.label}</div>
            <div style={c(`font-family:'Fraunces',serif;font-size:${isMobile ? "28px" : "34px"};font-weight:600;color:#9a5a12;line-height:1`)}>{s.value}</div>
            <div style={c("font-size:11.5px;color:#8a7c67;margin-top:4px")}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div style={c("display:flex;align-items:center;justify-content:space-between;margin-bottom:14px")}>
        <div style={c("font-family:'Space Grotesk',sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;font-weight:600")}>Phân tích gần đây</div>
        <span onClick={onAll} style={c("font-size:13px;color:#9a5a12;font-weight:600;cursor:pointer")}>Xem tất cả →</span>
      </div>
      <div className="ns-rise" style={c("display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px")}>
        {recent.map((h) => (
          <div key={h.id} onClick={() => onOpen(h)} style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:16px;overflow:hidden;cursor:pointer;transition:.2s;box-shadow:0 1px 2px rgba(70,48,20,.04)")}>
            <div style={{ ...c("height:118px;position:relative;display:grid;place-items:center"), background: h.thumb }}>
              <div style={c("font-size:30px;opacity:.8")}>🎬</div>
              <div style={c("position:absolute;left:12px;bottom:12px;font-family:'Space Grotesk',sans-serif;font-size:10.5px;font-weight:600;letter-spacing:.08em;color:#fff;background:rgba(36,26,16,.55);padding:3px 9px;border-radius:99px")}>{h.platform}</div>
              <div style={c("position:absolute;right:12px;top:12px;font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:700;color:#241a10;background:#e8bd72;width:38px;height:38px;border-radius:50%;display:grid;place-items:center")}>{h.score}</div>
            </div>
            <div style={c("padding:15px 17px")}>
              <div style={c("font-family:'Fraunces',serif;font-size:16.5px;font-weight:600;line-height:1.25;margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>{h.title}</div>
              <div style={c("font-size:12.5px;color:#8a7c67")}>{h.product} · {h.date}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryView({ history, onOpen }: { history: HistoryEntry[]; onOpen: (h: HistoryEntry) => void }) {
  return (
    <div className="ns-fade ns-rise" style={c("display:flex;flex-direction:column;gap:11px")}>
      {history.map((h) => (
        <div key={h.id} onClick={() => onOpen(h)} style={c("display:flex;gap:18px;align-items:center;background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:15px;padding:14px 18px;cursor:pointer;transition:.18s")}>
          <div style={{ ...c("width:80px;height:56px;border-radius:10px;flex:none;display:grid;place-items:center;font-size:22px"), background: h.thumb }}>🎬</div>
          <div style={c("flex:1;min-width:0")}>
            <div style={c("font-family:'Fraunces',serif;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{h.title}</div>
            <div style={c("font-size:12.5px;color:#8a7c67;margin-top:3px")}>{h.platform} · {h.product} · {h.date}</div>
          </div>
          <div style={c("text-align:right;flex:none")}>
            <div style={c("font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:#9a5a12")}>{h.score}</div>
            <div style={c("font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#8a7c67")}>điểm</div>
          </div>
          <span style={c("color:#b06a16;font-size:18px;flex:none")}>→</span>
        </div>
      ))}
    </div>
  );
}



function UploadView(props: any) {
  const { form, setFormPatch, youtubeUrl, setYoutubeUrl, triggerFile, onDragOver, onDrop, dropTitle, dropSub, dropBorder, dropBg, startAnalyze, label, isMobile } = props;

  const inputSt = c("width:100%;padding:12px 14px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fffdf8;font-size:14.5px;transition:.2s");

  return (
    <div className="ns-fade">
      <div style={c(`max-width:${isMobile ? "100%" : "760px"}`)}>
        {/* Drop zone */}
        <div onClick={triggerFile} onDragOver={onDragOver} onDrop={onDrop}
          style={{ ...c(`border-radius:18px;padding:${isMobile ? "36px 20px" : "54px 30px"};text-align:center;cursor:pointer;transition:.2s;margin-bottom:20px`), border: "2px dashed " + dropBorder, background: dropBg }}>
          <div style={c("width:56px;height:56px;margin:0 auto 14px;border-radius:15px;background:linear-gradient(150deg,#e0a64e,#b06a16);display:grid;place-items:center;font-size:26px;box-shadow:0 8px 20px rgba(176,106,22,.3)")}>🎞️</div>
          <div style={c("font-family:'Fraunces',serif;font-size:19px;font-weight:600;margin-bottom:5px")}>{dropTitle}</div>
          <div style={c("color:#8a7c67;font-size:13.5px")}>{dropSub}</div>
        </div>

        {/* Form fields */}
        <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr" : "1fr 1fr"};gap:13px`)}>
          <div>
            <label style={label()}>Tiêu đề video</label>
            <input className="ns-in" value={form.title} onChange={(e: any) => setFormPatch({ title: e.target.value })} placeholder="Thử thách dội nước phấn phủ…" style={inputSt} />
          </div>
          <div>
            <label style={label()}>Sản phẩm</label>
            <input className="ns-in" value={form.product} onChange={(e: any) => setFormPatch({ product: e.target.value })} placeholder="Phấn phủ nén chống nắng" style={inputSt} />
          </div>
          <div>
            <label style={label()}>Nền tảng</label>
            <select value={form.platform} onChange={(e: any) => setFormPatch({ platform: e.target.value })} style={c("width:100%;padding:12px 14px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fffdf8;font-size:14.5px;cursor:pointer")}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Thể loại</label>
            <select value={form.genre} onChange={(e: any) => setFormPatch({ genre: e.target.value })} style={c("width:100%;padding:12px 14px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fffdf8;font-size:14.5px;cursor:pointer")}>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div style={c(isMobile ? "" : "grid-column:1/-1")}>
            <label style={label()}>Hoặc dán link YouTube / video công khai (tuỳ chọn)</label>
            <input className="ns-in" value={youtubeUrl} onChange={(e: any) => setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" style={inputSt} />
          </div>
          <div style={c(isMobile ? "" : "grid-column:1/-1")}>
            <label style={label()}>Mô tả nội dung video (AI dùng kèm khi xem video)</label>
            <textarea className="ns-in" value={form.notes} onChange={(e: any) => setFormPatch({ notes: e.target.value })} placeholder="VD: Creator dội nước lên mặt, dặm phấn, tắm vòi sen rồi lau bông tẩy trang…" style={c("width:100%;min-height:84px;resize:vertical;padding:12px 14px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fffdf8;font-size:14.5px;line-height:1.55;transition:.2s")} />
          </div>
        </div>

        <button onClick={startAnalyze} style={c(`margin-top:20px;${isMobile ? "width:100%;" : ""}padding:14px 26px;border:none;border-radius:12px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:15px;cursor:pointer;box-shadow:0 8px 20px rgba(154,90,18,.3)`)}>⚡ Bắt đầu mổ xẻ</button>
      </div>
    </div>
  );
}

function SectionHead({ tag, title }: { tag: string; title: string }) {
  return (
    <div style={c("display:flex;align-items:baseline;gap:14px;margin:0 0 18px")}>
      <span style={c("font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:12px;color:#7a4a10;border:1px solid rgba(140,96,40,.3);border-radius:99px;padding:4px 12px")}>{tag}</span>
      <h2 style={c("font-family:'Fraunces',serif;font-weight:600;font-size:clamp(20px,3vw,28px);margin:0;letter-spacing:-.01em")}>{title}</h2>
    </div>
  );
}

function ReportView({ a, metaList, videoFile, isMobile }: { a: Analysis; metaList: [string, string][]; videoFile: File | null; isMobile: boolean }) {
  const chipStyle = (lv: Level): CSSProperties => {
    if (lv === "ok") return c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(60,122,94,.13);color:#2f6b4f;border:1px solid rgba(60,122,94,.4);white-space:nowrap");
    if (lv === "mid") return c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(176,106,22,.14);color:#8a5614;border:1px solid rgba(176,106,22,.4);white-space:nowrap");
    return c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(158,58,58,.12);color:#8f3232;border:1px solid rgba(158,58,58,.4);white-space:nowrap");
  };

  const frameW = isMobile ? 70 : 86;
  const frameH = isMobile ? 124 : 150;

  return (
    <div className="ns-fade" style={c("max-width:1000px;margin:0 auto")}>
      {/* hero */}
      <div style={c("border:1px solid rgba(140,96,40,.2);border-radius:20px;overflow:hidden;background:#fffdf8;margin-bottom:26px")}>
        <div style={c(`padding:${isMobile ? "22px 18px" : "34px 36px"};background:linear-gradient(160deg,#241a10,#3a2a16)`)}>
          <div style={c("font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.3em;font-size:10.5px;color:#e0a64e;font-weight:600;margin-bottom:16px")}>Nonelab · Mổ xẻ video · Khung Năm Lực</div>
          <h1 style={c("font-family:'Fraunces',serif;font-weight:900;font-size:clamp(26px,5vw,52px);line-height:1.0;letter-spacing:-.02em;margin:0 0 10px;color:#f6efe0")}>Phiếu <span style={c("font-style:italic;font-weight:400;color:#e8bd72")}>mổ xẻ</span> video</h1>
          <p style={c("font-family:'Fraunces',serif;font-style:italic;font-size:clamp(13px,2.4vw,20px);color:#cdbfa6;margin:0;max-width:60ch")}>{a.subtitle}</p>
        </div>
        <dl style={c("display:flex;flex-wrap:wrap;margin:0")}>
          {metaList.map((m, i) => (
            <div key={i} style={c(`flex:1 1 ${isMobile ? "45%" : "150px"};padding:12px 16px;border-right:1px solid rgba(70,54,32,.1);border-top:1px solid rgba(70,54,32,.1)`)}>
              <dt style={c("font-family:'Space Grotesk',sans-serif;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:#8a7c67;margin-bottom:4px")}>{m[0]}</dt>
              <dd style={c("margin:0;font-weight:600;font-size:13px")}>{m[1]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* verdict */}
      <SectionHead tag="Chốt nhanh" title="Vì sao nó chạy" />
      <div className="ns-rise" style={c(`display:grid;grid-template-columns:${isMobile ? "1fr 1fr" : "repeat(auto-fit,minmax(180px,1fr))"};gap:12px;margin-bottom:32px`)}>
        {a.verdict.map((v, i) => (
          <div key={i} style={c("background:linear-gradient(160deg,#f7f0e2,#fffdf8);border:1px solid rgba(140,96,40,.22);border-radius:16px;padding:16px")}>
            <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;margin-bottom:8px")}>{v.label}</div>
            <div style={c("font-family:'Fraunces',serif;font-size:22px;font-weight:600;color:#9a5a12;line-height:1")}>{v.big}</div>
            {!isMobile && <p style={c("margin:8px 0 0;font-size:12.5px;color:#574a3a;line-height:1.5")}>{v.note}</p>}
          </div>
        ))}
      </div>

      {/* hook */}
      {a.hook && (a.hook.quote || a.hook.type) && (
        <>
          <SectionHead tag="Hook" title="3 giây đầu" />
          <div style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.2);border-left:3px solid #b06a16;border-radius:0 16px 16px 0;padding:18px 20px;margin-bottom:32px;display:flex;gap:16px;align-items:center;flex-wrap:wrap")}>
            <div style={c("flex:1;min-width:200px")}>
              {a.hook.quote && <div style={c("font-family:'Fraunces',serif;font-style:italic;font-size:16px;color:#2a2016;line-height:1.4;margin-bottom:8px")}>“{a.hook.quote}”</div>}
              <div style={c("font-size:13px;color:#574a3a;line-height:1.5")}>{a.hook.note}</div>
              <div style={c("display:flex;gap:8px;margin-top:10px;flex-wrap:wrap")}>
                {a.hook.type && <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(176,106,22,.12);color:#8a5614")}>Kiểu: {a.hook.type}</span>}
                <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(60,122,94,.12);color:#2f6b4f")}>{a.hook.viewerFirst ? "Viewer-first" : "Creator-first"}</span>
              </div>
            </div>
            {typeof a.hook.score === "number" && (
              <div style={c("text-align:center;flex:none")}>
                <div style={c("font-family:'Fraunces',serif;font-size:44px;font-weight:600;color:#9a5a12;line-height:1")}>{a.hook.score}<span style={c("font-size:18px;color:#8a7c67")}>/10</span></div>
                <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67")}>điểm hook</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* storyboard — real frames */}
      <SectionHead tag="Storyboard" title="Mổ theo phân cảnh" />
      <div style={c("display:flex;flex-direction:column;gap:30px;margin-bottom:32px")}>
        {a.acts.map((act, ai) => (
          <div key={ai}>
            <div style={c("display:flex;gap:13px;align-items:flex-start;margin-bottom:14px")}>
              <div style={c("width:38px;height:38px;flex:none;border-radius:50%;background:#b06a16;color:#fff;display:grid;place-items:center;font-family:'Fraunces',serif;font-weight:900;font-size:17px;box-shadow:0 0 0 4px #f6f1e7,0 0 0 5px rgba(140,96,40,.25)")}>{act.no}</div>
              <div>
                <div style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#b06a16;font-weight:600")}>{act.range}</div>
                <div style={c("font-family:'Fraunces',serif;font-size:18px;font-weight:600;margin:2px 0 4px;letter-spacing:-.01em")}>{act.title}</div>
                <p style={c("margin:0;color:#574a3a;font-size:13px;max-width:60ch;line-height:1.55")}>{act.summary}</p>
              </div>
            </div>
            <div style={c(`display:flex;flex-direction:column;gap:10px;${isMobile ? "" : "margin-left:51px"}`)}>
              {act.beats.map((beat, bi) => (
                <div key={bi} style={c(`display:flex;gap:12px;background:#fffdf8;border:1px solid rgba(70,54,32,.13);border-radius:14px;padding:12px;${isMobile ? "flex-wrap:wrap" : ""}`)}>
                  {/* Real video frame */}
                  <VideoFrame file={videoFile} ts={beat.ts} width={frameW} height={frameH} />

                  <div style={c("min-width:0;flex:1")}>
                    <p style={c("font-size:13px;color:#9a5a12;margin:0 0 5px;line-height:1.45;font-weight:600")}>{beat.vi}</p>
                    <p style={c("font-size:11.5px;color:#8a7c67;margin:0 0 8px;line-height:1.5")}>{beat.note}</p>
                    <div style={c("border-top:1px solid rgba(140,96,40,.18);padding-top:8px")}>
                      <div style={c("background:rgba(176,106,22,.06);border-left:3px solid #b06a16;border-radius:0 8px 8px 0;padding:7px 10px;display:flex;gap:10px;flex-wrap:wrap")}>
                        <div style={c("flex:none;width:64px")}>
                          <div style={c("font-size:11px;font-weight:600")}>Góc máy</div>
                          <div style={c("font-family:'Space Grotesk',sans-serif;font-size:8px;letter-spacing:.13em;color:#8a7c67")}>CAMERA</div>
                        </div>
                        <div style={c("display:flex;flex-wrap:wrap;gap:6px 12px;flex:1")}>
                          <span style={c("font-size:11px;line-height:1.35")}><i style={c("font-style:normal;font-family:'Space Grotesk',sans-serif;font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#b06a16;display:block;margin-bottom:1px")}>Cỡ cảnh</i>{beat.size}</span>
                          <span style={c("font-size:11px;line-height:1.35")}><i style={c("font-style:normal;font-family:'Space Grotesk',sans-serif;font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#b06a16;display:block;margin-bottom:1px")}>Góc</i>{beat.angle}</span>
                          <span style={c("font-size:11px;line-height:1.35")}><i style={c("font-style:normal;font-family:'Space Grotesk',sans-serif;font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#b06a16;display:block;margin-bottom:1px")}>Chuyển động</i>{beat.move}</span>
                        </div>
                      </div>
                      <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr" : "1fr 1fr"};gap:0 20px`)}>
                        {(beat.matrix || []).map((mr, mi) => (
                          <div key={mi} style={c("display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px solid rgba(70,54,32,.1)")}>
                            <div style={c("flex:none;width:68px;line-height:1.1")}>
                              <b style={c("display:block;font-size:11px;font-weight:600")}>{mr.k}</b>
                              <span style={c("display:block;font-family:'Space Grotesk',sans-serif;font-size:8px;letter-spacing:.13em;color:#8a7c67")}>{mr.en}</span>
                            </div>
                            <div style={c("font-size:11px;color:#574a3a;line-height:1.4")}>{mr.v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* checklist */}
      <SectionHead tag="Checklist" title="7 điểm hiệu quả" />
      <div style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:16px;overflow:hidden;margin-bottom:32px")}>
        {a.checklist.map((row, i) => (
          <div key={i} style={c(`display:flex;gap:12px;align-items:flex-start;padding:13px 16px;border-bottom:1px solid rgba(70,54,32,.1);${isMobile ? "flex-wrap:wrap" : ""}`)}>
            <div style={c(`flex:none;${isMobile ? "width:100%" : "width:26%"};font-weight:600;font-size:13px`)}>{row.crit}</div>
            <div style={c("flex:none")}><span style={chipStyle(row.level)}>{row.levelLabel}</span></div>
            <div style={c(`flex:1;color:#574a3a;font-size:12.5px;line-height:1.5;${isMobile ? "width:100%" : ""}`)}>{row.note}</div>
          </div>
        ))}
      </div>

      {/* formulas */}
      <SectionHead tag="Công thức" title="Tái dùng" />
      <div style={c("display:flex;flex-direction:column;gap:12px;margin-bottom:12px")}>
        <div style={c("background:#f7f0e2;border:1px solid rgba(140,96,40,.22);border-left:3px solid #b06a16;border-radius:0 14px 14px 0;padding:16px 20px")}>
          <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#b06a16;margin-bottom:7px")}>Cấu trúc hình ảnh</div>
          <div style={c("font-size:14px;line-height:1.6;color:#2a2016")}>{a.formulaVisual}</div>
        </div>
        <div style={c("background:#f7f0e2;border:1px solid rgba(140,96,40,.22);border-left:3px solid #b06a16;border-radius:0 14px 14px 0;padding:16px 20px")}>
          <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#b06a16;margin-bottom:7px")}>Cấu trúc lời thoại</div>
          <div style={c("font-size:14px;line-height:1.6;color:#2a2016")}>{a.formulaScript}</div>
        </div>
      </div>
      <p style={c("color:#574a3a;font-size:14px;line-height:1.65;max-width:66ch;margin:0 0 32px")}>{a.verdictText}</p>

      {/* banks */}
      <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr" : "1fr 1fr"};gap:24px`)}>
        <Bank title="Kho lời thoại · 文案库" dot="#b06a16" items={a.quotes} />
        <Bank title="Kho hình ảnh · 画面库" dot="#3c7a5e" items={a.visuals} />
      </div>

      {/* đối chuẩn & góc mới */}
      {(a.objchuan || (a.newAngles && a.newAngles.length)) && (
        <div style={c("margin-top:32px")}>
          <SectionHead tag="Lắp Nonelab" title="Đối chuẩn & góc quay mới" />
          {a.objchuan && (
            <div style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.2);border-radius:14px;padding:14px 18px;margin-bottom:12px")}>
              <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(60,122,94,.12);color:#2f6b4f;margin-right:10px")}>Đối chuẩn: {a.objchuan.type}</span>
              <span style={c("font-size:13.5px;color:#574a3a")}>{a.objchuan.note}</span>
            </div>
          )}
          {a.newAngles && a.newAngles.length > 0 && <Bank title="Góc quay đẻ ra cho sản phẩm Nonelab" dot="#b06a16" items={a.newAngles} />}
        </div>
      )}

      {/* steals */}
      {a.steals && a.steals.length > 0 && (
        <div style={c("margin-top:32px")}>
          <SectionHead tag="Steal" title="Copy được ngay" />
          <div style={c("display:flex;flex-direction:column;gap:10px")}>
            {a.steals.map((s, i) => (
              <div key={i} style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:14px;padding:14px 18px")}>
                <div style={c("display:flex;gap:8px;align-items:baseline;margin-bottom:5px;flex-wrap:wrap")}>
                  <div style={c("font-family:'Fraunces',serif;font-size:15px;font-weight:600")}>{s.thuphap}</div>
                  {s.at && <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;color:#8a7c67")}>{s.at}</span>}
                </div>
                <div style={c("font-size:13px;color:#574a3a;line-height:1.5;margin-bottom:5px")}><b style={c("color:#9a5a12")}>Vì sao ăn: </b>{s.why}</div>
                <div style={c("font-size:13px;color:#574a3a;line-height:1.5")}><b style={c("color:#9a5a12")}>Cách áp dụng: </b>{s.how}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const GondolaPlaceholder = "gondola";


function Bank({ title, dot, items }: { title: string; dot: string; items: string[] }) {
  return (
    <div>
      <div style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b06a16;font-weight:600;margin-bottom:8px")}>{title}</div>
      <div style={c("display:flex;flex-direction:column")}>
        {items.map((q, i) => (
          <div key={i} style={c("position:relative;padding:10px 0 10px 24px;border-bottom:1px solid rgba(70,54,32,.1);font-size:13.5px;color:#574a3a;line-height:1.5")}>
            <span style={{ ...c("position:absolute;left:4px;top:17px;width:7px;height:7px;border-radius:50%"), background: dot }} />
            {q}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminView(props: any) {
  const { adminStats, adminUsers, integration, gemModels, onGemKey, onGemModel, toggleGemKey, testConnection, disconnectGem, onManage } = props;
  const connected = integration.connected;
  return (
    <div className="ns-fade">
      <div className="ns-rise" style={c("display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:26px")}>
        {adminStats.map((s: any, i: number) => (
          <div key={i} style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:16px;padding:20px 22px")}>
            <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;margin-bottom:10px")}>{s.label}</div>
            <div style={c("font-family:'Fraunces',serif;font-size:32px;font-weight:600;color:#9a5a12;line-height:1")}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Gemini integration */}
      <div style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:16px;padding:22px 24px;margin-bottom:22px")}>
        <div style={c("display:flex;align-items:center;gap:13px;margin-bottom:6px")}>
          <div style={c("width:40px;height:40px;border-radius:11px;flex:none;background:linear-gradient(150deg,#5a8de0,#3a5fc0);display:grid;place-items:center;font-size:20px;box-shadow:0 5px 14px rgba(58,95,192,.3)")}>✦</div>
          <div style={c("flex:1;min-width:0")}>
            <div style={c("font-family:'Fraunces',serif;font-size:19px;font-weight:600;letter-spacing:-.01em")}>Tích hợp AI · Google Gemini</div>
            <div style={c("font-size:12.5px;color:#8a7c67")}>Kết nối API key để Gemini XEM & mổ xẻ video bằng khung Nonelab</div>
          </div>
          <span style={{ ...c("display:inline-flex;align-items:center;gap:7px;font-family:'Space Grotesk',sans-serif;font-size:11.5px;font-weight:600;padding:5px 12px;border-radius:99px;flex:none"), background: connected ? "rgba(60,122,94,.13)" : "rgba(140,96,40,.1)", color: connected ? "#2f6b4f" : "#8a7c67", border: "1px solid " + (connected ? "rgba(60,122,94,.4)" : "rgba(140,96,40,.3)") }}>
            <span style={{ ...c("width:7px;height:7px;border-radius:50%"), background: connected ? "#3c7a5e" : "#b8a884" }} />
            {connected ? "Đã kết nối" : "Chưa kết nối"}
          </span>
        </div>
        <div style={c("display:grid;grid-template-columns:1fr 220px;gap:14px;margin-top:18px;align-items:end")}>
          <div>
            <label style={c("display:block;font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;margin-bottom:7px")}>API key</label>
            <div style={c("position:relative")}>
              <input className="ns-in" value={integration.key} onChange={(e: any) => onGemKey(e.target.value)} type={integration.showKey ? "text" : "password"} placeholder="AIzaSy…" style={c("width:100%;padding:12px 58px 12px 14px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fdfaf3;font-size:14px;font-family:'Space Grotesk',sans-serif;letter-spacing:.02em;transition:.2s")} />
              <span onClick={toggleGemKey} style={c("position:absolute;right:12px;top:50%;transform:translateY(-50%);font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600;color:#9a5a12;cursor:pointer")}>{integration.showKey ? "Ẩn" : "Hiện"}</span>
            </div>
          </div>
          <div>
            <label style={c("display:block;font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;margin-bottom:7px")}>Mô hình</label>
            <select value={integration.model} onChange={(e: any) => onGemModel(e.target.value)} style={c("width:100%;padding:12px 14px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fdfaf3;font-size:14px;cursor:pointer")}>
              {gemModels.map((m: string) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div style={c("display:flex;align-items:center;gap:10px;margin-top:16px")}>
          <button onClick={testConnection} style={c("padding:11px 20px;border:none;border-radius:11px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13.5px;cursor:pointer;box-shadow:0 5px 14px rgba(154,90,18,.26);display:inline-flex;align-items:center;gap:8px")}>
            {integration.testing && <span style={c("width:13px;height:13px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;display:inline-block;animation:ns-spin .8s linear infinite")} />}
            {integration.testing ? "Đang kiểm tra…" : connected ? "Kiểm tra lại" : "Kết nối"}
          </button>
          {connected && (
            <button onClick={disconnectGem} style={c("padding:11px 18px;border:1px solid rgba(140,96,40,.3);border-radius:11px;background:transparent;color:#574a3a;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13.5px;cursor:pointer")}>Ngắt kết nối</button>
          )}
          <span style={c("font-size:12px;color:#8a7c67;margin-left:4px")}>Key lưu cục bộ trên trình duyệt · lấy tại Google AI Studio</span>
        </div>
      </div>

      <div style={c("font-family:'Space Grotesk',sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;font-weight:600;margin-bottom:12px")}>Người dùng & phân quyền</div>
      <div style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:16px;overflow:hidden")}>
        <div style={c("display:grid;grid-template-columns:2fr 1fr 1fr 1fr 40px;gap:14px;padding:13px 20px;border-bottom:1px solid rgba(140,96,40,.18);font-family:'Space Grotesk',sans-serif;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;font-weight:600")}>
          <div>Người dùng</div><div>Vai trò</div><div>Phân tích</div><div>Trạng thái</div><div />
        </div>
        {adminUsers.map((u: AdminUser, i: number) => (
          <div key={i} style={c("display:grid;grid-template-columns:2fr 1fr 1fr 1fr 40px;gap:14px;padding:14px 20px;border-bottom:1px solid rgba(70,54,32,.1);align-items:center")}>
            <div style={c("display:flex;align-items:center;gap:11px;min-width:0")}>
              <div style={{ ...c("width:34px;height:34px;border-radius:50%;flex:none;color:#fff;display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:13px"), background: u.avBg }}>{(u.name[0] || "?").toUpperCase()}</div>
              <div style={c("min-width:0")}>
                <div style={c("font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{u.name}</div>
                <div style={c("font-size:11.5px;color:#8a7c67;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{u.email}</div>
              </div>
            </div>
            <div style={c("font-size:13px;color:#574a3a")}>{u.role}</div>
            <div style={c("font-size:13px;color:#574a3a")}>{u.count}</div>
            <div>
              <span style={{ ...c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px"), background: u.active ? "rgba(60,122,94,.13)" : "rgba(140,96,40,.1)", color: u.active ? "#2f6b4f" : "#8a7c67", border: "1px solid " + (u.active ? "rgba(60,122,94,.4)" : "rgba(140,96,40,.3)") }}>{u.active ? "Hoạt động" : "Tạm khoá"}</span>
            </div>
            <div onClick={() => onManage(i)} title="Phân quyền" style={c("text-align:center;cursor:pointer;color:#9a5a12;font-size:15px")}>⚙</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PermissionModal(props: {
  draft: AdminUser;
  roleList: string[];
  permDefs: [keyof Perms, string, string][];
  onRole: (r: string) => void;
  onToggle: (k: keyof Perms) => void;
  onToggleActive: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, roleList, permDefs, onRole, onToggle, onToggleActive, onClose, onSave } = props;
  return (
    <div onClick={onClose} style={c("position:fixed;inset:0;z-index:60;background:rgba(36,26,16,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px")}>
      <div onClick={(e) => e.stopPropagation()} className="ns-pop" style={c("width:100%;max-width:500px;background:#fffdf8;border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(36,26,16,.4)")}>
        <div style={c("padding:24px 28px;border-bottom:1px solid rgba(140,96,40,.14);display:flex;align-items:center;gap:14px")}>
          <div style={{ ...c("width:46px;height:46px;border-radius:50%;flex:none;color:#fff;display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:17px"), background: draft.avBg }}>{(draft.name[0] || "?").toUpperCase()}</div>
          <div style={c("min-width:0;flex:1")}>
            <div style={c("font-family:'Fraunces',serif;font-size:20px;font-weight:600;letter-spacing:-.01em")}>{draft.name}</div>
            <div style={c("font-size:12.5px;color:#8a7c67;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{draft.email}</div>
          </div>
          <span onClick={onClose} style={c("cursor:pointer;color:#8a7c67;font-size:20px;padding:4px")}>✕</span>
        </div>
        <div style={c("padding:22px 28px")}>
          <div style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;font-weight:600;margin-bottom:10px")}>Vai trò</div>
          <div style={c("display:flex;gap:7px;flex-wrap:wrap;margin-bottom:24px")}>
            {roleList.map((r) => {
              const on = draft.role === r;
              return (
                <div key={r} onClick={() => onRole(r)} style={{ ...c("padding:8px 15px;border-radius:10px;font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:.16s"), background: on ? "linear-gradient(150deg,#c07c1e,#9a5a12)" : "#fff", color: on ? "#fff" : "#574a3a", border: "1px solid " + (on ? "transparent" : "rgba(140,96,40,.28)") }}>{r}</div>
              );
            })}
          </div>

          <div style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;font-weight:600;margin-bottom:10px")}>Quyền hạn</div>
          <div style={c("display:flex;flex-direction:column;gap:9px;margin-bottom:22px")}>
            {permDefs.map(([k, lbl, desc]) => {
              const on = !!draft.perms[k];
              return (
                <div key={k} onClick={() => onToggle(k)} style={{ ...c("display:flex;align-items:center;gap:13px;padding:12px 15px;border-radius:12px;border:1px solid rgba(140,96,40,.16);cursor:pointer;transition:.16s"), background: on ? "rgba(60,122,94,.06)" : "#fdfaf3" }}>
                  <div style={c("flex:1;min-width:0")}>
                    <div style={c("font-size:14px;font-weight:600;color:#2a2016")}>{lbl}</div>
                    <div style={c("font-size:12px;color:#8a7c67;line-height:1.4")}>{desc}</div>
                  </div>
                  <Toggle on={on} />
                </div>
              );
            })}
          </div>

          <div onClick={onToggleActive} style={c("display:flex;align-items:center;gap:13px;padding:12px 15px;border-radius:12px;border:1px solid rgba(140,96,40,.16);background:#fdfaf3;cursor:pointer;margin-bottom:22px")}>
            <div style={c("flex:1")}>
              <div style={c("font-size:14px;font-weight:600")}>Trạng thái tài khoản</div>
              <div style={c("font-size:12px;color:#8a7c67")}>Tạm khoá để chặn đăng nhập</div>
            </div>
            <Toggle on={draft.active} />
          </div>

          <div style={c("display:flex;gap:10px")}>
            <button onClick={onSave} style={c("flex:1;padding:13px;border:none;border-radius:11px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 6px 16px rgba(154,90,18,.28)")}>Lưu phân quyền</button>
            <button onClick={onClose} style={c("padding:13px 18px;border:1px solid rgba(140,96,40,.3);border-radius:11px;background:transparent;color:#574a3a;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:pointer")}>Huỷ</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <div style={{ ...c("position:relative;width:38px;height:22px;border-radius:99px;flex:none;transition:.18s"), background: on ? "#3c7a5e" : "rgba(140,96,40,.22)" }}>
      <div style={{ ...c("position:absolute;top:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:.18s"), left: on ? "18px" : "2px" }} />
    </div>
  );
}

function ExportModal({ filename, size, onClose, onDownload, onCopy }: { filename: string; size: string; onClose: () => void; onDownload: () => void; onCopy: () => void }) {
  return (
    <div onClick={onClose} style={c("position:fixed;inset:0;z-index:60;background:rgba(36,26,16,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px")}>
      <div onClick={(e) => e.stopPropagation()} className="ns-pop" style={c("width:100%;max-width:460px;background:#fffdf8;border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(36,26,16,.4)")}>
        <div style={c("padding:26px 28px 20px")}>
          <div style={c("font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.2em;font-size:10.5px;color:#b06a16;font-weight:600;margin-bottom:10px")}>Xuất phiếu mổ xẻ</div>
          <div style={c("font-family:'Fraunces',serif;font-size:24px;font-weight:600;margin-bottom:6px;letter-spacing:-.01em")}>Tải file HTML độc lập</div>
          <p style={c("color:#8a7c67;font-size:13.5px;margin:0 0 18px;line-height:1.55")}>File .html tự chứa toàn bộ phiếu mổ xẻ — mở được offline, gửi cho team hay đính kèm tài liệu nội bộ.</p>
          <div style={c("background:#f7f0e2;border:1px solid rgba(140,96,40,.2);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:13px;margin-bottom:20px")}>
            <div style={c("width:42px;height:42px;border-radius:10px;background:linear-gradient(150deg,#e0a64e,#b06a16);display:grid;place-items:center;font-size:20px;flex:none")}>📄</div>
            <div style={c("min-width:0")}>
              <div style={c("font-family:'Space Grotesk',sans-serif;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{filename}</div>
              <div style={c("font-size:11.5px;color:#8a7c67")}>HTML · ~{size} · UTF-8</div>
            </div>
          </div>
          <div style={c("display:flex;gap:10px")}>
            <button onClick={onDownload} style={c("flex:1;padding:13px;border:none;border-radius:11px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 6px 16px rgba(154,90,18,.28)")}>⬇ Tải file .html</button>
            <button onClick={onCopy} style={c("padding:13px 18px;border:1px solid rgba(140,96,40,.3);border-radius:11px;background:transparent;color:#574a3a;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:pointer")}>⧉ Sao chép</button>
          </div>
        </div>
      </div>
    </div>
  );
}
