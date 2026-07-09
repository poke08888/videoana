import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { css as c } from "./lib/csx";
import { decorate, makeEntry, presetPerms, scoreOf, seedUsers, slug } from "./lib/analysis";
import { buildReportHTML } from "./lib/reportHtml";
import { buildRaw, seedDates, seedForms } from "./data/sampleAnalysis";
import { analyzeVideo, analyzeVideoBatch, testGemini, authHeaders, importAds, listCohorts, getCohort, finalizeCohort, getKnowledge, saveKnowledge, getHistoryItem, startCampaignSearch, getCampaignJob, getActiveCampaignJobs, discardCampaignJob, stopCampaignSearch, createCampaign, getMe, synthesizeReports, listSyntheses, getSynthesis, deleteSynthesis, seedFramePart, saveSeedFrame, listSeedFrames, getSeedFrame, deleteSeedFrame } from "./lib/api";
import type { SeedFrameFormInput } from "./lib/api";
import { embedFrames } from "./lib/frames";
import type { AdminUser, Analysis, FormState, HistoryEntry, Level, Perms, Screen, User } from "./types";

const STAGES = [
  "Trích khung hình & phân cảnh",
  "Nhận diện sản phẩm & gương mặt",
  "Bóc tách lời thoại song ngữ",
  "Chấm theo khung Năm Lực",
  "Tổng hợp phiếu phân tích",
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

/* ── VideoFrame: hiển thị frame thật của video ──
 * Ưu tiên `frame` (ảnh đã lưu kèm phiếu) để hiển thị được ở mọi nơi (lịch sử,
 * link chia sẻ, HTML xuất). Nếu chưa có frame lưu sẵn nhưng có File trực tiếp
 * (vừa phân tích) thì trích bằng Canvas. Cuối cùng mới là placeholder. */
function VideoFrame({ file, ts, frame, width = 86, height = 150 }: { file: File | null; ts: string; frame?: string; width?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (frame || !file || !canvasRef.current) return;
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
  }, [file, ts, frame]);

  const showImg = !!frame;
  return (
    <div style={c(`position:relative;flex:none;width:${width}px;height:${height}px;border-radius:10px;overflow:hidden;border:1px solid rgba(140,96,40,.22);background:linear-gradient(150deg,#e7d4b0,#c9a86f 55%,#a07c44)`)}>
      {showImg && <img src={frame} alt={ts} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", objectFit: "cover", display: !showImg && ready ? "block" : "none" }} />
      {!showImg && !ready && <span style={c("position:absolute;inset:0;display:grid;place-items:center;font-size:24px;opacity:.55")}>🎬</span>}
      <span style={c("position:absolute;left:0;bottom:0;font-family:'Space Grotesk',sans-serif;font-size:9px;font-weight:600;background:#b06a16;color:#fff;padding:1px 5px;border-top-right-radius:6px;letter-spacing:.04em")}>{ts}</span>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("auth");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [user, setUser] = useState<User | null>(null);
  const [auth, setAuth] = useState({ email: "", pass: "", name: "" });

  const [form, setForm] = useState<FormState>({ title: "", platform: "TikTok / Douyin", product: "", genre: "Reviewer độc thoại (Vlog + Test)", notes: "", file: "" });
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [currentReportId, setCurrentReportId] = useState<string>("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");

  // Báo cáo tổng hợp lý do thành công (từ các phiếu tick chọn ở Lịch sử).
  const [synthesisReport, setSynthesisReport] = useState<any>(null);
  const [synthesizing, setSynthesizing] = useState(false);

  const [progress, setProgress] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [analyzeNote, setAnalyzeNote] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const isMobile = useIsMobile();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
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

  // load saved Gemini integration & database history
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

    try {
      const savedUser = localStorage.getItem("nonelab_user");
      if (savedUser) {
        const u = JSON.parse(savedUser);
        setUser(u);
        setScreen("dashboard");
        // Đồng bộ role/perms mới nhất từ server (admin có thể đã đổi quyền sau
        // khi user đăng nhập) — cập nhật ngay, không cần đăng nhập lại.
        getMe().then((r) => {
          if (r?.ok && r.user) {
            setUser(r.user);
            localStorage.setItem("nonelab_user", JSON.stringify(r.user));
            if (r.token) localStorage.setItem("nonelab_token", r.token);
          } else if (r?.error === "inactive" || r?.status === 401) {
            // Tài khoản bị khóa hoặc token đã hết hạn/không hợp lệ → đăng xuất
            // (nếu không, UI trông như đang đăng nhập nhưng mọi API đều 401).
            setUser(null);
            localStorage.removeItem("nonelab_user");
            localStorage.removeItem("nonelab_token");
            setScreen("auth");
          }
        }).catch(() => {});
      }
    } catch { }

  }, []);

  // Tải danh sách user (admin) + lịch sử sau khi đã đăng nhập (cần token).
  useEffect(() => {
    if (!user) return;
    if (user.perms?.manage) {
      fetch("/api/admin/users", { headers: authHeaders() })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) setAdminUsers(data);
        })
        .catch(() => {});
    }
    fetch("/api/history", { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setHistory(data);
      })
      .catch((err) => console.error("Lỗi lấy lịch sử SQLite:", err));
  }, [user]);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [screen, analysis]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2800);
  }
  const go = (s: Screen) => {
    setScreen(s);
  };
  const setFormPatch = (patch: Partial<FormState>) => setForm((s) => ({ ...s, ...patch }));
  const setAuthPatch = (patch: Partial<typeof auth>) => setAuth((s) => ({ ...s, ...patch }));

  function saveIntegration(patch: Partial<typeof integration>) {
    setIntegration((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem("nonelab_gemini", JSON.stringify({ key: next.key, model: next.model, connected: next.connected }));
      } catch { }
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

  function pickFiles(files: File[]) {
    if (!files.length) return;
    setSelectedFiles(files);
    setFormPatch({ file: files.length === 1 ? files[0].name : `Đã chọn ${files.length} video` });
  }
  function triggerFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "video/mp4,video/*";
    inp.multiple = true;
    inp.onchange = () => {
      if (inp.files && inp.files.length) {
        pickFiles(Array.from(inp.files));
      }
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
    if (e.dataTransfer?.files?.length) {
      pickFiles(Array.from(e.dataTransfer.files));
    }
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
    // Tách nhiều link TikTok/Douyin (mỗi dòng 1 link) — backend tự nhận diện nền tảng.
    const tiktokLinks = tiktokUrl.split(/\r?\n/).map((s) => s.trim()).filter((s) => /tiktok\.com|douyin\.com/i.test(s));

    if (selectedFiles.length === 0 && tiktokLinks.length === 0 && !youtubeUrl) {
      showToast("Hãy tải video .mp4 lên hoặc dán link TikTok/Douyin để phân tích");
      return;
    }

    // Nhiều nguồn (>1 video/file) HOẶC có link dán vào -> đẩy vào Hàng đợi nền.
    // Link luôn đi hàng đợi vì luồng đồng bộ (tải video + Gemini) dễ vượt ~100s
    // → Cloudflare tunnel cắt kết nối (524); hàng đợi còn tự retry khi Gemini bận.
    const totalSources = selectedFiles.length + tiktokLinks.length;
    if (totalSources > 1 || tiktokLinks.length > 0) {
      setAnalyzeError(null);
      showToast(`Đang đưa ${totalSources} video vào hàng đợi...`);
      try {
        const r = await analyzeVideoBatch({
          form: { title: f.title, platform: f.platform, product: f.product, genre: f.genre, notes: f.notes },
          files: selectedFiles,
          tiktokUrls: tiktokLinks,
          apiKey: integration.key || undefined,
          model: integration.model,
          email: user?.email || undefined,
        });

        if (r.ok) {
          showToast(r.message || `Đã đẩy ${totalSources} video vào hàng đợi thành công!`);

          // Lấy lại danh sách lịch sử mới để hiển thị tiến trình
          const res = await fetch("/api/history", { headers: authHeaders() });
          const data = await res.json();
          if (Array.isArray(data)) {
            setHistory(data);
          }

          setSelectedFiles([]);
          setTiktokUrl("");
          setFormPatch({ file: "" });
          setScreen("history");
        } else {
          showToast(r.message || "Không thể đưa video vào hàng đợi.");
        }
      } catch (err) {
        console.error(err);
        showToast("Lỗi kết nối khi đăng ký hàng loạt video.");
      }
      return;
    }

    // Tiến trình phân tích ĐƠN LẺ đồng bộ nguyên bản (1 nguồn duy nhất)
    const singleFile = selectedFiles[0] || null;
    const singleTiktok = tiktokLinks[0] || "";
    setAnalyzeError(null);
    setScreen("analyzing");
    setProgress(6);
    setStageIdx(0);
    setAnalyzeNote(singleTiktok ? (/douyin\.com/i.test(singleTiktok) ? "Đang tải video Douyin về…" : "Đang tải video TikTok về…") : (singleFile || youtubeUrl ? "Gemini đang xem video…" : "Suy luận từ mô tả…"));
    if (ivRef.current) clearInterval(ivRef.current);
    ivRef.current = setInterval(progressTick, 340);

    try {
      const r = await analyzeVideo({
        form: { title: f.title, platform: f.platform, product: f.product, genre: f.genre, notes: f.notes },
        file: singleFile,
        youtubeUrl: youtubeUrl || undefined,
        tiktokUrl: singleTiktok || undefined,
        apiKey: integration.key || undefined,
        model: integration.model,
        email: user?.email || undefined,
      });

      if (ivRef.current) clearInterval(ivRef.current);

      if (r.ok && r.analysis) {
        const result = decorate(r.analysis, f);
        // Trích frame thật từ video và nhúng vào phiếu để LƯU LẠI (hiển thị trong
        // lịch sử, link chia sẻ, HTML xuất ra — không chỉ ngay sau khi phân tích).
        if (singleFile) {
          setAnalyzeNote("Đang trích khung hình thật từ video…");
          await embedFrames(singleFile, result);
        }
        setProgress(100);
        setStageIdx(STAGES.length - 1);
        await sleep(520);
        const entry = makeEntry(result, f, "Vừa xong");
        setAnalysis(result);
        setCurrentReportId(entry.id);
        setHistory((h) => [entry, ...h]);

        // Save to database
        fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(entry),
        }).catch((err) => console.error("Lưu lịch sử lỗi:", err));

        setScreen("report");
        showToast(r.watchedVideo ? "Phân tích hoàn tất — Gemini đã xem video" : "Phân tích hoàn tất bằng Gemini (từ mô tả)");
      } else {
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
        title: "Lỗi kết nối",
        detail: err.message || "Không kết nối được tới máy chủ.",
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
    link.download = "phieu-phan-tich-" + slug(a.meta.product || a.subtitle) + ".html";
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

  const navDef: { key: Screen; label: string; sub: string }[] = [
    { key: "dashboard", label: "Bảng điều khiển", sub: "Tổng quan hoạt động phân tích video" },
    { key: "upload", label: "Phân tích video mới", sub: "Tải video & nhập thông tin để AI phân tích" },
    { key: "ads", label: "Phân tích chỉ số", sub: "Import Excel chỉ số ads & rút kết luận content" },
    { key: "campaign", label: "Campaign từ khóa", sub: "Tìm video TikTok theo từ khóa + tương tác → điểm chung video viral" },
    { key: "seedframe", label: "Khung hạt giống", sub: "Bản đồ content từ điểm mạnh sản phẩm — 5 khối theo phương pháp hạt giống" },
    { key: "history", label: "Lịch sử phân tích", sub: "Tất cả phiếu phân tích đã tạo" },
    { key: "admin", label: "Quản trị", sub: "Quản lý tài khoản & Cài đặt API key" },
  ];
  const titles: Record<string, [string, string]> = {
    dashboard: ["Bảng điều khiển", "Tổng quan hoạt động phân tích video"],
    upload: ["Phân tích video mới", "Tải video & nhập thông tin để AI phân tích"],
    ads: ["Phân tích chỉ số", "Import Excel chỉ số ads → kết luận content nào có chỉ số tốt"],
    campaign: ["Campaign từ khóa", "Tìm video TikTok theo từ khóa + tương tác → điểm chung video viral"],
    seedframe: ["Khung hạt giống", "Điểm mạnh sản phẩm → bản đồ content 5 khối + đối chuẩn 3 ngôn ngữ + kế hoạch test"],
    report: ["Phiếu phân tích", "Kết quả phân tích theo khung Năm Lực"],
    history: ["Lịch sử phân tích", "Tất cả phiếu phân tích đã tạo"],
    synthesis: ["Báo cáo tổng hợp", "Điểm chung lý do thành công của các video đã chọn"],
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

  const avgScore = history.length ? Math.round(history.reduce((a, b) => a + (b.score || 0), 0) / history.length) : 0;
  const topPlatform = history.length ? "TikTok" : "Chưa có dữ liệu";

  const labels = {
    dashboard: [
      { label: "Video đã phân tích", value: String(history.length), sub: "tổng số phiếu" },
      { label: "Điểm số trung bình", value: String(avgScore), sub: "trên thang 100" },
      { label: "Nền tảng chính", value: topPlatform, sub: "được chạy nhiều nhất" },
    ],
    perms: [
      ["analyze", "Tạo phân tích video", "Tải video lên và chạy phân tích bằng AI"],
      ["export", "Xuất file HTML", "Tải / sao chép phiếu phân tích ra .html"],
      ["history", "Lịch sử toàn hệ thống", "Xem phiếu phân tích của mọi thành viên"],
      ["manage", "Quản trị viên", "Cấp quyền thành viên và thay đổi API Key"],
    ],
  };

  const adminStats = [
    { label: "Tổng người dùng", value: String(adminUsers.length) },
    { label: "Đang hoạt động", value: String(adminUsers.filter((x) => x.active).length) },
    { label: "Phân tích / tháng", value: String(adminUsers.reduce((t, x) => t + x.count, 0)) },
  ];

  const roleList = ["Quản trị", "Biên tập", "Cộng tác", "Khách"];

  const openReport = (h: HistoryEntry) => {
    setAnalysis(h.analysis);
    setCurrentReportId(h.id);
    setScreen("report");
  };

  // Phân tích lại 1 phiếu lỗi: file gốc đã bị xóa nên đưa người dùng về màn
  // tải lên với thông tin đã điền sẵn để chọn lại video / dán lại link.
  const reanalyzeEntry = (h: HistoryEntry) => {
    setFormPatch({ title: h.title, platform: h.platform, product: h.product });
    setSelectedFiles([]);
    // Phiếu có link video gốc (kể cả phiếu LỖI — link được giữ lại) → điền sẵn
    // link để bấm phân tích lại ngay, không phải tìm lại.
    const src = String((h.analysis as any)?.sourceUrl || "").trim();
    const isLinkVideo = /tiktok\.com|douyin\.com/i.test(src);
    setTiktokUrl(isLinkVideo ? src : "");
    setYoutubeUrl(src && !isLinkVideo ? src : "");
    setFormPatch({ file: "" });
    setAnalyzeError(null);
    setScreen("upload");
    showToast(src ? "Đã điền sẵn link video gốc — bấm Bắt đầu phân tích" : "Chọn lại video (hoặc dán link) để phân tích lại phiếu này");
  };

  // Tổng hợp lý do thành công từ các phiếu đã tick chọn ở màn Lịch sử.
  const synthesizeSelected = async (ids: string[]) => {
    if (synthesizing) return;
    if (ids.length < 2) {
      showToast("Tick chọn ít nhất 2 video đã phân tích xong để tổng hợp");
      return;
    }
    setSynthesizing(true);
    showToast(`Đang tổng hợp ${ids.length} phiếu — Gemini đang đúc điểm chung…`);
    const r = await synthesizeReports({ ids, apiKey: integration.key || undefined, model: integration.model });
    setSynthesizing(false);
    if (r.ok) {
      setSynthesisReport(r);
      setScreen("synthesis");
      window.scrollTo({ top: 0 });
    } else {
      showToast(r.message || "Không tổng hợp được — thử lại sau.");
    }
  };

  // Mở lại 1 báo cáo tổng hợp đã lưu.
  const openSynthesis = async (id: string) => {
    const r = await getSynthesis(id);
    if (r.ok) {
      setSynthesisReport(r);
      setScreen("synthesis");
      window.scrollTo({ top: 0 });
    } else showToast("Không mở được báo cáo tổng hợp.");
  };

  const shareReport = () => {
    if (!currentReportId) return;
    const shareUrl = `${window.location.protocol}//${window.location.hostname}/share/${currentReportId}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => showToast("Đã sao chép link chia sẻ công khai!"))
      .catch(() => showToast("Không sao chép được link. Link: " + shareUrl));
  };

  const dropTitle = selectedFiles.length > 0
    ? (selectedFiles.length === 1 ? selectedFiles[0].name : `Đã chọn ${selectedFiles.length} video`)
    : "Kéo thả một hoặc nhiều video .mp4 vào đây";
  const dropSub = selectedFiles.length > 0 
    ? "Đã chọn — bấm để đổi file khác" 
    : "hoặc bấm để chọn từ máy · tối đa 200MB/file";
  const dropBorder = dragOver ? "#b06a16" : "rgba(140,96,40,.4)";
  const dropBg = dragOver ? "rgba(176,106,22,.08)" : "#fdfaf3";

  const label = (extra?: string): CSSProperties =>
    c("display:block;font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;margin-bottom:7px" + (extra ? ";" + extra : ""));

  // Buộc đổi mật khẩu mặc định: hỏi mật khẩu mới rồi gọi /api/auth/change-password.
  const forceChangePassword = async (currentPassword: string): Promise<boolean> => {
    const newPass = window.prompt(
      "Tài khoản đang dùng mật khẩu khởi tạo. Vui lòng nhập MẬT KHẨU MỚI (≥ 6 ký tự) để tiếp tục:"
    );
    if (!newPass) {
      showToast("Bạn cần đổi mật khẩu để tiếp tục đăng nhập.");
      localStorage.removeItem("nonelab_token");
      return false;
    }
    if (newPass.length < 6) {
      showToast("Mật khẩu mới phải từ 6 ký tự trở lên.");
      localStorage.removeItem("nonelab_token");
      return false;
    }
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ currentPassword, newPassword: newPass }),
      });
      const d = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !d.ok) {
        showToast(d.message || "Đổi mật khẩu thất bại.");
        localStorage.removeItem("nonelab_token");
        return false;
      }
      showToast("Đã đổi mật khẩu thành công.");
      return true;
    } catch {
      showToast("Lỗi kết nối khi đổi mật khẩu.");
      localStorage.removeItem("nonelab_token");
      return false;
    }
  };

  const submitAuth = async () => {
    if (!auth.email || auth.email.indexOf("@") < 0) {
      showToast("Nhập email hợp lệ để tiếp tục");
      return;
    }
    if (!auth.pass || auth.pass.length < 6) {
      showToast("Mật khẩu phải từ 6 ký tự trở lên");
      return;
    }

    try {
      const endpoint = authMode === "signup" ? "/api/auth/register" : "/api/auth/login";
      const payload = authMode === "signup" 
        ? { email: auth.email, password: auth.pass, name: auth.name }
        : { email: auth.email, password: auth.pass };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.message || "Xác thực thất bại");
        return;
      }

      if (data.ok && data.user) {
        if (!data.user.active) {
          showToast("Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ Quản trị viên.");
          return;
        }
        if (data.token) localStorage.setItem("nonelab_token", data.token);

        // Buộc đổi mật khẩu mặc định trước khi vào hệ thống.
        if (data.mustChangePassword) {
          const changed = await forceChangePassword(auth.pass);
          if (!changed) return; // người dùng hủy hoặc đổi thất bại
        }

        setUser(data.user);
        localStorage.setItem("nonelab_user", JSON.stringify(data.user));
        setScreen("dashboard");
        showToast(authMode === "signup" ? "Đăng ký thành công!" : "Chào mừng trở lại Nonelab Studio");
      }
    } catch (err) {
      console.error(err);
      showToast("Lỗi kết nối tới máy chủ");
    }
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
                <h1 style={c("font-family:'Fraunces',serif;font-weight:900;font-size:clamp(34px,4.4vw,60px);line-height:1.0;letter-spacing:-.02em;margin:0 0 18px")}>Phân tích mọi <span style={c("font-style:italic;font-weight:400;color:#e8bd72")}>thước phim</span> viral.</h1>
                <p style={c("max-width:42ch;color:#cdbfa6;font-size:16px;line-height:1.65;margin:0")}>Tải video lên, AI bóc tách storyboard, lời thoại song ngữ và chấm theo khung Năm Lực — rồi xuất thành phiếu phân tích HTML chỉ trong một cú nhấp.</p>
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
              <p style={c("color:#8a7c67;font-size:14px;margin:0 0 24px;line-height:1.45")}>{isSignup ? "Bắt đầu phân tích video chỉ trong vài phút." : "Tiếp tục phân tích những thước phim viral."}</p>

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
            <div style={c("font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.3em;font-size:11px;color:#b06a16;font-weight:600;margin-bottom:10px")}>Đang phân tích video</div>
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
  const userRoleLabel = user ? user.role : "";

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
              if (it.key === "history" && !user?.perms?.history) return null;
              if (it.key === "admin" && !user?.perms?.manage) return null;
              // Phân tích chỉ số, Campaign từ khóa & Khung hạt giống: chỉ Biên tập và Quản trị.
              if ((it.key === "ads" || it.key === "campaign" || it.key === "seedframe") && !(user?.role === "Quản trị" || user?.role === "Biên tập")) return null;
              const on = screen === it.key;
              const icons: Record<string, string> = {
                dashboard: "◇",
                upload: "＋",
                ads: "📈",
                campaign: "🔍",
                seedframe: "🌱",
                report: "📊",
                history: "≡",
                admin: "⚙"
              };
              return (
                <div key={it.key} onClick={() => { go(it.key); closeMobileNav(); }} style={{ ...c("display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:11px;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:14px;transition:.18s"), fontWeight: on ? 600 : 500, color: on ? "#9a5a12" : "#574a3a", background: on ? "rgba(176,106,22,.12)" : "transparent" }}>
                  <span style={c("font-size:17px;width:20px;text-align:center")}>{icons[it.key] || "◇"}</span>
                  {it.label}
                </div>
              );
            })}
            {user?.perms?.analyze && (
              <button onClick={() => { setScreen("upload"); closeMobileNav(); }} style={c("margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:none;border-radius:12px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 6px 16px rgba(154,90,18,.28)")}>＋ Phân tích mới</button>
            )}
          </nav>
          <div style={c("padding:14px;border-top:1px solid rgba(140,96,40,.12)")}>
            <div style={c("display:flex;align-items:center;gap:11px;padding:8px 6px")}>
              <div style={c("width:36px;height:36px;border-radius:50%;background:linear-gradient(150deg,#3c7a5e,#2a5a44);color:#fff;display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px")}>{userInitial}</div>
              <div style={c("min-width:0;flex:1")}>
                <div style={c("font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{userName}</div>
                <div style={c("font-size:11px;color:#8a7c67")}>{userRoleLabel}</div>
              </div>
              <span onClick={() => { setUser(null); localStorage.removeItem("nonelab_user"); localStorage.removeItem("nonelab_token"); setScreen("auth"); setAuth({ email: "", pass: "", name: "" }); closeMobileNav(); }} title="Đăng xuất" style={c("cursor:pointer;color:#8a7c67;font-size:16px;padding:4px")}>⎋</span>
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
                  {user?.perms?.export && (
                      <button onClick={() => setExportOpen(true)} style={c("padding:9px 14px;border:none;border-radius:10px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13px;cursor:pointer;box-shadow:0 5px 14px rgba(154,90,18,.26)")}>⬇ {isMobile ? "" : "Xuất HTML"}</button>
                  )}
                  <button onClick={shareReport} style={c("padding:9px 14px;border:1px solid rgba(140,96,40,.3);border-radius:10px;background:#fffdf8;color:#574a3a;font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:13px;cursor:pointer")}>🔗 {isMobile ? "" : "Chia sẻ link"}</button>
                </>
              )}
            </div>
          </div>

          <div style={c(`padding:${isMobile ? "16px 16px 90px" : "30px 34px 60px"}`)}>
            {screen === "dashboard" && <Dashboard stats={labels.dashboard} recent={history.slice(0, 3)} onOpen={openReport} onAll={() => go("history")} isMobile={isMobile} />}
            {screen === "history" && <HistoryView history={history} onOpen={openReport} onReanalyze={reanalyzeEntry} showToast={showToast} isAdmin={user?.role === "Quản trị"} onSynthesize={synthesizeSelected} synthesizing={synthesizing} onOpenSynthesis={openSynthesis} />}
            {screen === "synthesis" && synthesisReport && <SynthesisView data={synthesisReport} isMobile={isMobile} onBack={() => go("history")} />}
            {screen === "upload" && (
              <UploadView
                form={form}
                setFormPatch={setFormPatch}
                youtubeUrl={youtubeUrl}
                setYoutubeUrl={setYoutubeUrl}
                tiktokUrl={tiktokUrl}
                setTiktokUrl={setTiktokUrl}
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
            {screen === "ads" && <AdsView isMobile={isMobile} integration={integration} showToast={showToast} onOpenReport={openReport} isAdmin={user?.role === "Quản trị"} />}
            {screen === "campaign" && <CampaignView isMobile={isMobile} integration={integration} showToast={showToast} onOpenReport={openReport} isAdmin={user?.role === "Quản trị"} />}
            {screen === "seedframe" && <SeedFrameView isMobile={isMobile} integration={integration} showToast={showToast} isAdmin={user?.role === "Quản trị"} canExport={!!user?.perms?.export} />}
            {screen === "report" && a && <ReportView a={a} metaList={metaList} videoFile={selectedFiles[0] || null} isMobile={isMobile} />}
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
            if (it.key === "history" && !user?.perms?.history) return null;
            if (it.key === "admin" && !user?.perms?.manage) return null;
            if (it.key === "seedframe" && !(user?.role === "Quản trị" || user?.role === "Biên tập")) return null;
            const on = screen === it.key;
            const icons: Record<string, string> = {
              dashboard: "◇",
              upload: "＋",
              seedframe: "🌱",
              report: "📊",
              history: "≡",
              admin: "⚙"
            };
            return (
              <button key={it.key} onClick={() => { go(it.key); closeMobileNav(); }} style={{ ...c("flex:1;border:none;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;border-radius:10px;transition:.15s"), color: on ? "#9a5a12" : "#8a7c67" }}>
                <span style={{ fontSize: 20 }}>{icons[it.key] || "◇"}</span>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 10, fontWeight: on ? 700 : 500 }}>{it.label}</span>
              </button>
            );
          })}
          {user?.perms?.analyze && (
            <button onClick={() => { setScreen("upload"); closeMobileNav(); }} style={c("flex:none;width:50px;border:none;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;border-radius:12px;margin:6px 4px;cursor:pointer;font-size:22px;display:grid;place-items:center;box-shadow:0 4px 14px rgba(154,90,18,.35)")}>＋</button>
          )}
        </nav>
      )}

      {/* PERMISSION MODAL */}
      {permDraft && (
        <PermissionModal
          draft={permDraft}
          roleList={roleList}
          permDefs={labels.perms as [keyof Perms, string, string][]}
          onRole={(r) => setPermDraft((s) => (s ? { ...s, role: r, perms: presetPerms(r) } : s))}
          onToggle={(k) => setPermDraft((s) => (s ? { ...s, perms: { ...s.perms, [k]: !s.perms[k] } } : s))}
          onToggleActive={() => setPermDraft((s) => (s ? { ...s, active: !s.active } : s))}
          onClose={() => { setPermIndex(null); setPermDraft(null); }}
          onSave={async () => {
            const i = permIndex;
            const draft = permDraft;
            if (draft) {
              try {
                const res = await fetch("/api/admin/users/update", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...authHeaders() },
                  body: JSON.stringify({
                    email: draft.email,
                    role: draft.role,
                    active: draft.active ? 1 : 0,
                    perms: draft.perms
                  })
                });
                if (res.ok) {
                  setAdminUsers((us) => us.map((x, j) => (j === i ? { ...draft } : x)));
                  if (user && user.email === draft.email) {
                    const updatedUser = { ...user, role: draft.role, perms: draft.perms };
                    setUser(updatedUser);
                    localStorage.setItem("nonelab_user", JSON.stringify(updatedUser));
                  }
                  showToast("Đã lưu phân quyền " + draft.name);
                } else {
                  showToast("Lỗi khi lưu phân quyền");
                }
              } catch (err) {
                console.error(err);
                showToast("Lỗi kết nối");
              }
            }
            setPermIndex(null);
            setPermDraft(null);
          }}
        />
      )}

      {/* EXPORT MODAL */}
      {exportOpen && a && (
        <ExportModal
          filename={"phieu-phan-tich-" + slug(a.meta.product || a.subtitle) + ".html"}
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

function CampaignView({ isMobile, integration, showToast, onOpenReport, isAdmin }: { isMobile: boolean; integration: { key: string; model: string }; showToast: (m: string) => void; onOpenReport: (h: HistoryEntry) => void; isAdmin?: boolean }) {
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [keyword, setKeyword] = useState("");
  const [minLikes, setMinLikes] = useState("5000");
  const [target, setTarget] = useState("50");
  const [busy, setBusy] = useState(false);
  const [knowledge, setKnowledge] = useState<{ slug: string; product: string; content: string } | null>(null);
  const [savingK, setSavingK] = useState(false);
  // Bước duyệt: danh sách video tìm được + tập đã chọn (awemeId) + lọc nhanh theo caption.
  const [preview, setPreview] = useState<{ videos: any[]; keywords: string[]; scanned: number; exhausted: boolean; perKeyword: Record<string, number> } | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [pvFilter, setPvFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<{ found: number; scanned: number; page: number } | null>(null);
  // Job tìm video chạy NỀN — sống sót khi đổi tab/F5. Client poll trạng thái.
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobTarget, setJobTarget] = useState(0);
  const jobModeRef = useRef<"new" | "more">("new");
  const LSJOB = "nonelab_campaign_job";
  const [vnOnly, setVnOnly] = useState(true); // mặc định chỉ tìm video Việt Nam
  const [jobs, setJobs] = useState<any[]>([]); // "chiến dịch chưa phân tích" (job searching/ready)
  const [openJobId, setOpenJobId] = useState<string | null>(null); // job đang mở để duyệt

  const reload = async () => { const cs = await listCohorts(); setCohorts((Array.isArray(cs) ? cs : []).filter((c: any) => c.kind === "campaign")); };
  useEffect(() => { reload(); }, []);
  const loadKnowledge = async (p: string) => { const k = await getKnowledge(slug(p)); setKnowledge(k?.ok ? { slug: k.slug, product: k.product, content: k.content } : { slug: slug(p), product: p, content: "" }); };
  const openCohort = async (id: string) => { const d = await getCohort(id); if (d?.ok) { setSel(d); loadKnowledge(d.cohort.product); } };

  useEffect(() => {
    if (!sel) return;
    if (sel.videos.every((v: any) => v.status === "completed" || v.status === "failed")) return;
    const t = setInterval(async () => { const d = await getCohort(sel.cohort.id); if (d?.ok) { setSel(d); if (d.cohort.insight) loadKnowledge(d.cohort.product); } }, 6000);
    return () => clearInterval(t);
  }, [sel?.cohort.id, sel?.videos]);

  const reloadJobs = async () => { const r = await getActiveCampaignJobs(); const js = (r?.ok && Array.isArray(r.jobs)) ? r.jobs : []; setJobs(js); return js; };

  const doSearch = async () => {
    if (!keyword.trim()) return showToast("Nhập từ khóa cần tìm");
    // Tìm = TẠO JOB chạy nền (không hủy khi đổi tab/F5, sống sót restart). Poll tiến trình.
    setPreview(null); setOpenJobId(null); setSel(null); setProgress(null);
    jobModeRef.current = "new";
    const r = await startCampaignSearch({ keyword: keyword.trim(), minLikes: Number(minLikes) || 0, target: Number(target) || 50, vnOnly });
    if (!r?.ok) return showToast(r?.message || "Không khởi tạo được tìm kiếm");
    setJobTarget(r.target || Number(target) || 50);
    setBusy(true);
    try { localStorage.setItem(LSJOB, JSON.stringify({ jobId: r.jobId })); } catch {}
    setJobId(r.jobId); // useEffect bắt đầu poll
    reloadJobs();
  };
  const stopSearch = async () => { if (!jobId) return; await stopCampaignSearch(jobId); showToast("Đang dừng… sẽ giữ lại video đã tìm được."); };
  const pickedCount = preview ? preview.videos.filter((v) => picked[v.awemeId]).length : 0;
  const pvVisible = preview ? preview.videos.filter((v) => !pvFilter.trim() || (v.desc || "").toLowerCase().includes(pvFilter.trim().toLowerCase())) : [];
  const setAll = (on: boolean, onlyVisible = false) => {
    if (!preview) return;
    const next = { ...picked };
    for (const v of (onlyVisible ? pvVisible : preview.videos)) next[v.awemeId] = on;
    setPicked(next);
  };
  // Mở 1 "chiến dịch chưa phân tích" (job) để duyệt — hoặc theo dõi nếu đang tìm.
  const openJob = async (jid: string) => {
    const j = await getCampaignJob(jid);
    if (!j?.ok) return showToast("Không mở được chiến dịch");
    if (j.status === "searching") { jobModeRef.current = "new"; setJobTarget(j.target || 0); setBusy(true); setJobId(jid); return; }
    if (j.status !== "ready") return showToast(j.message || "Chiến dịch chưa sẵn sàng");
    const videos: any[] = j.videos || [];
    const pick: Record<string, boolean> = {}; for (const v of videos) pick[v.awemeId] = true;
    setPicked(pick); setPvFilter(""); setSel(null);
    setPreview({ videos, keywords: j.keywords, scanned: j.scanned, exhausted: j.exhausted, perKeyword: j.perKeyword || {} });
    setOpenJobId(jid);
  };
  const deleteJob = async (jid: string) => {
    await discardCampaignJob(jid);
    if (openJobId === jid) { setPreview(null); setOpenJobId(null); }
    if (jobId === jid) { setJobId(null); setBusy(false); }
    reloadJobs();
  };
  const doAnalyze = async () => {
    if (!preview) return;
    const chosen = preview.videos.filter((v) => picked[v.awemeId]);
    if (!chosen.length) return showToast("Chưa chọn video nào");
    setCreating(true);
    const r = await createCampaign({ keywords: preview.keywords, videos: chosen, minLikes: Number(minLikes) || 0, apiKey: integration.key, model: integration.model });
    setCreating(false);
    if (!r?.ok) return showToast(r?.message || "Tạo campaign thất bại");
    showToast(`Đã đưa ${r.count} video vào mổ xẻ nền…`);
    if (openJobId) discardCampaignJob(openJobId).catch(() => {}); // chiến dịch đã phân tích → bỏ job pending
    setPreview(null); setOpenJobId(null);
    await reloadJobs(); await reload(); openCohort(r.cohortId);
  };
  // Tìm THÊM: tạo job tạm (mode 'more'), khi xong gộp video MỚI vào danh sách đang duyệt.
  const doSearchMore = async () => {
    if (!preview || busy) return;
    if (preview.exhausted) return showToast("Đã quét hết nguồn cho từ khóa này — thêm từ khóa khác (cách nhau dấu phẩy) để tìm thêm.");
    jobModeRef.current = "more";
    const want = Math.min(preview.videos.length + 50, 300);
    const r = await startCampaignSearch({ keyword: preview.keywords.join(", "), minLikes: Number(minLikes) || 0, target: want, vnOnly });
    if (!r?.ok) return showToast(r?.message || "Tìm thêm thất bại");
    setJobTarget(r.target || want); setBusy(true); setJobId(r.jobId);
  };

  // Poll job tìm video đang theo dõi (tiến trình + kết quả). Job vẫn nằm server nên
  // đổi tab/F5/đổi máy đều khôi phục được; job KHÔNG bị xóa khi xong (thành chiến
  // dịch chưa phân tích) — chỉ xóa khi bấm Phân tích hoặc Xóa.
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const finish = () => { setBusy(false); setProgress(null); setJobId(null); try { localStorage.removeItem(LSJOB); } catch {} };
    const tick = async () => {
      const j = await getCampaignJob(jobId);
      if (stop) return;
      if (!j?.ok) { finish(); return; }
      if (j.target) setJobTarget(j.target);
      if (j.status === "searching") { setBusy(true); setProgress({ found: j.found || 0, scanned: j.scanned || 0, page: j.pages || 0 }); return; }
      if (j.status === "failed") { showToast(j.message || "Tìm kiếm thất bại"); finish(); reloadJobs(); return; }
      if (j.status === "ready") {
        const videos: any[] = j.videos || [];
        if (jobModeRef.current === "more") {
          setPreview((prev) => {
            if (!prev) return prev;
            const existing = new Set(prev.videos.map((v) => v.awemeId));
            const fresh = videos.filter((v) => !existing.has(v.awemeId));
            setPicked((pp) => { const n = { ...pp }; for (const v of fresh) n[v.awemeId] = true; return n; });
            showToast(fresh.length ? `Thêm ${fresh.length} video mới (tổng ${prev.videos.length + fresh.length}).` : (j.exhausted ? "Đã hết nguồn — thử thêm từ khóa khác." : "Chưa có video mới nào."));
            return { ...prev, videos: [...prev.videos, ...fresh], scanned: j.scanned, exhausted: j.exhausted, perKeyword: j.perKeyword || prev.perKeyword };
          });
          discardCampaignJob(jobId).catch(() => {}); // job 'more' chỉ là tạm
        } else {
          const pick: Record<string, boolean> = {}; for (const v of videos) pick[v.awemeId] = true;
          setPicked(pick); setPvFilter("");
          setPreview({ videos, keywords: j.keywords, scanned: j.scanned, exhausted: j.exhausted, perKeyword: j.perKeyword || {} });
          setOpenJobId(jobId); // GIỮ job → thành chiến dịch chưa phân tích
          showToast(`Tìm thấy ${videos.length} video${j.message ? ` · ${j.message}` : ""}. Duyệt rồi bấm phân tích.`);
        }
        finish(); reloadJobs();
      }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(iv); };
  }, [jobId]);

  // Lúc mở trang: nạp danh sách chiến dịch chưa phân tích; nếu có job đang tìm → theo dõi.
  useEffect(() => {
    (async () => {
      const js = await reloadJobs();
      let active: string | null = null;
      try { const s = localStorage.getItem(LSJOB); if (s) { const id = JSON.parse(s).jobId; if (js.find((x: any) => x.jobId === id && x.status === "searching")) active = id; } } catch {}
      if (!active) { const s = js.find((x: any) => x.status === "searching"); if (s) active = s.jobId; }
      if (active) { jobModeRef.current = "new"; setBusy(true); setJobId(active); }
    })();
  }, []);
  // Cập nhật danh sách chiến dịch định kỳ khi có job đang tìm (để thẻ nhảy số).
  useEffect(() => {
    if (!jobs.some((j) => j.status === "searching")) return;
    const iv = setInterval(reloadJobs, 4000);
    return () => clearInterval(iv);
  }, [jobs]);
  const saveK = async () => { if (!knowledge) return; setSavingK(true); const r = await saveKnowledge(knowledge.slug, knowledge.product, knowledge.content); setSavingK(false); showToast(r?.ok ? "Đã lưu kho kiến thức" : "Lưu thất bại"); };

  const tcol = (t: string) => (t === "tốt" ? ["rgba(60,122,94,.13)", "#2f6b4f"] : t === "thấp" ? ["rgba(158,58,58,.12)", "#8f3232"] : ["rgba(176,106,22,.14)", "#8a5614"]);
  const chip = (t: string) => { const [bg, fg] = tcol(t); return <span style={c(`font-family:'Space Grotesk',sans-serif;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;background:${bg};color:${fg}`)}>{t}</span>; };
  const nf = (n: number) => Number(n || 0).toLocaleString("vi-VN");
  const stIcon = (s: string) => (s === "completed" ? "✓" : s === "processing" ? "⚙" : s === "failed" ? "✕" : "⏳");
  const openVideo = async (id: string, hasContent: boolean) => { if (!hasContent) return showToast("Video này chưa mổ xẻ xong"); const r = await getHistoryItem(id); if (r?.analysis?.checklist) onOpenReport({ id: r.id, title: r.title, platform: r.platform, product: r.product, date: r.date, score: r.score, analysis: r.analysis, thumb: r.thumb } as HistoryEntry); };

  const meta = sel?.cohort?.summary;
  const sum = meta?.summary;
  const insight = sel?.cohort?.insight;
  const card = (label: string, val: string) => (
    <div style={c("background:linear-gradient(160deg,#f7f0e2,#fffdf8);border:1px solid rgba(140,96,40,.22);border-radius:14px;padding:14px")}>
      <div style={c("font-family:'Space Grotesk',sans-serif;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;margin-bottom:6px")}>{label}</div>
      <div style={c("font-family:'Fraunces',serif;font-size:21px;font-weight:600;color:#9a5a12;line-height:1")}>{val}</div>
    </div>
  );

  return (
    <div className="ns-fade" style={c("max-width:1100px;margin:0 auto")}>
      <div style={c(`background:#fffdf8;border:1px solid rgba(140,96,40,.2);border-radius:18px;padding:${isMobile ? "18px" : "22px 24px"};margin-bottom:22px`)}>
        <div style={c("font-family:'Fraunces',serif;font-size:18px;font-weight:600;color:#2a2016;margin-bottom:4px")}>Tìm video TikTok theo từ khóa</div>
        <div style={c("color:#8a7c67;font-size:13px;margin-bottom:16px")}>Tìm trực tiếp trên TikTok (không phải trong hệ thống), lọc theo lượt thích tối thiểu, rồi tự mổ xẻ nội dung để tìm điểm chung của nhóm tương tác cao.</div>
        <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr" : "2fr 1fr 1fr auto"};gap:12px;align-items:end`)}>
          <div>
            <label style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;display:block;margin-bottom:6px")}>Từ khóa (cách nhau dấu phẩy để gộp)</label>
            <input value={keyword} onChange={(e: any) => setKeyword(e.target.value)} placeholder="vd: phấn phủ, phấn phủ kiềm dầu, phấn nén" style={c("width:100%;padding:11px 13px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fdfaf3;font-size:14px")} />
          </div>
          <div>
            <label style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;display:block;margin-bottom:6px")}>Like tối thiểu</label>
            <input value={minLikes} onChange={(e: any) => setMinLikes(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" style={c("width:100%;padding:11px 13px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fdfaf3;font-size:14px")} />
          </div>
          <div>
            <label style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;display:block;margin-bottom:6px")}>Số video (≤300)</label>
            <input value={target} onChange={(e: any) => setTarget(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" style={c("width:100%;padding:11px 13px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fdfaf3;font-size:14px")} />
          </div>
          <button onClick={doSearch} disabled={busy} style={c(`padding:12px 22px;border:none;border-radius:11px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:${busy ? "default" : "pointer"};opacity:${busy ? .6 : 1};white-space:nowrap`)}>{busy ? "Đang tìm…" : "🔍 Tìm video"}</button>
        </div>
        <label style={c("display:inline-flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer;user-select:none")}>
          <input type="checkbox" checked={vnOnly} onChange={(e: any) => setVnOnly(e.target.checked)} style={c("width:16px;height:16px;accent-color:#9a5a12")} />
          <span style={c("font-size:13px;color:#2a2016")}>🇻🇳 Chỉ tìm video Việt Nam (tiếng Việt)</span>
        </label>
        {busy && (
          <div style={c("margin-top:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;color:#9a5a12;font-size:12.5px;font-family:'Space Grotesk',sans-serif")}>
            <span style={c("width:13px;height:13px;border:2px solid rgba(154,90,18,.3);border-top-color:#9a5a12;border-radius:50%;display:inline-block;animation:ns-spin 1s linear infinite")} />
            <span>{progress ? `Đã tìm được ${progress.found}/${jobTarget || Number(target) || 50} video theo yêu cầu · đã quét ${progress.scanned}` : "Đang khởi tạo tìm kiếm nền… (đổi tab/F5 vẫn chạy)"}</span>
            {jobId && <button onClick={stopSearch} style={c("padding:5px 12px;border:1px solid rgba(158,58,58,.45);border-radius:8px;background:#fff6f4;color:#8f3232;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12px;cursor:pointer")}>■ Dừng tìm (giữ video đã tìm)</button>}
          </div>
        )}
        <div style={c("color:#8a7c67;font-size:11.5px;margin-top:10px")}>Lưu ý: mỗi từ khóa lộ ra một kho ~600 video; nhập nhiều từ khóa (cách nhau dấu phẩy) sẽ gộp dedup để vét được nhiều hơn. Tìm xong, video được GIỮ LẠI ở "chiến dịch chưa phân tích" — bạn có thể duyệt & phân tích bất kỳ lúc nào (chưa tốn Gemini ở bước tìm).</div>
      </div>

      {jobs.length > 0 && (
        <div style={c("margin-bottom:22px")}>
          <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#8a7c67;margin-bottom:10px")}>Chiến dịch chưa phân tích ({jobs.length})</div>
          <div style={c("display:flex;flex-direction:column;gap:8px")}>
            {jobs.map((j) => {
              const searching = j.status === "searching";
              const isActive = jobId === j.jobId;
              const cnt = isActive && progress ? progress.found : j.found;
              return (
                <div key={j.jobId} style={c(`display:flex;gap:12px;align-items:center;background:#fffdf8;border:1px solid ${searching ? "rgba(176,106,22,.4)" : "rgba(140,96,40,.22)"};border-radius:12px;padding:12px 14px;flex-wrap:wrap`)}>
                  <div style={c("flex:1;min-width:180px")}>
                    <div style={c("font-weight:600;font-size:13.5px;color:#2a2016")}>🔍 {(j.keywords || []).join(", ") || "—"} {j.region === "VN" ? "· 🇻🇳" : ""}</div>
                    <div style={c("font-size:11.5px;color:#8a7c67;margin-top:2px")}>
                      {searching ? `Đang tìm… ${cnt}/${j.target} video (đã quét ${isActive && progress ? progress.scanned : j.scanned})` : `${j.found} video · chưa phân tích${j.exhausted ? " · đã quét hết nguồn" : ""}`}
                    </div>
                  </div>
                  {searching ? (
                    <>
                      {!isActive && <button onClick={() => openJob(j.jobId)} style={c("padding:7px 12px;border:1px solid rgba(140,96,40,.3);border-radius:9px;background:#fff;color:#9a5a12;font-size:12px;font-weight:600;cursor:pointer")}>Theo dõi</button>}
                      <button onClick={async () => { await stopCampaignSearch(j.jobId); showToast("Đang dừng… giữ lại video đã tìm."); }} style={c("padding:7px 12px;border:1px solid rgba(158,58,58,.4);border-radius:9px;background:#fff6f4;color:#8f3232;font-size:12px;font-weight:600;cursor:pointer")}>■ Dừng</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => openJob(j.jobId)} style={c("padding:7px 14px;border:none;border-radius:9px;background:linear-gradient(150deg,#3c7a5e,#2a5a44);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer")}>Duyệt & phân tích →</button>
                      <button onClick={() => { if (confirm("Xóa chiến dịch chưa phân tích này?")) deleteJob(j.jobId); }} style={c("padding:7px 10px;border:1px solid rgba(140,96,40,.3);border-radius:9px;background:#fff;color:#8a7c67;font-size:12px;cursor:pointer")}>Xóa</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {preview && (
        <div style={c(`background:#fffdf8;border:1px solid rgba(176,106,22,.34);border-radius:18px;padding:${isMobile ? "16px" : "20px 22px"};margin-bottom:22px`)}>
          <div style={c(`display:flex;${isMobile ? "flex-direction:column;gap:10px" : "align-items:center;justify-content:space-between"};margin-bottom:12px`)}>
            <div>
              <div style={c("font-family:'Fraunces',serif;font-size:17px;font-weight:600;color:#2a2016")}>Duyệt video trước khi phân tích</div>
              <div style={c("color:#8a7c67;font-size:12.5px;margin-top:3px")}>
                Tìm thấy <b>{preview.videos.length}</b> · đang chọn <b style={c("color:#9a5a12")}>{pickedCount}</b>
                {preview.keywords.length > 1 ? <> · từ khóa: {preview.keywords.map((k) => `${k}${preview.perKeyword?.[k] != null ? ` (+${preview.perKeyword[k]})` : ""}`).join(", ")}</> : null}
                {preview.exhausted ? " · đã quét hết nguồn" : ""}
              </div>
              <div style={c("color:#a8946f;font-size:11.5px;margin-top:3px")}>Bỏ tick những video lạc chủ đề (vd tìm “khử mùi” nhưng ra “khử mùi tủ lạnh”). Bấm tiêu đề để mở video trên TikTok đối chứng.</div>
            </div>
            <div style={c("display:flex;gap:8px;flex-wrap:wrap")}>
              <button onClick={doSearchMore} disabled={busy || creating} title={preview.exhausted ? "Đã hết nguồn cho từ khóa này" : "Tìm thêm video và gộp vào danh sách"} style={c(`padding:11px 16px;border:1px solid rgba(176,106,22,.45);border-radius:11px;background:#fff;color:#9a5a12;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13.5px;cursor:${busy || creating ? "default" : "pointer"};opacity:${busy || creating ? .55 : 1};white-space:nowrap`)}>{busy ? "Đang tìm…" : "＋ Tìm thêm"}</button>
              <button onClick={doAnalyze} disabled={creating || busy || !pickedCount} style={c(`padding:11px 20px;border:none;border-radius:11px;background:linear-gradient(150deg,#3c7a5e,#2a5a44);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:${creating || busy || !pickedCount ? "default" : "pointer"};opacity:${creating || busy || !pickedCount ? .55 : 1};white-space:nowrap`)}>{creating ? "Đang tạo…" : `✓ Phân tích ${pickedCount} video`}</button>
            </div>
          </div>
          {pickedCount > 0 && pickedCount < 10 && (
            <div style={c("margin-bottom:10px;padding:9px 12px;border-radius:9px;background:rgba(176,106,22,.08);border:1px solid rgba(176,106,22,.25);color:#8a5614;font-size:12px")}>
              Chỉ còn <b>{pickedCount}</b> video sau khi lọc — bấm <b>＋ Tìm thêm</b> để gom thêm video cùng chủ đề{preview.exhausted ? " (nguồn từ khóa hiện tại đã cạn — hãy thêm từ khóa khác rồi tìm lại)" : ""}.
            </div>
          )}
          <div style={c("display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px")}>
            <input value={pvFilter} onChange={(e: any) => setPvFilter(e.target.value)} placeholder="Lọc nhanh theo caption…" style={c("flex:1;min-width:180px;padding:8px 12px;border:1px solid rgba(140,96,40,.28);border-radius:9px;background:#fdfaf3;font-size:13px")} />
            <button onClick={() => setAll(true)} style={c("padding:7px 12px;border:1px solid rgba(140,96,40,.3);border-radius:9px;background:#fff;font-size:12px;cursor:pointer")}>Chọn tất cả</button>
            <button onClick={() => setAll(false)} style={c("padding:7px 12px;border:1px solid rgba(140,96,40,.3);border-radius:9px;background:#fff;font-size:12px;cursor:pointer")}>Bỏ tất cả</button>
            {pvFilter.trim() ? <><button onClick={() => setAll(true, true)} style={c("padding:7px 12px;border:1px solid rgba(60,122,94,.4);border-radius:9px;background:#fff;color:#2f6b4f;font-size:12px;cursor:pointer")}>Chọn kết quả lọc</button><button onClick={() => setAll(false, true)} style={c("padding:7px 12px;border:1px solid rgba(158,58,58,.4);border-radius:9px;background:#fff;color:#8f3232;font-size:12px;cursor:pointer")}>Bỏ kết quả lọc</button></> : null}
          </div>
          <div style={c("max-height:460px;overflow:auto;border:1px solid rgba(140,96,40,.16);border-radius:12px")}>
            {pvVisible.map((v) => {
              const on = !!picked[v.awemeId];
              return (
                <div key={v.awemeId} onClick={() => setPicked({ ...picked, [v.awemeId]: !on })} style={c(`display:flex;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid rgba(140,96,40,.1);cursor:pointer;background:${on ? "rgba(60,122,94,.06)" : "transparent"}`)}>
                  <input type="checkbox" checked={on} readOnly style={c("width:16px;height:16px;accent-color:#3c7a5e;flex-shrink:0")} />
                  <div style={c("flex:1;min-width:0")}>
                    <div style={c("font-size:13px;color:#2a2016;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{v.desc || "(không có caption)"}</div>
                    <div style={c("font-size:11px;color:#8a7c67;margin-top:1px")}>@{v.author || v.nickname || "?"} · ❤ {nf(v.stats?.likes)} · ▶ {nf(v.stats?.views)} · 💬 {nf(v.stats?.comments)}</div>
                  </div>
                  <a href={v.link} target="_blank" rel="noreferrer" onClick={(e: any) => e.stopPropagation()} style={c("flex-shrink:0;font-size:11.5px;color:#9a5a12;text-decoration:none;border:1px solid rgba(140,96,40,.3);border-radius:8px;padding:4px 9px")}>Mở ↗</a>
                </div>
              );
            })}
            {!pvVisible.length ? <div style={c("padding:20px;text-align:center;color:#8a7c67;font-size:13px")}>Không có video khớp bộ lọc.</div> : null}
          </div>
        </div>
      )}

      {cohorts.length > 0 && (
        <div style={c("display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px")}>
          {cohorts.map((co) => {
            const on = sel?.cohort.id === co.id;
            return (
              <div key={co.id} onClick={() => openCohort(co.id)} style={c(`cursor:pointer;border:1px solid ${on ? "rgba(176,106,22,.5)" : "rgba(140,96,40,.22)"};background:${on ? "rgba(176,106,22,.1)" : "#fffdf8"};border-radius:12px;padding:10px 14px`)}>
                <div style={c("font-weight:600;font-size:13.5px;color:#2a2016")}>🔍 {co.product}</div>
                <div style={c("font-size:11.5px;color:#8a7c67;margin-top:2px")}>{co.done}/{co.total} đã mổ xẻ{co.hasInsight ? " · ✓ có kết luận" : ""}{isAdmin && co.owner ? ` · 👤 ${co.owner}` : ""}</div>
              </div>
            );
          })}
        </div>
      )}

      {sel && (
        <>
          <SectionHead tag="Tổng quan" title={`Từ khóa: "${sel.cohort.product}"`} />
          <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr 1fr" : "repeat(auto-fit,minmax(140px,1fr))"};gap:12px;margin-bottom:28px`)}>
            {card("Số video", nf(sel.cohort.count))}
            {sum && card("Tương tác", `${sum.tot}·${sum.kha}·${sum.thap}`)}
            {sum && card("Median like", nf(sum.medianLikes))}
            {sum && card("Median ER", `${sum.medianRate}%`)}
            {meta && card("Đã quét", nf(meta.scanned))}
          </div>

          <SectionHead tag="Kết luận" title="Điểm chung của video tương tác cao" />
          {!insight ? (
            <div style={c("background:#fffdf8;border:1px dashed rgba(140,96,40,.3);border-radius:14px;padding:18px;margin-bottom:14px;color:#8a7c67;font-size:13.5px")}>
              Đang mổ xẻ nội dung… kết luận sẽ hiện khi đủ dữ liệu.{" "}
              <span onClick={async () => { const r = await finalizeCohort(sel.cohort.id); showToast(r?.done ? "Đã dựng kết luận" : "Chưa đủ video mổ xẻ xong"); openCohort(sel.cohort.id); }} style={c("color:#9a5a12;font-weight:600;cursor:pointer;text-decoration:underline")}>Thử dựng ngay</span>
            </div>
          ) : (
            <div style={c("display:flex;flex-direction:column;gap:12px;margin-bottom:28px")}>
              {insight.metrics.map((mi: any) => (
                <div key={mi.metric} style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.2);border-left:3px solid #b06a16;border-radius:0 14px 14px 0;padding:16px 18px")}>
                  <div style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#b06a16;font-weight:600;margin-bottom:6px")}>Tương tác cao · {mi.goodN} cao vs {mi.badN} thấp</div>
                  <div style={c("font-size:14px;color:#2a2016;line-height:1.55;margin-bottom:8px")}>{mi.conclusion}</div>
                  {mi.drivers.map((d: any, i: number) => {
                    const ex = (d.examples || [])[0];
                    return (
                      <div key={i} style={c(`${i ? "margin-top:12px;padding-top:12px;border-top:1px solid rgba(70,54,32,.08);" : ""}`)}>
                        <div style={c("font-size:13.5px;color:#2a2016")}>• <b>{d.trait}</b> <span style={c("color:#8a7c67")}>— {d.goodRate}% video cao (vs {d.badRate}% thấp)</span></div>
                        {ex && (
                          <div style={c("margin:6px 0 0 14px;font-size:12.5px;color:#574a3a;line-height:1.65")}>
                            {ex.hook && <div>↳ <b>Hook nói:</b> “{ex.hook}”</div>}
                            {!!(ex.lines && ex.lines.length) && <div>↳ <b>Lời thoại đắt:</b> {ex.lines.map((l: string) => `“${l}”`).join(" · ")}</div>}
                            {!!(ex.shots && ex.shots.length) && (
                              <div>↳ <b>Quay cảnh:</b>
                                <div style={c("margin:2px 0 0 14px")}>
                                  {ex.shots.map((s: any, j: number) => (<div key={j}><span style={c("color:#9a5a12;font-weight:600")}>[{s.ts}]</span> {s.vi}{s.cam ? <span style={c("color:#8a7c67")}> — {s.cam}</span> : null}</div>))}
                                </div>
                              </div>
                            )}
                            {ex.title && <div style={c("color:#8a7c67;font-size:11.5px;margin-top:3px")}>Mẫu từ: {ex.link ? <a href={ex.link} target="_blank" rel="noopener" style={c("color:#9a5a12")}>{ex.title}</a> : ex.title}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {knowledge && (
            <>
              <SectionHead tag="Kho kiến thức" title={`Bổ sung cho: ${knowledge.product}`} />
              <div style={c("margin-bottom:28px")}>
                <textarea value={knowledge.content} onChange={(e: any) => setKnowledge({ ...knowledge, content: e.target.value })} placeholder="Kho kiến thức tự sinh sau khi mổ xẻ xong — có thể chỉnh sửa." style={c("width:100%;min-height:160px;padding:14px;border:1px solid rgba(140,96,40,.28);border-radius:12px;background:#fdfaf3;font-family:'Be Vietnam Pro',sans-serif;font-size:13px;line-height:1.6;resize:vertical")} />
                <div style={c("margin-top:8px")}><button onClick={saveK} disabled={savingK} style={c("padding:9px 18px;border:none;border-radius:10px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13px;cursor:pointer")}>{savingK ? "Đang lưu…" : "Lưu kho kiến thức"}</button></div>
              </div>
            </>
          )}

          <SectionHead tag="Bảng xếp hạng" title={`${sel.videos.length} video theo tương tác`} />
          <div style={c("border:1px solid rgba(140,96,40,.18);border-radius:14px;overflow:hidden;background:#fffdf8")}>
            <div style={c("display:flex;align-items:center;gap:10px;padding:9px 14px;background:rgba(176,106,22,.07);border-bottom:1px solid rgba(140,96,40,.18);font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8a7c67;font-weight:600")}>
              <span style={c("width:26px")}>#</span>
              <span style={c("flex:1;min-width:0")}>Tiêu đề video</span>
              <span style={c("width:42px;text-align:right")} title="Điểm tương tác">Điểm</span>
              {!isMobile && <span style={c("width:72px;text-align:right")}>Like</span>}
              {!isMobile && <span style={c("width:48px;text-align:right")}>ER</span>}
              <span style={c("width:54px")}>Tương tác</span>
              <span style={c("width:18px;text-align:center")}>TT</span>
            </div>
            {sel.videos.map((v: any, i: number) => (
              <div key={v.id} onClick={() => openVideo(v.id, v.hasContent)} style={c(`display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:${i ? "1px solid rgba(70,54,32,.08)" : "none"};cursor:${v.hasContent ? "pointer" : "default"};font-size:13px`)}>
                <span style={c("width:26px;color:#8a7c67;font-family:'Space Grotesk',sans-serif;font-weight:600")}>{i + 1}</span>
                <span style={c("flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#2a2016")}>{v.title}</span>
                {v.eng && <span style={c("font-family:'Fraunces',serif;font-weight:600;color:#9a5a12;width:42px;text-align:right")}>{v.eng.score}</span>}
                {v.eng && !isMobile && <span style={c("width:72px;text-align:right;color:#574a3a")}>{nf(v.eng.likes)}</span>}
                {v.eng && !isMobile && <span style={c("width:48px;text-align:right;color:#574a3a")}>{v.eng.engagementRate}%</span>}
                {v.eng && <span style={c("width:54px")}>{chip(v.eng.tier)}</span>}
                <span title={v.status} style={c("width:18px;text-align:center;color:#8a7c67")}>{stIcon(v.status)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {!cohorts.length && !sel && (
        <div style={c("text-align:center;color:#8a7c67;font-size:14px;padding:30px 0")}>Chưa có campaign nào. Nhập từ khóa ở trên để bắt đầu.</div>
      )}
    </div>
  );
}

/* ════════════════════════ KHUNG HẠT GIỐNG ════════════════════════
 * Bản đồ content từ điểm mạnh sản phẩm — 5 khối theo skill khung-hat-giong:
 * ① điểm mạnh → hướng nội dung · ② chân dung khách & thời điểm có nhu cầu ·
 * ③ concept nghịch lý/over · ④ đối chuẩn 5 hướng × 3 ngôn ngữ · ⑤ kế hoạch test.
 * Backend sinh theo TỪNG PHẦN (Gemini) — client gọi song song, phần lỗi retry riêng.
 * Chỉ Biên tập + Quản trị thấy màn này (nav đã lọc; server chặn thêm bằng requireEditor). */

const SF_NGANH = [
  "Chăm sóc cá nhân (khử mùi, sữa tắm...)",
  "Mỹ phẩm / skincare",
  "Nước hoa",
  "FMCG / tiêu dùng nhanh",
  "Thời trang / phụ kiện",
  "Gia dụng",
  "F&B",
  "Khác",
];

// Nhịp vận hành + nguyên tắc ngân sách (nêu ở cuối output — đúng theo skill).
const SF_NHIP = "3–5 khung hạt giống/tuần · 15–20 video/khung · 4 vòng test trong 1 tháng · lướt và lưu ≥200 video đối chuẩn/ngày · chỉ mượn khung, luôn tự tạo \"điểm cộng\" riêng.";
const SF_BUDGET: Record<string, string> = {
  moi: "SP mới: booking test ~10% GMV kỳ vọng · ads chia ~50/50 awareness/conversion · KOC chiếm 70–80% tầng awareness để test painpoint.",
  cu: "SP đang bán: booking test ~3% GMV kỳ vọng · 80–90% ads dồn tầng conversion có gắn giỏ.",
};

// Chạy tối đa `size` tác vụ song song (tránh dồn quá nhiều request Gemini một lúc).
async function sfRunPool(tasks: (() => Promise<any>)[], size = 3): Promise<{ ok: boolean; value?: any; error?: any }[]> {
  const results: { ok: boolean; value?: any; error?: any }[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return results;
}

const sfEsc = (s: any) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function SeedFrameView({ isMobile, integration, showToast, isAdmin, canExport }: { isMobile: boolean; integration: { key: string; model: string }; showToast: (m: string) => void; isAdmin?: boolean; canExport?: boolean }) {
  const [form, setForm] = useState({ ten: "", nganh: SF_NGANH[0], usp: "", khach: "", pain: "", trangThai: "moi" as "moi" | "cu" });
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [dirs, setDirs] = useState<any[] | null>(null);
  const [personas, setPersonas] = useState<any[] | null>(null);
  const [concepts, setConcepts] = useState<any[] | null>(null);
  const [doiChuan, setDoiChuan] = useState<any[] | null>(null);
  const [bench, setBench] = useState<any | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [savedList, setSavedList] = useState<any[]>([]);
  const [currentId, setCurrentId] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (k: string) => (e: any) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const uspList = () => form.usp.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const normForm = (): SeedFrameFormInput => ({ ten: form.ten.trim(), nganh: form.nganh, usp: uspList(), khach: form.khach.trim(), pain: form.pain.trim(), trangThai: form.trangThai });

  const reloadSaved = async () => { const r = await listSeedFrames(); if (r?.ok) setSavedList(r.items || []); };
  useEffect(() => { reloadSaved(); }, []);

  /* Gọi 1 phần với tối đa 3 lần thử (server đã tự retry lỗi tạm của Gemini;
   * client thử lại thêm khi JSON hỏng/mạng chập). Lỗi key/quyền thì dừng ngay. */
  const callPart = async (part: string, f: SeedFrameFormInput, strength?: string) => {
    let last: any = null;
    for (let i = 0; i < 3; i++) {
      if (i) await sleep(1200 * i);
      const r = await seedFramePart({ part, form: f, strength, apiKey: integration.key || undefined, model: integration.model });
      if (r?.ok) return r.data;
      last = r;
      // Token hết hạn: retry vô ích — báo rõ để người dùng đăng nhập lại.
      if (r?.status === 401) {
        last = { message: "Phiên đăng nhập đã hết hạn — hãy đăng xuất rồi đăng nhập lại." };
        break;
      }
      if (r?.error === "no-key" || r?.status === 403 || /Biên tập|Quản trị|xác thực|API key/i.test(String(r?.message || ""))) break;
    }
    throw new Error(last?.message || "Không sinh được phần này.");
  };

  /* Lưu bản đồ lên server (tự động sau khi sinh/retry/tick chọn). */
  const persist = async (f: SeedFrameFormInput, result: any) => {
    const r = await saveSeedFrame({ id: currentId || undefined, form: f, result });
    if (r?.ok && r.id && r.id !== currentId) setCurrentId(r.id);
    reloadSaved();
  };
  const resultOf = (over: any = {}) => ({ dirs, personas, concepts, doiChuan, bench, selected, ...over });
  // Tick chọn thay đổi → lưu lại sau 1 giây (không spam server).
  useEffect(() => {
    if (!currentId || !dirs) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { persist(normForm(), resultOf()); }, 1000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [selected]);

  const generate = async () => {
    const list = uspList();
    if (!form.ten.trim() || list.length === 0) {
      setErr("Cần tối thiểu tên sản phẩm và ít nhất một nhóm điểm mạnh (mỗi dòng một nhóm).");
      return;
    }
    const f = normForm();
    setErr(""); setLoading(true); setCurrentId("");
    setDirs(null); setPersonas(null); setConcepts(null); setDoiChuan(null); setBench(null); setSelected({});
    setProgress(`Đang lập bản đồ ${list.length} nhóm điểm mạnh + bối cảnh nhu cầu + concept + ma trận đối chuẩn 5 hướng × 3 ngôn ngữ (${3 + list.length * 4} lượt Gemini, chạy dần)...`);

    const tasks = [
      () => callPart("conceptsA", f),
      () => callPart("conceptsB", f),
      () => callPart("bench", f),
      ...list.map((db) => () => callPart("persona", f, db)),
      ...list.map((db) => () => callPart("directions", f, db)),
      ...list.map((db) => () => callPart("doichuanA", f, db)),
      ...list.map((db) => () => callPart("doichuanB", f, db)),
    ];
    const rs = await sfRunPool(tasks, 3);

    const cA = rs[0], cB = rs[1], bR = rs[2];
    const pR = rs.slice(3, 3 + list.length);
    const dR = rs.slice(3 + list.length, 3 + 2 * list.length);
    const kA = rs.slice(3 + 2 * list.length, 3 + 3 * list.length);
    const kB = rs.slice(3 + 3 * list.length);

    // Khối ②: mỗi nhóm điểm mạnh một bảng bối cảnh riêng (theo skill mới).
    const vPersonas = list.map((db, i) => ({
      diem_ban: db,
      rows: pR[i].ok ? pR[i].value.rows || [] : [],
      failed: !pR[i].ok,
    }));
    const cRows = [...(cA.ok ? cA.value.rows || [] : []), ...(cB.ok ? cB.value.rows || [] : [])];
    const vConcepts = cA.ok || cB.ok ? cRows : null;
    const vBench = bR.ok ? bR.value : null;
    const vDirs = list.map((db, i) => ({
      diem_ban: db,
      mo_ta: dR[i].ok ? dR[i].value.mo_ta || [] : [],
      huong: dR[i].ok ? dR[i].value.huong || [] : [],
      failed: !dR[i].ok,
    }));
    const vDoiChuan = list.map((db, i) => ({
      diem_ban: db,
      cach_list: [...(kA[i].ok ? kA[i].value.cach_list || [] : []), ...(kB[i].ok ? kB[i].value.cach_list || [] : [])],
      failedA: !kA[i].ok,
      failedB: !kB[i].ok,
    }));

    const anyOk = vPersonas.some((p) => !p.failed) || !!vConcepts || !!vBench || vDirs.some((d) => !d.failed) || vDoiChuan.some((k) => k.cach_list.length);
    if (!anyOk) {
      const firstErr = rs.find((r) => !r.ok);
      setErr(`Tạo không thành công (${(firstErr?.error as any)?.message || "lỗi không rõ"}). Đợi vài giây rồi bấm lại.`);
    } else {
      setPersonas(vPersonas); setConcepts(vConcepts); setBench(vBench); setDirs(vDirs); setDoiChuan(vDoiChuan);
      const failParts: string[] = [];
      const nFailDirs = vDirs.filter((d) => d.failed).length;
      if (nFailDirs) failParts.push(`${nFailDirs} nhóm điểm mạnh`);
      const nFailDc = vDoiChuan.filter((k) => k.failedA || k.failedB).length;
      if (nFailDc) failParts.push(`đối chuẩn của ${nFailDc} nhóm`);
      const nFailPer = vPersonas.filter((p) => p.failed).length;
      if (nFailPer) failParts.push(`bối cảnh nhu cầu của ${nFailPer} nhóm`);
      if (!vConcepts) failParts.push("concept nghịch lý");
      if (!vBench) failParts.push("kế hoạch test");
      setErr(failParts.length ? `Một phần chưa tạo được (${failParts.join(", ")}) — bấm "Thử lại" ở mục tương ứng.` : "");
      await persist(f, { dirs: vDirs, personas: vPersonas, concepts: vConcepts, doiChuan: vDoiChuan, bench: vBench, selected: {} });
      showToast("Đã lập xong bản đồ content — tự động lưu vào danh sách.");
    }
    setLoading(false); setProgress("");
  };

  /* ── Retry từng phần ── */
  const retryDir = async (i: number) => {
    if (!dirs) return;
    setBusy((b) => ({ ...b, ["d" + i]: true }));
    try {
      const v = await callPart("directions", normForm(), dirs[i].diem_ban);
      const next = dirs.map((d, k) => (k === i ? { ...d, mo_ta: v.mo_ta || [], huong: v.huong || [], failed: false } : d));
      setDirs(next);
      persist(normForm(), resultOf({ dirs: next }));
    } catch (e: any) { showToast(e?.message || "Vẫn chưa tạo được — thử lại sau."); }
    setBusy((b) => ({ ...b, ["d" + i]: false }));
  };

  const retryDoiChuan = async (i: number) => {
    if (!doiChuan) return;
    setBusy((b) => ({ ...b, ["k" + i]: true }));
    const item = doiChuan[i];
    const jobs: { half: "A" | "B"; fn: () => Promise<any> }[] = [];
    if (item.failedA) jobs.push({ half: "A", fn: () => callPart("doichuanA", normForm(), item.diem_ban) });
    if (item.failedB) jobs.push({ half: "B", fn: () => callPart("doichuanB", normForm(), item.diem_ban) });
    const rs = await sfRunPool(jobs.map((j) => j.fn), 2);
    const next = doiChuan.map((k, j) => {
      if (j !== i) return k;
      const nx = { ...k, cach_list: [...k.cach_list] };
      rs.forEach((r, idx) => {
        if (!r.ok) return;
        nx.cach_list = [...nx.cach_list, ...(r.value.cach_list || [])];
        if (jobs[idx].half === "A") nx.failedA = false; else nx.failedB = false;
      });
      const order = "①②③④⑤";
      nx.cach_list.sort((a: any, b: any) => order.indexOf((a.cach || " ")[0]) - order.indexOf((b.cach || " ")[0]));
      return nx;
    });
    setDoiChuan(next);
    persist(normForm(), resultOf({ doiChuan: next }));
    setBusy((b) => ({ ...b, ["k" + i]: false }));
  };

  const retryPersona = async (i: number) => {
    if (!personas) return;
    setBusy((b) => ({ ...b, ["p" + i]: true }));
    try {
      const v = await callPart("persona", normForm(), personas[i].diem_ban);
      const next = personas.map((p, j) => (j === i ? { ...p, rows: v.rows || [], failed: false } : p));
      setPersonas(next);
      persist(normForm(), resultOf({ personas: next }));
    } catch (e: any) { showToast(e?.message || "Vẫn chưa tạo được — thử lại sau."); }
    setBusy((b) => ({ ...b, ["p" + i]: false }));
  };

  const retryConcepts = async () => {
    setBusy((b) => ({ ...b, c: true }));
    const rs = await sfRunPool([() => callPart("conceptsA", normForm()), () => callPart("conceptsB", normForm())], 2);
    const rows = [...(rs[0].ok ? rs[0].value.rows || [] : []), ...(rs[1].ok ? rs[1].value.rows || [] : [])];
    if (rows.length) { setConcepts(rows); persist(normForm(), resultOf({ concepts: rows })); }
    else showToast("Vẫn chưa tạo được — thử lại sau.");
    setBusy((b) => ({ ...b, c: false }));
  };

  const retryBench = async () => {
    setBusy((b) => ({ ...b, b: true }));
    try { const v = await callPart("bench", normForm()); setBench(v); persist(normForm(), resultOf({ bench: v })); }
    catch (e: any) { showToast(e?.message || "Vẫn chưa tạo được — thử lại sau."); }
    setBusy((b) => ({ ...b, b: false }));
  };

  /* ── Mở lại / xóa bản đồ đã lưu ── */
  const openSaved = async (id: string) => {
    const r = await getSeedFrame(id);
    if (!r?.ok) return showToast("Không mở được bản đồ này.");
    const f = r.form || {};
    setForm({ ten: f.ten || "", nganh: f.nganh || SF_NGANH[0], usp: (f.usp || []).join("\n"), khach: f.khach || "", pain: f.pain || "", trangThai: f.trangThai === "cu" ? "cu" : "moi" });
    const rs = r.result || {};
    // Bản đồ lưu theo skill cũ: khối ② là 1 bảng chung (mảng dòng có boi_canh
    // trực tiếp) — bọc lại thành 1 nhóm để vẫn xem được.
    let ps = rs.personas || null;
    if (Array.isArray(ps) && ps.length && ps[0]?.boi_canh) ps = [{ diem_ban: "Bản cũ — bảng chung", rows: ps, failed: false }];
    setDirs(rs.dirs || null); setPersonas(ps); setConcepts(rs.concepts || null);
    setDoiChuan(rs.doiChuan || null); setBench(rs.bench || null); setSelected(rs.selected || {});
    setCurrentId(r.id); setErr("");
    window.scrollTo({ top: 0 });
  };
  const removeSaved = async (id: string, e: any) => {
    e.stopPropagation();
    if (!confirm("Xóa bản đồ này?")) return;
    await deleteSeedFrame(id);
    if (id === currentId) resetNew();
    reloadSaved();
  };
  const resetNew = () => {
    setForm({ ten: "", nganh: SF_NGANH[0], usp: "", khach: "", pain: "", trangThai: "moi" });
    setDirs(null); setPersonas(null); setConcepts(null); setDoiChuan(null); setBench(null);
    setSelected({}); setCurrentId(""); setErr("");
  };

  const toggle = (key: string) => setSelected((s) => ({ ...s, [key]: !s[key] }));
  const selectedCount = Object.values(selected).filter(Boolean).length;

  /* ── Xuất Markdown (copy vào clipboard — dán được vào Sheets/Docs) ── */
  const exportMd = () => {
    if (!dirs) return;
    let md = `# KHUNG HẠT GIỐNG — BẢN ĐỒ CONTENT: ${form.ten}\n`;
    md += `\n## ① Bản đồ điểm mạnh thực tế → hướng nội dung\n`;
    dirs.forEach((d, i) => {
      md += `\n### Nhóm điểm mạnh ${i + 1}: ${d.diem_ban}\nĐiểm mạnh cụ thể / mô tả thực tế:\n${(d.mo_ta || []).map((m: string) => `- ${m}`).join("\n")}\n\nHướng content khai thác (★ = chọn dựng khung tuần này):\n`;
      (d.huong || []).forEach((h: any, j: number) => {
        md += `${j + 1}. ${selected[`d-${i}-${j}`] ? "★ " : ""}**${h.loai}**: ${h.mo_ta}\n`;
      });
    });
    if (personas) {
      md += `\n## ② Thời điểm / bối cảnh có nhu cầu theo từng điểm mạnh\n`;
      personas.forEach((p: any, i: number) => {
        if (p.failed || !(p.rows || []).length) return;
        md += `\n### Nhóm ${i + 1}: ${p.diem_ban}\n\n| Thời điểm, bối cảnh | Ai tạo ra nhu cầu | Nỗi đau thật | Điểm mạnh đưa vào content |\n|---|---|---|---|\n`;
        (p.rows || []).forEach((r: any) => { md += `| ${r.boi_canh} | ${r.ai} | ${r.noi_dau} | ${r.thong_diep} |\n`; });
      });
    }
    if (concepts) {
      md += `\n## ③ Tình huống oái oăm / nghịch lý — concept kịch bản over (★ = đã chọn)\n`;
      concepts.forEach((r: any, i: number) => {
        md += `\n${i + 1}. ${selected[`c-${i}`] ? "★ " : ""}**"${r.concept_ten}"** — ${r.boi_canh}\n   - Ai: ${r.ai} · Nỗi đau: ${r.noi_dau} · Điểm mạnh: ${r.diem_manh}\n   - Kịch bản: ${r.concept_mo_ta}\n`;
      });
    }
    if (doiChuan) {
      md += `\n## ④ Đối chuẩn theo từng nhóm điểm mạnh (5 hướng × 3 ngôn ngữ)\n`;
      doiChuan.forEach((k, i) => {
        if (!k.cach_list.length) return;
        md += `\n### Nhóm ${i + 1}: ${k.diem_ban}\n`;
        k.cach_list.forEach((cc: any) => {
          md += `\n**${cc.cach}**\n- Gợi ý: ${cc.goi_y}\n- Tiếng Việt: ${(cc.vi || []).join(", ")}\n- English: ${(cc.en || []).join(", ")}\n- 中文: ${(cc.zh || []).join(", ")}\n`;
        });
      });
    }
    if (bench) {
      md += `\n## ⑤ Kế hoạch test 4 vòng\n`;
      (bench.ke_hoach_test || []).forEach((v: any, i: number) => { md += `${i + 1}. ${v.ten} — ${v.muc_tieu} (Tiêu chí: ${v.tieu_chi})\n`; });
    }
    md += `\n## Nguyên tắc vận hành\n- ${SF_NHIP}\n- ${SF_BUDGET[form.trangThai]}\n`;
    navigator.clipboard.writeText(md).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  /* ── Xuất HTML tự đứng (gửi cho người khác) ── */
  const exportHtml = () => {
    if (!dirs) return;
    const today = new Date().toLocaleDateString("vi-VN");
    const chip = (t: string, cls = "") => `<span class="chip ${cls}">${sfEsc(t)}</span>`;
    let h = "";
    h += `<h2>① Bản đồ điểm mạnh thực tế → hướng nội dung</h2>`;
    dirs.forEach((d, i) => {
      if (d.failed) return;
      h += `<div class="card"><div class="grouphead"><span class="idx">NHÓM ${String(i + 1).padStart(2, "0")}</span> ${sfEsc(d.diem_ban).toUpperCase()}</div>`;
      if ((d.mo_ta || []).length) h += `<div class="desc"><div class="lbl">ĐIỂM MẠNH CỤ THỂ / MÔ TẢ THỰC TẾ</div>${(d.mo_ta || []).map((m: string) => `<p>· ${sfEsc(m)}</p>`).join("")}</div>`;
      (d.huong || []).forEach((x: any, j: number) => {
        h += `<div class="row"><b>${j + 1}. ${sfEsc(x.loai)}</b> ${selected[`d-${i}-${j}`] ? `<span class="star">★ đã chọn</span>` : ""}<p>${sfEsc(x.mo_ta)}</p></div>`;
      });
      h += `</div>`;
    });
    if (personas && personas.some((p: any) => !p.failed && (p.rows || []).length)) {
      h += `<h2>② Thời điểm / bối cảnh có nhu cầu theo từng điểm mạnh</h2>`;
      personas.forEach((p: any, i: number) => {
        if (p.failed || !(p.rows || []).length) return;
        h += `<div class="card" style="padding:14px 16px"><div class="grouphead"><span class="idx">NHÓM ${String(i + 1).padStart(2, "0")}</span> ${sfEsc(p.diem_ban)}</div>`;
        h += `<table><tr><th>Thời điểm, bối cảnh</th><th>Ai tạo ra nhu cầu</th><th>Nỗi đau thật</th><th>Điểm mạnh đưa vào content</th></tr>`;
        (p.rows || []).forEach((r: any) => {
          h += `<tr><td><b>${sfEsc(r.boi_canh)}</b></td><td>${sfEsc(r.ai)}</td><td class="pain">${sfEsc(r.noi_dau)}</td><td><b>${sfEsc(r.thong_diep)}</b></td></tr>`;
        });
        h += `</table></div>`;
      });
    }
    if (concepts && concepts.length) {
      h += `<h2>③ Tình huống oái oăm / nghịch lý — concept kịch bản over</h2><div class="grid">`;
      concepts.forEach((r: any, i: number) => {
        h += `<div class="card concept"><div class="cname">"${sfEsc(r.concept_ten)}"</div>${selected[`c-${i}`] ? `<span class="star">★ đã chọn</span>` : ""}<p class="bctx"><b>${sfEsc(r.boi_canh)}</b></p><p class="meta"><span class="pain">${sfEsc(r.noi_dau)}</span> · ${sfEsc(r.ai)}</p><p>${sfEsc(r.concept_mo_ta)}</p><span class="chip good">${sfEsc(r.diem_manh)}</span></div>`;
      });
      h += `</div>`;
    }
    if (doiChuan && doiChuan.some((k) => k.cach_list.length)) {
      h += `<h2>④ Đối chuẩn theo từng nhóm điểm mạnh (5 hướng × 3 ngôn ngữ)</h2>`;
      doiChuan.forEach((k, i) => {
        if (!k.cach_list.length) return;
        h += `<div class="card"><div class="grouphead"><span class="idx">NHÓM ${String(i + 1).padStart(2, "0")}</span> ${sfEsc(k.diem_ban)}</div>`;
        k.cach_list.forEach((cc: any) => {
          h += `<div class="row"><b>${sfEsc(cc.cach)}</b><p>${sfEsc(cc.goi_y)}</p>`;
          h += `<div class="kwrow"><span class="lang">VI</span>${(cc.vi || []).map((t: string) => chip(t)).join("")}</div>`;
          h += `<div class="kwrow"><span class="lang">EN</span>${(cc.en || []).map((t: string) => chip(t, "en")).join("")}</div>`;
          h += `<div class="kwrow"><span class="lang">中文</span>${(cc.zh || []).map((t: string) => chip(t, "zh")).join("")}</div>`;
          h += `</div>`;
        });
        h += `</div>`;
      });
    }
    if (bench) {
      h += `<h2>⑤ Kế hoạch test 4 vòng</h2><div class="grid four">`;
      (bench.ke_hoach_test || []).forEach((v: any, i: number) => {
        h += `<div class="card round"><div class="lbl" style="color:#9a5a12">VÒNG ${i + 1} · TUẦN ${i + 1}</div><b>${sfEsc(v.ten)}</b><p>${sfEsc(v.muc_tieu)}</p><p><span class="pain"><b>Tiêu chí:</b></span> ${sfEsc(v.tieu_chi)}</p></div>`;
      });
      h += `</div>`;
    }
    const doc = `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Khung hạt giống — ${sfEsc(form.ten)}</title>
<style>
:root{--ink:#2a2016;--muted:#8a7c67;--border:rgba(140,96,40,.25);--bg:#f6f1e7;--amber:#9a5a12;--amberBg:rgba(176,106,22,.1);--red:#8f3232;--redBg:rgba(158,58,58,.1);--green:#2f6b4f;--greenBg:rgba(60,122,94,.12)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Georgia,'Times New Roman',serif;font-size:14.5px;line-height:1.65}
.wrap{max-width:960px;margin:0 auto;padding:36px 20px 80px}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:18px;margin:34px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--ink)}
.sub{color:var(--muted);font-size:13px;margin:0 0 6px}
.card{background:#fffdf8;border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:14px}
.grouphead{font-weight:700;font-size:15px;margin-bottom:8px}
.idx{font-size:11px;color:var(--muted);margin-right:8px;font-weight:400;letter-spacing:.08em}
.desc{background:var(--bg);border-radius:9px;padding:8px 12px;margin-bottom:8px}
.desc p{margin:3px 0;font-size:13.5px}
.lbl{font-size:10.5px;color:var(--muted);letter-spacing:.08em;margin-bottom:2px}
.row{border-top:1px solid var(--border);padding:10px 0}.row:first-of-type{border-top:none}
.row b{font-size:14px}.row p{margin:4px 0 6px;color:#574a3a}
.star{font-size:11px;color:var(--green);background:var(--greenBg);padding:2px 8px;border-radius:5px;margin-left:8px}
table{width:100%;border-collapse:collapse;background:#fffdf8;border:1px solid var(--border);border-radius:12px;overflow:hidden;font-size:13.5px}
th{background:var(--ink);color:#fffdf8;font-size:11px;letter-spacing:.06em;font-weight:600;text-align:left;padding:9px 12px}
td{padding:9px 12px;border-top:1px solid var(--border);vertical-align:top}
tr:nth-child(odd) td{background:var(--bg)}
.pain{color:var(--red)}.good{color:var(--green)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.grid.four{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.concept .cname{font-weight:700;color:var(--amber);font-size:15.5px}
.concept .bctx{margin:8px 0 4px}.concept .meta,.meta{font-size:12.5px;color:var(--muted);margin:2px 0 8px}
.chip{display:inline-block;font-size:12px;padding:3px 9px;border-radius:6px;border:1px solid var(--border);background:var(--bg);margin:0 6px 6px 0}
.chip.en{background:var(--greenBg);border-color:rgba(60,122,94,.3)}.chip.zh{background:var(--redBg);border-color:rgba(158,58,58,.25)}
.chip.good{background:var(--greenBg);color:var(--green)}
.kwrow{margin:6px 0}.lang{display:inline-block;font-size:10.5px;color:var(--muted);width:36px}
.round b{font-size:14.5px}.round p{margin:4px 0;font-size:12.5px;color:var(--muted)}
.foot{margin-top:40px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);padding-top:12px}
@media print{body{background:#fff}.card,table{break-inside:avoid}}
</style></head><body><div class="wrap">
<h1>Khung hạt giống — ${sfEsc(form.ten)}</h1>
<p class="sub">${sfEsc(form.nganh)}${form.khach ? " · " + sfEsc(form.khach) : ""} · Sản phẩm ${form.trangThai === "moi" ? "mới ra mắt" : "đang bán"} · Xuất ngày ${today}</p>
${h}
<p class="foot">Tạo bởi Nonelab Studio · ${sfEsc(SF_NHIP)}<br>${sfEsc(SF_BUDGET[form.trangThai])}</p>
</div></body></html>`;
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement("a");
    aEl.href = url;
    aEl.download = `khung-hat-giong-${(form.ten || "san-pham").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.html`;
    document.body.appendChild(aEl);
    aEl.click();
    aEl.remove();
    URL.revokeObjectURL(url);
  };

  /* ── UI helpers (theo phong cách chung của app) ── */
  const label = c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;display:block;margin-bottom:6px");
  const input = c("width:100%;padding:11px 13px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fdfaf3;font-size:14px;color:#2a2016");
  const cardBox = "background:#fffdf8;border:1px solid rgba(140,96,40,.2);border-radius:16px";
  const loaiTone = (g: string): [string, string] => {
    const s = (g || "").toLowerCase();
    if (s.includes("demo") || s.includes("chứng minh") || s.includes("so sánh")) return ["rgba(158,58,58,.12)", "#8f3232"];
    if (s.includes("storytelling") || s.includes("tình huống")) return ["rgba(176,106,22,.14)", "#8a5614"];
    return ["rgba(60,122,94,.13)", "#2f6b4f"];
  };
  const tagChip = (t: string) => { const [bg, fg] = loaiTone(t); return <span style={c(`font-family:'Space Grotesk',sans-serif;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;background:${bg};color:${fg}`)}>{t}</span>; };
  const retryRow = (text: string, onRetry: () => void, isBusy?: boolean) => (
    <div style={c("display:flex;align-items:center;gap:12px;background:#fffdf8;border:1px dashed rgba(158,58,58,.5);border-radius:12px;padding:14px 18px;margin:8px 0")}>
      <p style={c("font-size:13px;color:#8f3232;margin:0;flex:1")}>{text}</p>
      <button onClick={onRetry} disabled={isBusy} style={c(`font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;padding:7px 16px;border-radius:8px;border:none;cursor:${isBusy ? "wait" : "pointer"};background:#9e3a3a;color:#fff`)}>{isBusy ? "Đang thử..." : "Thử lại"}</button>
    </div>
  );
  const checkbox = (on: boolean) => (
    <div style={c(`width:18px;height:18px;border-radius:5px;flex:none;margin-top:2px;border:2px solid ${on ? "#3c7a5e" : "rgba(140,96,40,.35)"};background:${on ? "#3c7a5e" : "transparent"};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700`)}>{on ? "✓" : ""}</div>
  );

  return (
    <div className="ns-fade" style={c("max-width:1180px;margin:0 auto")}>
      {/* Bản đồ đã lưu */}
      {savedList.length > 0 && (
        <div style={c("display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center")}>
          {savedList.map((s) => {
            const on = s.id === currentId;
            return (
              <div key={s.id} onClick={() => openSaved(s.id)} style={c(`cursor:pointer;border:1px solid ${on ? "rgba(176,106,22,.5)" : "rgba(140,96,40,.22)"};background:${on ? "rgba(176,106,22,.1)" : "#fffdf8"};border-radius:12px;padding:9px 13px;display:flex;align-items:center;gap:10px`)}>
                <div>
                  <div style={c("font-weight:600;font-size:13px;color:#2a2016")}>🌱 {s.product}</div>
                  <div style={c("font-size:11px;color:#8a7c67;margin-top:1px")}>{new Date(s.updated || s.created).toLocaleDateString("vi-VN")}{isAdmin && s.owner ? ` · 👤 ${s.owner}` : ""}</div>
                </div>
                <span onClick={(e) => removeSaved(s.id, e)} title="Xóa bản đồ" style={c("color:#8a7c67;font-size:13px;padding:2px 4px;cursor:pointer")}>✕</span>
              </div>
            );
          })}
          {(currentId || dirs) && (
            <button onClick={resetNew} style={c("border:1px dashed rgba(140,96,40,.4);background:transparent;border-radius:12px;padding:10px 14px;font-family:'Space Grotesk',sans-serif;font-size:12.5px;font-weight:600;color:#9a5a12;cursor:pointer")}>＋ Bản đồ mới</button>
          )}
        </div>
      )}

      <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr" : "minmax(280px,340px) 1fr"};gap:24px;align-items:start`)}>
        {/* ── INPUT PANEL ── */}
        <div style={{ ...c(`${cardBox};padding:20px`), ...(isMobile ? {} : c("position:sticky;top:86px")) }}>
          <div style={c("font-family:'Fraunces',serif;font-size:17px;font-weight:600;color:#2a2016;margin-bottom:4px")}>Điểm mạnh sản phẩm</div>
          <div style={c("color:#8a7c67;font-size:12.5px;margin-bottom:16px;line-height:1.55")}>Nhập tên sản phẩm + các nhóm điểm mạnh — hệ thống lập bản đồ content 5 khối theo phương pháp khung hạt giống.</div>
          <div style={c("margin-bottom:13px")}>
            <label style={label}>Tên sản phẩm *</label>
            <input style={input} value={form.ten} onChange={set("ten")} placeholder="VD: Sáp lăn khử mùi Nam" />
          </div>
          <div style={c("margin-bottom:13px")}>
            <label style={label}>Ngành hàng</label>
            <select style={input} value={form.nganh} onChange={set("nganh")}>
              {SF_NGANH.map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          </div>
          <div style={c("margin-bottom:13px")}>
            <label style={label}>Nhóm điểm mạnh * (mỗi dòng một nhóm, tối đa 6)</label>
            <textarea style={{ ...input, minHeight: 120, resize: "vertical" }} value={form.usp} onChange={set("usp")} placeholder={"Càng vận động càng thơm - kích hoạt hương theo thân nhiệt\nNgăn tiết mồ hôi - khô thoáng suốt ngày\nHương nước hoa cao cấp - dùng đa vùng cơ thể"} />
          </div>
          <div style={c("margin-bottom:13px")}>
            <label style={label}>Khách hàng mục tiêu</label>
            <input style={input} value={form.khach} onChange={set("khach")} placeholder="VD: Nam 18–30, chơi thể thao, dân văn phòng" />
          </div>
          <div style={c("margin-bottom:13px")}>
            <label style={label}>Pain point chính (nếu có)</label>
            <input style={input} value={form.pain} onChange={set("pain")} placeholder="VD: Xịt sáng, trưa đã có mùi lại" />
          </div>
          <div style={c("margin-bottom:18px")}>
            <label style={label}>Trạng thái sản phẩm</label>
            <div style={c("display:flex;gap:8px")}>
              {([["moi", "Mới ra mắt"], ["cu", "Đang bán"]] as [("moi" | "cu"), string][]).map(([v, t]) => (
                <button key={v} onClick={() => setForm((s) => ({ ...s, trangThai: v }))} style={c(`flex:1;font-size:13px;padding:9px 0;border-radius:9px;cursor:pointer;border:1px solid ${form.trangThai === v ? "#9a5a12" : "rgba(140,96,40,.28)"};background:${form.trangThai === v ? "linear-gradient(150deg,#c07c1e,#9a5a12)" : "#fdfaf3"};color:${form.trangThai === v ? "#fff" : "#8a7c67"};font-weight:${form.trangThai === v ? 600 : 400};font-family:'Space Grotesk',sans-serif`)}>{t}</button>
              ))}
            </div>
            <p style={c("font-size:11.5px;color:#8a7c67;margin:8px 0 0;line-height:1.5")}>{SF_BUDGET[form.trangThai]}</p>
          </div>
          <button onClick={generate} disabled={loading} style={c(`width:100%;font-family:'Space Grotesk',sans-serif;font-size:14.5px;font-weight:600;padding:13px 0;border-radius:11px;border:none;cursor:${loading ? "wait" : "pointer"};background:${loading ? "#8a7c67" : "linear-gradient(150deg,#c07c1e,#9a5a12)"};color:#fff;box-shadow:0 6px 16px rgba(154,90,18,.28)`)}>{loading ? "Đang lập bản đồ..." : "🌱 Lập bản đồ content"}</button>
          {err && <p style={c("font-size:12.5px;color:#8f3232;margin:10px 0 0;line-height:1.5")}>{err}</p>}
        </div>

        {/* ── KẾT QUẢ ── */}
        <div style={c("min-width:0")}>
          {!dirs && !loading && (
            <div style={c("border:1.5px dashed rgba(140,96,40,.3);border-radius:16px;padding:60px 32px;text-align:center;color:#8a7c67")}>
              <div style={c("font-size:34px;margin-bottom:12px")}>🌱</div>
              <p style={c("font-size:13.5px;margin:0;max-width:520px;margin:0 auto;line-height:1.6")}>Kết quả gồm 5 khối: bản đồ điểm mạnh → hướng nội dung · chân dung khách hàng & thời điểm có nhu cầu · tình huống nghịch lý → concept over · đối chuẩn 5 hướng × 3 ngôn ngữ · kế hoạch test 4 vòng.</p>
            </div>
          )}

          {loading && (
            <div style={c(`${cardBox};padding:48px 32px;text-align:center`)}>
              <div className="ns-pulse" style={c("width:12px;height:12px;border-radius:50%;background:#b06a16;margin:0 auto 14px")} />
              <style>{`.ns-pulse{animation:nsPulse 1s ease-in-out infinite}@keyframes nsPulse{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
              <p style={c("font-size:13.5px;color:#8a7c67;margin:0;line-height:1.6")}>{progress || "Đang phân tích..."}</p>
            </div>
          )}

          {dirs && (
            <div style={c("display:flex;flex-direction:column;gap:30px")}>
              {/* ═══ KHỐI ① ═══ */}
              <div>
                <div style={c("display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:14px")}>
                  <SectionHead tag="Khối ①" title="Điểm mạnh → hướng nội dung" />
                  <span style={c(`font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;background:${selectedCount >= 3 && selectedCount <= 5 ? "rgba(60,122,94,.13)" : "rgba(140,96,40,.1)"};color:${selectedCount >= 3 && selectedCount <= 5 ? "#2f6b4f" : "#8a7c67"}`)}>đã chọn {selectedCount} · khuyến nghị 3–5 khung/tuần</span>
                </div>
                <div style={c("display:flex;flex-direction:column;gap:14px")}>
                  {dirs.map((d, i) => (
                    <div key={i} style={c(`${cardBox};padding:18px 18px 12px`)}>
                      <div style={c("display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap")}>
                        <h3 style={c("font-family:'Fraunces',serif;font-size:15.5px;font-weight:600;margin:0")}>
                          <span style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;color:#8a7c67;margin-right:8px;letter-spacing:.08em")}>NHÓM {String(i + 1).padStart(2, "0")}</span>
                          {d.diem_ban}
                        </h3>
                        <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;color:#8a7c67")}>{(d.huong || []).length} hướng</span>
                      </div>
                      {d.failed && retryRow("Nhóm này chưa tạo được (nghẽn tạm thời).", () => retryDir(i), busy["d" + i])}
                      {(d.mo_ta || []).length > 0 && (
                        <div style={c("background:#f6f1e7;border-radius:9px;padding:10px 14px;margin:10px 0 4px")}>
                          <span style={c("font-family:'Space Grotesk',sans-serif;font-size:9.5px;color:#8a7c67;letter-spacing:.12em")}>ĐIỂM MẠNH CỤ THỂ / MÔ TẢ THỰC TẾ</span>
                          {(d.mo_ta || []).map((m: string, j: number) => (<p key={j} style={c("font-size:13px;color:#2a2016;margin:5px 0 0;line-height:1.55")}>· {m}</p>))}
                        </div>
                      )}
                      {(d.huong || []).map((hh: any, j: number) => {
                        const key = `d-${i}-${j}`;
                        const on = !!selected[key];
                        return (
                          <div key={j} onClick={() => toggle(key)} style={c(`display:flex;gap:12px;padding:12px 10px;margin-top:8px;border-radius:10px;cursor:pointer;border:1px solid ${on ? "rgba(60,122,94,.5)" : "rgba(140,96,40,.18)"};background:${on ? "rgba(60,122,94,.08)" : "#fdfaf3"}`)}>
                            {checkbox(on)}
                            <div style={c("flex:1;min-width:0")}>
                              <div style={c("margin-bottom:4px")}>
                                <span style={c("font-family:'Space Grotesk',sans-serif;font-size:12px;color:#8a7c67;margin-right:8px")}>{j + 1}.</span>
                                {tagChip(hh.loai)}
                              </div>
                              <p style={c("font-size:13.5px;color:#2a2016;margin:0;line-height:1.6")}>{hh.mo_ta}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* ═══ KHỐI ② — mỗi nhóm điểm mạnh một bảng bối cảnh riêng ═══ */}
              <div>
                <SectionHead tag="Khối ②" title="Thời điểm / bối cảnh có nhu cầu theo từng điểm mạnh" />
                <div style={c("display:flex;flex-direction:column;gap:14px")}>
                  {(personas || []).map((p: any, pi: number) => (
                    <div key={pi} style={c(`${cardBox};padding:18px 18px 14px`)}>
                      <p style={c("font-family:'Fraunces',serif;font-size:15px;font-weight:600;margin:0 0 10px")}>
                        <span style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;color:#8a7c67;margin-right:8px;letter-spacing:.08em")}>NHÓM {String(pi + 1).padStart(2, "0")}</span>
                        {p.diem_ban}
                      </p>
                      {p.failed ? (
                        retryRow("Bảng bối cảnh của nhóm này chưa tạo được.", () => retryPersona(pi), busy["p" + pi])
                      ) : (
                        <div style={c("border:1px solid rgba(140,96,40,.18);border-radius:10px;overflow:hidden")}>
                          <div style={c("overflow-x:auto")}>
                            <table style={c("width:100%;border-collapse:collapse;font-size:13px;min-width:640px")}>
                              <thead>
                                <tr style={c("background:#2a2016;color:#fffdf8")}>
                                  {["Thời điểm, bối cảnh", "Ai tạo ra nhu cầu", "Nỗi đau thật", "Điểm mạnh đưa vào content"].map((t) => (
                                    <th key={t} style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.08em;font-weight:600;text-align:left;padding:10px 12px;white-space:nowrap")}>{t.toUpperCase()}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(p.rows || []).map((r: any, i: number) => (
                                  <tr key={i} style={c(`border-top:1px solid rgba(140,96,40,.15);background:${i % 2 ? "#f6f1e7" : "#fffdf8"}`)}>
                                    <td style={c("padding:10px 12px;font-weight:600;line-height:1.5")}>{r.boi_canh}</td>
                                    <td style={c("padding:10px 12px;color:#8a7c67;line-height:1.5")}>{r.ai}</td>
                                    <td style={c("padding:10px 12px;color:#8f3232;line-height:1.5")}>{r.noi_dau}</td>
                                    <td style={c("padding:10px 12px;font-weight:600;line-height:1.5")}>{r.thong_diep}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ═══ KHỐI ③ ═══ */}
              <div>
                <SectionHead tag="Khối ③" title="Tình huống nghịch lý — concept kịch bản over" />
                {!concepts && retryRow("Bảng concept nghịch lý chưa tạo được.", retryConcepts, busy.c)}
                {concepts && (
                  <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr" : "repeat(auto-fill,minmax(320px,1fr))"};gap:14px`)}>
                    {concepts.map((r: any, i: number) => {
                      const key = `c-${i}`;
                      const on = !!selected[key];
                      return (
                        <div key={i} onClick={() => toggle(key)} style={c(`cursor:pointer;border-radius:16px;padding:18px 18px 14px;border:1px solid ${on ? "rgba(60,122,94,.5)" : "rgba(140,96,40,.2)"};background:${on ? "rgba(60,122,94,.07)" : "#fffdf8"}`)}>
                          <div style={c("display:flex;justify-content:space-between;gap:8px;align-items:flex-start")}>
                            <span style={c("font-family:'Fraunces',serif;font-size:15px;font-weight:700;color:#9a5a12")}>"{r.concept_ten}"</span>
                            {checkbox(on)}
                          </div>
                          <p style={c("font-size:13.5px;font-weight:600;margin:8px 0 6px;line-height:1.55")}>{r.boi_canh}</p>
                          <p style={c("font-size:12.5px;margin:0 0 8px;line-height:1.55;color:#8a7c67")}>
                            <span style={c("color:#8f3232")}>{r.noi_dau}</span> · {r.ai}
                          </p>
                          <p style={c("font-size:13px;margin:0 0 10px;line-height:1.6")}>{r.concept_mo_ta}</p>
                          <span style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;background:rgba(60,122,94,.13);color:#2f6b4f")}>{r.diem_manh}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ═══ KHỐI ④ ═══ */}
              <div>
                <SectionHead tag="Khối ④" title="Đối chuẩn — 5 hướng × 3 ngôn ngữ" />
                <p style={c("font-size:12.5px;color:#8a7c67;margin:0 0 14px;line-height:1.6")}>Mỗi điểm mạnh được soi theo 5 hướng: đối thủ cùng loại · công dụng tương tự · cùng nhóm khách hàng · kết quả cuối tương tự · viral chéo ngành. VI cho TikTok Việt Nam / Kalodata · EN thuật ngữ chuyên ngành cho TikTok global · 中文 thuật ngữ ngành cho Douyin / Chanmama. Bấm từ khóa để copy.</p>
                {doiChuan && (
                  <div style={c("display:flex;flex-direction:column;gap:14px")}>
                    {doiChuan.map((k, i) => (
                      <div key={i} style={c(`${cardBox};padding:18px 18px 6px`)}>
                        <div style={c("display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px")}>
                          <p style={c("font-family:'Fraunces',serif;font-size:15px;font-weight:600;margin:0")}>
                            <span style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;color:#8a7c67;margin-right:8px;letter-spacing:.08em")}>NHÓM {String(i + 1).padStart(2, "0")}</span>
                            {k.diem_ban}
                          </p>
                          <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;color:#8a7c67")}>{k.cach_list.length}/5 hướng</span>
                        </div>
                        {(k.failedA || k.failedB) && retryRow(`Còn thiếu hướng ${[k.failedA ? "①②③" : "", k.failedB ? "④⑤" : ""].filter(Boolean).join(" và ")} của nhóm này.`, () => retryDoiChuan(i), busy["k" + i])}
                        {k.cach_list.map((cc: any, ci: number) => (
                          <div key={ci} style={c("border-top:1px solid rgba(140,96,40,.15);padding:12px 0")}>
                            <p style={c("font-size:13.5px;font-weight:600;margin:0 0 2px;color:#2a2016")}>{cc.cach}</p>
                            <p style={c("font-size:12.5px;color:#8a7c67;margin:0 0 8px;line-height:1.5")}>{cc.goi_y}</p>
                            {([["VI", cc.vi, "#f6f1e7", "rgba(140,96,40,.25)", "#2a2016"], ["EN", cc.en, "rgba(60,122,94,.1)", "rgba(60,122,94,.3)", "#245c42"], ["中文", cc.zh, "rgba(158,58,58,.08)", "rgba(158,58,58,.25)", "#7d2c2c"]] as [string, string[], string, string, string][]).map(([lang, arr, bg, bd, fg]) => (
                              <div key={lang} style={c("display:flex;gap:8px;align-items:flex-start;margin-bottom:6px")}>
                                <span style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;color:#8a7c67;width:34px;flex:none;padding-top:5px")}>{lang}</span>
                                <div style={c("display:flex;flex-wrap:wrap;gap:6px;flex:1")}>
                                  {(arr || []).map((t, j) => (
                                    <button key={j} onClick={() => { navigator.clipboard.writeText(t); showToast(`Đã copy "${t}"`); }} title="Bấm để copy" style={c(`font-size:12px;padding:4px 9px;border-radius:6px;border:1px solid ${bd};background:${bg};color:${fg};cursor:copy`)}>{t}</button>
                                  ))}
                                  {(arr || []).length > 0 && (
                                    <button onClick={() => { navigator.clipboard.writeText((arr || []).join("\n")); showToast("Đã copy cả hàng"); }} title="Copy cả hàng" style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px;border:1px solid #574a3a;background:transparent;color:#574a3a;cursor:copy")}>copy hàng</button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ═══ KHỐI ⑤ ═══ */}
              <div>
                <SectionHead tag="Khối ⑤" title="Kế hoạch test 4 vòng" />
                {!bench && retryRow("Kế hoạch test chưa tạo được.", retryBench, busy.b)}
                {bench && (
                  <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr 1fr" : "repeat(auto-fit,minmax(200px,1fr))"};gap:12px`)}>
                    {(bench.ke_hoach_test || []).map((v: any, i: number) => (
                      <div key={i} style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.2);border-top:3px solid #b06a16;border-radius:0 0 12px 12px;padding:14px 16px")}>
                        <span style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;color:#9a5a12;letter-spacing:.08em")}>VÒNG {i + 1} · TUẦN {i + 1}</span>
                        <p style={c("font-size:14px;font-weight:600;margin:5px 0 4px")}>{v.ten}</p>
                        <p style={c("font-size:12.5px;color:#8a7c67;margin:0 0 6px;line-height:1.5")}>{v.muc_tieu}</p>
                        <p style={c("font-size:12px;margin:0;line-height:1.5")}>
                          <span style={c("color:#8f3232;font-weight:600")}>Tiêu chí:</span> <span style={c("color:#8a7c67")}>{v.tieu_chi}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div style={c("margin-top:14px;background:#f6f1e7;border:1px solid rgba(140,96,40,.18);border-radius:12px;padding:12px 16px;font-size:12.5px;color:#574a3a;line-height:1.6")}>
                  <b>Nguyên tắc vận hành:</b> {SF_NHIP}<br />
                  <b>Ngân sách:</b> {SF_BUDGET[form.trangThai]}
                </div>
              </div>

              {/* ═══ XUẤT FILE ═══ */}
              {canExport && (
                <div style={c("display:flex;gap:10px;flex-wrap:wrap")}>
                  <button onClick={exportHtml} style={c("font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;padding:11px 22px;border-radius:11px;border:none;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;cursor:pointer;box-shadow:0 5px 14px rgba(154,90,18,.26)")}>⬇ Tải báo cáo HTML (gửi cho người khác)</button>
                  <button onClick={exportMd} style={c(`font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;padding:11px 22px;border-radius:11px;border:1.5px solid #574a3a;background:${copied ? "#574a3a" : "transparent"};color:${copied ? "#fff" : "#574a3a"};cursor:pointer`)}>{copied ? "Đã copy ✓" : "Copy Markdown (dán vào Sheets/Docs)"}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdsView({ isMobile, integration, showToast, onOpenReport, isAdmin }: { isMobile: boolean; integration: { key: string; model: string }; showToast: (m: string) => void; onOpenReport: (h: HistoryEntry) => void; isAdmin?: boolean }) {
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [product, setProduct] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [knowledge, setKnowledge] = useState<{ slug: string; product: string; content: string } | null>(null);
  const [savingK, setSavingK] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reloadCohorts = async () => { const cs = await listCohorts(); setCohorts(Array.isArray(cs) ? cs : []); };
  useEffect(() => { reloadCohorts(); }, []);

  const loadKnowledge = async (productName: string) => {
    const k = await getKnowledge(slug(productName));
    setKnowledge(k?.ok ? { slug: k.slug, product: k.product, content: k.content } : { slug: slug(productName), product: productName, content: "" });
  };
  const openCohort = async (id: string) => {
    const d = await getCohort(id);
    if (d?.ok) { setSel(d); loadKnowledge(d.cohort.product); }
  };

  // Tự làm mới cụm đang chọn khi còn video đang chạy (cập nhật tiến độ + kết luận).
  useEffect(() => {
    if (!sel) return;
    const allDone = sel.videos.every((v: any) => v.status === "completed" || v.status === "failed");
    if (allDone) return;
    const t = setInterval(async () => {
      const d = await getCohort(sel.cohort.id);
      if (d?.ok) { setSel(d); if (d.cohort.insight) loadKnowledge(d.cohort.product); }
    }, 6000);
    return () => clearInterval(t);
  }, [sel?.cohort.id, sel?.videos]);

  const doImport = async () => {
    if (!product.trim()) return showToast("Nhập tên sản phẩm cho cụm này");
    if (!file) return showToast("Chọn file Excel chỉ số (.xlsx)");
    // Không chặn theo key Gemini cục bộ: server tự dùng key trong .env nếu client
    // không có (tài khoản không phải admin không vào màn Quản trị để nhập key).
    setBusy(true);
    const r = await importAds({ file, product: product.trim(), apiKey: integration.key, model: integration.model });
    setBusy(false);
    if (!r?.ok) return showToast(r?.message || "Import thất bại");
    showToast(`Đã nạp ${r.count} video vào cụm "${r.product}" — đang mổ xẻ nền…`);
    setProduct(""); setFile(null); if (fileRef.current) fileRef.current.value = "";
    await reloadCohorts();
    openCohort(r.cohortId);
  };

  const saveK = async () => {
    if (!knowledge) return;
    setSavingK(true);
    const r = await saveKnowledge(knowledge.slug, knowledge.product, knowledge.content);
    setSavingK(false);
    showToast(r?.ok ? "Đã lưu kho kiến thức" : "Lưu thất bại");
  };

  const tcol = (t: string) => (t === "tốt" ? ["rgba(60,122,94,.13)", "#2f6b4f"] : t === "thấp" ? ["rgba(158,58,58,.12)", "#8f3232"] : t === "ít data" ? ["rgba(120,110,95,.14)", "#7a6f5c"] : ["rgba(176,106,22,.14)", "#8a5614"]);
  // ROAS từ traffic quá thấp không đáng tin → nhãn "ít data" thay vì xếp hạng.
  const roasTierOf = (a: any) => (a.traffic >= 1000 && a.roas > 0 ? a.roasTier : "ít data");
  const chip = (t: string) => { const [bg, fg] = tcol(t); return <span style={c(`font-family:'Space Grotesk',sans-serif;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;background:${bg};color:${fg}`)}>{t}</span>; };
  const nf = (n: number) => Number(n || 0).toLocaleString("vi-VN");
  const stIcon = (s: string) => (s === "completed" ? "✓" : s === "processing" ? "⚙" : s === "failed" ? "✕" : "⏳");

  const openVideo = async (id: string, hasContent: boolean) => {
    if (!hasContent) return showToast("Video này chưa mổ xẻ xong");
    const r = await getHistoryItem(id);
    if (r?.analysis?.checklist) onOpenReport({ id: r.id, title: r.title, platform: r.platform, product: r.product, date: r.date, score: r.score, analysis: r.analysis, thumb: r.thumb } as HistoryEntry);
    else showToast("Không mở được phiếu");
  };

  const sum = sel?.cohort?.summary?.summary;
  const insight = sel?.cohort?.insight;
  const card = (label: string, val: string, tier?: string) => (
    <div style={c("background:linear-gradient(160deg,#f7f0e2,#fffdf8);border:1px solid rgba(140,96,40,.22);border-radius:14px;padding:14px")}>
      <div style={c("font-family:'Space Grotesk',sans-serif;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;margin-bottom:6px")}>{label}</div>
      <div style={c("font-family:'Fraunces',serif;font-size:21px;font-weight:600;color:#9a5a12;line-height:1")}>{val}</div>
      {tier && <div style={c("margin-top:6px")}>{chip(tier)}</div>}
    </div>
  );

  return (
    <div className="ns-fade" style={c("max-width:1100px;margin:0 auto")}>
      {/* Import */}
      <div style={c(`background:#fffdf8;border:1px solid rgba(140,96,40,.2);border-radius:18px;padding:${isMobile ? "18px" : "22px 24px"};margin-bottom:22px`)}>
        <div style={c("font-family:'Fraunces',serif;font-size:18px;font-weight:600;color:#2a2016;margin-bottom:4px")}>Nạp file chỉ số ads (.xlsx)</div>
        <div style={c("color:#8a7c67;font-size:13px;margin-bottom:16px")}>Cột cần có: Video ID, Orders, Revenue, Traffic, Clicks, CTR, CVR, CPM, CPC. Hệ thống sẽ tự mổ xẻ nội dung từng video và rút kết luận content nào cho chỉ số tốt.</div>
        <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr" : "1fr 1fr auto"};gap:12px;align-items:end`)}>
          <div>
            <label style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;display:block;margin-bottom:6px")}>Tên sản phẩm</label>
            <input value={product} onChange={(e: any) => setProduct(e.target.value)} placeholder="vd: sữa tắm Lion Bartender" style={c("width:100%;padding:11px 13px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fdfaf3;font-size:14px")} />
          </div>
          <div>
            <label style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;display:block;margin-bottom:6px")}>File Excel</label>
            <input ref={fileRef} type="file" accept=".xlsx" onChange={(e: any) => setFile(e.target.files?.[0] || null)} style={c("width:100%;font-size:13px")} />
          </div>
          <button onClick={doImport} disabled={busy} style={c(`padding:12px 22px;border:none;border-radius:11px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;cursor:${busy ? "default" : "pointer"};opacity:${busy ? .6 : 1};white-space:nowrap`)}>{busy ? "Đang nạp…" : "⚡ Nạp & phân tích"}</button>
        </div>
      </div>

      {/* Danh sách cụm */}
      {cohorts.length > 0 && (
        <div style={c("display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px")}>
          {cohorts.map((co) => {
            const on = sel?.cohort.id === co.id;
            return (
              <div key={co.id} onClick={() => openCohort(co.id)} style={c(`cursor:pointer;border:1px solid ${on ? "rgba(176,106,22,.5)" : "rgba(140,96,40,.22)"};background:${on ? "rgba(176,106,22,.1)" : "#fffdf8"};border-radius:12px;padding:10px 14px`)}>
                <div style={c("font-weight:600;font-size:13.5px;color:#2a2016")}>{co.product}</div>
                <div style={c("font-size:11.5px;color:#8a7c67;margin-top:2px")}>{co.done}/{co.total} đã mổ xẻ{co.hasInsight ? " · ✓ có kết luận" : ""}{isAdmin && co.owner ? ` · 👤 ${co.owner}` : ""}</div>
              </div>
            );
          })}
        </div>
      )}

      {sel && (
        <>
          {/* Tổng quan cụm */}
          <SectionHead tag="Tổng quan" title={`Cụm: ${sel.cohort.product}`} />
          <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr 1fr" : "repeat(auto-fit,minmax(140px,1fr))"};gap:12px;margin-bottom:28px`)}>
            {card("Số video", nf(sel.cohort.count))}
            {sum && card("Xếp loại", `${sum.tot}·${sum.kha}·${sum.thap}`, undefined)}
            {sum && card("Median ROAS", `${sum.medianRoas}×`)}
            {sum && card("Median CVR", `${sum.medianCvr}%`)}
            {sum && card("Median CTR", `${sum.medianCtr}%`)}
          </div>

          {/* Kết luận content↔chỉ số */}
          <SectionHead tag="Kết luận" title="Content như thế nào thì chỉ số tốt" />
          {!insight ? (
            <div style={c("background:#fffdf8;border:1px dashed rgba(140,96,40,.3);border-radius:14px;padding:18px;margin-bottom:14px;color:#8a7c67;font-size:13.5px")}>
              Đang mổ xẻ nội dung các video… kết luận sẽ hiện khi đủ dữ liệu.{" "}
              <span onClick={async () => { const r = await finalizeCohort(sel.cohort.id); showToast(r?.done ? "Đã dựng kết luận" : "Chưa đủ video mổ xẻ xong"); openCohort(sel.cohort.id); }} style={c("color:#9a5a12;font-weight:600;cursor:pointer;text-decoration:underline")}>Thử dựng ngay</span>
            </div>
          ) : (
            <div style={c("display:flex;flex-direction:column;gap:12px;margin-bottom:28px")}>
              {insight.metrics.map((mi: any) => {
                const name = mi.metric === "cvr" ? "CVR · chốt đơn" : mi.metric === "roas" ? "ROAS · hiệu quả chi phí" : "CTR · thu hút click";
                return (
                  <div key={mi.metric} style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.2);border-left:3px solid #b06a16;border-radius:0 14px 14px 0;padding:16px 18px")}>
                    <div style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#b06a16;font-weight:600;margin-bottom:6px")}>{name} · {mi.goodN} tốt vs {mi.badN} thấp</div>
                    <div style={c("font-size:14px;color:#2a2016;line-height:1.55;margin-bottom:8px")}>{mi.conclusion}</div>
                    {mi.drivers.map((d: any, i: number) => {
                      const ex = (d.examples || [])[0];
                      return (
                        <div key={i} style={c(`${i ? "margin-top:12px;padding-top:12px;border-top:1px solid rgba(70,54,32,.08);" : ""}`)}>
                          <div style={c("font-size:13.5px;color:#2a2016")}>• <b>{d.trait}</b> <span style={c("color:#8a7c67")}>— {d.goodRate}% video tốt (vs {d.badRate}% kém)</span></div>
                          {ex && (
                            <div style={c("margin:6px 0 0 14px;font-size:12.5px;color:#574a3a;line-height:1.65")}>
                              {ex.hook && <div>↳ <b>Hook nói:</b> “{ex.hook}”</div>}
                              {!!(ex.lines && ex.lines.length) && <div>↳ <b>Lời thoại đắt:</b> {ex.lines.map((l: string) => `“${l}”`).join(" · ")}</div>}
                              {!!(ex.shots && ex.shots.length) && (
                                <div>↳ <b>Quay cảnh:</b>
                                  <div style={c("margin:2px 0 0 14px")}>
                                    {ex.shots.map((s: any, j: number) => (
                                      <div key={j}><span style={c("color:#9a5a12;font-weight:600")}>[{s.ts}]</span> {s.vi}{s.cam ? <span style={c("color:#8a7c67")}> — {s.cam}</span> : null}</div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {ex.title && <div style={c("color:#8a7c67;font-size:11.5px;margin-top:3px")}>Mẫu từ: {ex.link ? <a href={ex.link} target="_blank" rel="noopener" style={c("color:#9a5a12")}>{ex.title}</a> : ex.title}</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* Kho kiến thức */}
          {knowledge && (
            <>
              <SectionHead tag="Kho kiến thức" title={`Bổ sung cho: ${knowledge.product}`} />
              <div style={c("margin-bottom:28px")}>
                <textarea value={knowledge.content} onChange={(e: any) => setKnowledge({ ...knowledge, content: e.target.value })} placeholder="Kho kiến thức tự sinh sau khi mổ xẻ xong — bạn có thể chỉnh sửa. Nội dung này được bơm vào prompt cho các phân tích sau của sản phẩm." style={c("width:100%;min-height:180px;padding:14px;border:1px solid rgba(140,96,40,.28);border-radius:12px;background:#fdfaf3;font-family:'Be Vietnam Pro',sans-serif;font-size:13px;line-height:1.6;resize:vertical")} />
                <div style={c("margin-top:8px;display:flex;gap:10px;align-items:center")}>
                  <button onClick={saveK} disabled={savingK} style={c("padding:9px 18px;border:none;border-radius:10px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13px;cursor:pointer")}>{savingK ? "Đang lưu…" : "Lưu kho kiến thức"}</button>
                  <span style={c("font-size:12px;color:#8a7c67")}>Tự bơm vào prompt Gemini cho phân tích sau của sản phẩm này.</span>
                </div>
              </div>
            </>
          )}

          {/* Bảng video xếp hạng */}
          <SectionHead tag="Bảng xếp hạng" title={`${sel.videos.length} video theo điểm hiệu quả`} />
          <div style={c("font-size:12px;color:#8a7c67;margin:-12px 0 12px;line-height:1.5")}>
            <b>Điểm</b> = điểm hiệu quả tổng hợp 0–100 (percentile ROAS·Doanh thu·CVR·CTR trong cụm) · <b>Hạng ROAS</b> = xếp loại riêng ROAS · <b>Tổng thể</b> = xếp loại chung. Bấm 1 dòng để mở phiếu mổ xẻ.
          </div>
          <div style={c("border:1px solid rgba(140,96,40,.18);border-radius:14px;overflow:hidden;background:#fffdf8")}>
            <div style={c("display:flex;align-items:center;gap:10px;padding:9px 14px;background:rgba(176,106,22,.07);border-bottom:1px solid rgba(140,96,40,.18);font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8a7c67;font-weight:600")}>
              <span style={c("width:26px")}>#</span>
              <span style={c("flex:1;min-width:0")}>Tiêu đề video</span>
              <span style={c("width:42px;text-align:right")} title="Điểm hiệu quả tổng hợp">Điểm</span>
              {!isMobile && <span style={c("width:62px;text-align:right")}>ROAS</span>}
              <span style={c("width:64px")}>Hạng ROAS</span>
              {!isMobile && <span style={c("width:44px")}>Tổng thể</span>}
              <span style={c("width:18px;text-align:center")} title="Trạng thái">TT</span>
            </div>
            {sel.videos.map((v: any, i: number) => (
              <div key={v.id} onClick={() => openVideo(v.id, v.hasContent)} style={c(`display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:${i ? "1px solid rgba(70,54,32,.08)" : "none"};cursor:${v.hasContent ? "pointer" : "default"};font-size:13px`)}>
                <span style={c("width:26px;color:#8a7c67;font-family:'Space Grotesk',sans-serif;font-weight:600")}>{i + 1}</span>
                <span style={c("flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#2a2016")}>{v.title}</span>
                {v.ads && <span style={c("font-family:'Fraunces',serif;font-weight:600;color:#9a5a12;width:42px;text-align:right")}>{v.ads.efficiencyScore}</span>}
                {v.ads && !isMobile && <span style={c("width:62px;text-align:right;color:#574a3a")}>ROAS {v.ads.roas}×</span>}
                {v.ads && <span style={c("width:64px")}>{chip(roasTierOf(v.ads))}</span>}
                {v.ads && !isMobile && <span style={c("width:44px")} title="Xếp loại tổng thể">{chip(v.ads.label)}</span>}
                <span title={v.status} style={c("width:18px;text-align:center;color:#8a7c67")}>{stIcon(v.status)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {!cohorts.length && !sel && (
        <div style={c("text-align:center;color:#8a7c67;font-size:14px;padding:40px 0")}>Chưa có cụm nào. Nạp file Excel chỉ số ở trên để bắt đầu.</div>
      )}
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

function HistoryView({ history, onOpen, onReanalyze, showToast, isAdmin, onSynthesize, synthesizing, onOpenSynthesis }: { history: HistoryEntry[]; onOpen: (h: HistoryEntry) => void; onReanalyze: (h: HistoryEntry) => void; showToast: (msg: string) => void; isAdmin?: boolean; onSynthesize: (ids: string[]) => void; synthesizing: boolean; onOpenSynthesis: (id: string) => void }) {
  // Tick chọn các phiếu hoàn tất để "Tổng hợp phân tích" (gom lý do thành công chung).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<{ id: string; title: string; created: string; count: number; owner?: string }[]>([]);

  useEffect(() => {
    listSyntheses().then((r) => { if (r?.ok && Array.isArray(r.items)) setSaved(r.items); }).catch(() => {});
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeSaved = async (id: string) => {
    await deleteSynthesis(id);
    setSaved((xs) => xs.filter((x) => x.id !== id));
    showToast("Đã xóa báo cáo tổng hợp");
  };

  const handleClick = (h: HistoryEntry) => {
    if (h.status === "pending") {
      showToast("Video đang xếp hàng chờ phân tích...");
      return;
    }
    if (h.status === "processing") {
      showToast("Gemini đang xem và phân tích video này. Vui lòng đợi...");
      return;
    }
    if (h.status === "failed") {
      const errMsg = (h.analysis as any)?.error || "Không rõ lỗi.";
      showToast(`Lỗi phân tích: ${errMsg}`);
      return;
    }
    onOpen(h);
  };

  const nSel = selected.size;
  const completedCount = history.filter((h) => !h.status || h.status === "completed").length;

  return (
    <div className="ns-fade ns-rise" style={c("display:flex;flex-direction:column;gap:11px")}>
      {/* Thanh tổng hợp: tick chọn phiếu → gom lý do thành công chung thành 1 báo cáo */}
      {completedCount >= 2 && (
        <div style={c("display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:rgba(176,106,22,.07);border:1px dashed rgba(176,106,22,.35);border-radius:13px;padding:11px 15px")}>
          <div style={c("flex:1;min-width:220px;font-size:13px;color:#6b5b44")}>
            🧩 <b>Tổng hợp lý do thành công:</b> tick chọn từ 2 video đã phân tích xong rồi bấm nút — hệ thống gom điểm chung thành 1 báo cáo.
          </div>
          {nSel > 0 && (
            <button onClick={() => setSelected(new Set())} style={c("padding:8px 12px;border:1px solid rgba(140,96,40,.3);border-radius:10px;background:#fffdf8;color:#8a7c67;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12.5px;cursor:pointer")}>Bỏ chọn ({nSel})</button>
          )}
          <button
            onClick={() => onSynthesize(Array.from(selected))}
            disabled={synthesizing || nSel < 2}
            style={c(`padding:9px 16px;border:none;border-radius:10px;background:${synthesizing || nSel < 2 ? "rgba(154,90,18,.35)" : "linear-gradient(150deg,#c07c1e,#9a5a12)"};color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13px;cursor:${synthesizing || nSel < 2 ? "not-allowed" : "pointer"};white-space:nowrap`)}
          >{synthesizing ? "⏳ Đang tổng hợp…" : `🧩 Tổng hợp phân tích${nSel ? ` (${nSel})` : ""}`}</button>
        </div>
      )}

      {/* Báo cáo tổng hợp đã lưu — hiển thị như 1 dòng video, kèm sticker nhận diện */}
      {saved.map((s) => {
        const createdStr = s.created ? new Date(s.created).toLocaleDateString("vi-VN") : "";
        return (
          <div key={s.id} onClick={() => onOpenSynthesis(s.id)} style={c("display:flex;gap:18px;align-items:center;background:linear-gradient(150deg,#fffdf8,#fbf4e4);border:1px solid rgba(60,122,94,.35);border-radius:15px;padding:14px 18px;cursor:pointer;transition:.18s")}>
            {completedCount >= 2 && <div style={c("width:22px;flex:none")} />}
            <div style={c("width:80px;height:56px;border-radius:10px;flex:none;display:grid;place-items:center;font-size:24px;background:linear-gradient(150deg,#3c7a5e,#2a5a44)")}>📊</div>
            <div style={c("flex:1;min-width:0")}>
              <div style={c("font-family:'Fraunces',serif;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{s.title}</div>
              <div style={c("font-size:12.5px;color:#8a7c67;margin-top:3px;display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
                <span style={c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 9px;border-radius:99px;background:rgba(60,122,94,.14);color:#2a5a44;border:1px solid rgba(60,122,94,.3)")}>🧩 Báo cáo tổng hợp</span>
                <span>Gom từ {s.count} video · {createdStr}</span>
                {isAdmin && s.owner && <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:rgba(176,106,22,.1);color:#8a5614")}>👤 {s.owner}</span>}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); removeSaved(s.id); }}
              title="Xóa báo cáo"
              style={c("flex:none;padding:8px 13px;border:1px solid rgba(143,50,50,.35);border-radius:10px;background:#fff6f4;color:#8f3232;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12.5px;cursor:pointer;white-space:nowrap")}
            >✕ Xóa</button>
            <span style={c("color:#2a5a44;font-size:18px;flex:none")}>→</span>
          </div>
        );
      })}

      {history.map((h) => {
        const isPending = h.status === "pending";
        const isProcessing = h.status === "processing";
        const isFailed = h.status === "failed";
        const isDone = !isPending && !isProcessing && !isFailed;
        const isSel = selected.has(h.id);

        let scoreDisplay = String(h.score);
        let scoreSub = "điểm";
        let icon = "🎬";

        if (isPending) {
          scoreDisplay = "⏳";
          scoreSub = "chờ";
          icon = "⏳";
        } else if (isProcessing) {
          scoreDisplay = "⚙️";
          scoreSub = "đang chạy";
          icon = "⚙️";
        } else if (isFailed) {
          scoreDisplay = "❌";
          scoreSub = "lỗi";
          icon = "❌";
        }

        return (
          <div key={h.id} onClick={() => handleClick(h)} style={{
            ...c("display:flex;gap:18px;align-items:center;background:#fffdf8;border-radius:15px;padding:14px 18px;cursor:pointer;transition:.18s"),
            border: isSel ? "1px solid rgba(176,106,22,.65)" : "1px solid rgba(140,96,40,.18)",
            boxShadow: isSel ? "0 0 0 2px rgba(176,106,22,.18)" : "none",
            opacity: (isPending || isProcessing || isFailed) ? 0.75 : 1
          }}>
            {completedCount >= 2 && (
              <div
                onClick={(e) => { e.stopPropagation(); if (isDone) toggleSelect(h.id); else showToast("Chỉ tổng hợp được phiếu đã phân tích xong"); }}
                title={isDone ? "Chọn phiếu này để tổng hợp" : "Phiếu chưa hoàn tất"}
                style={c(`width:22px;height:22px;flex:none;border-radius:7px;display:grid;place-items:center;font-size:13px;font-weight:700;transition:.15s;border:1.5px solid ${isSel ? "#9a5a12" : "rgba(140,96,40,.35)"};background:${isSel ? "linear-gradient(150deg,#c07c1e,#9a5a12)" : "#fffdf8"};color:#fff;cursor:${isDone ? "pointer" : "not-allowed"};opacity:${isDone ? 1 : 0.35}`)}
              >{isSel ? "✓" : ""}</div>
            )}
            <div style={{ ...c("width:80px;height:56px;border-radius:10px;flex:none;display:grid;place-items:center;font-size:22px"), background: h.thumb }}>{icon}</div>
            <div style={c("flex:1;min-width:0")}>
              <div style={c("font-family:'Fraunces',serif;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{h.title}</div>
              <div style={c("font-size:12.5px;color:#8a7c67;margin-top:3px")}>
                {h.platform} · {h.product} · {h.date}
                {isAdmin && (h as any).owner && <span style={c("margin-left:8px;font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:rgba(176,106,22,.1);color:#8a5614")}>👤 {(h as any).owner}</span>}
                {isPending && <span style={c("color:#8a5614;margin-left:8px;font-weight:600")}>[Hàng đợi]</span>}
                {isProcessing && <span style={c("color:#3c7a5e;margin-left:8px;font-weight:600")}>[Đang phân tích...]</span>}
                {isFailed && <span style={c("color:#8f3232;margin-left:8px;font-weight:600")}>[Thất bại]</span>}
              </div>
            </div>
            <div style={c("text-align:right;flex:none")}>
              <div style={c("font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:#9a5a12")}>{scoreDisplay}</div>
              <div style={c("font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#8a7c67;white-space:nowrap")}>{scoreSub}</div>
            </div>
            {isFailed ? (
              <button
                onClick={(e) => { e.stopPropagation(); onReanalyze(h); }}
                style={c("flex:none;padding:8px 13px;border:1px solid rgba(143,50,50,.4);border-radius:10px;background:#fff6f4;color:#8f3232;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12.5px;cursor:pointer;white-space:nowrap")}
              >↻ Phân tích lại</button>
            ) : (
              <span style={c("color:#b06a16;font-size:18px;flex:none")}>→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Báo cáo TỔNG HỢP lý do thành công — gom điểm chung từ các phiếu đã chọn. */
function SynthesisView({ data, isMobile, onBack }: { data: any; isMobile: boolean; onBack: () => void }) {
  const r = data?.report || {};
  const reasons: any[] = Array.isArray(r.reasons) ? r.reasons : [];
  const actions: string[] = Array.isArray(r.actionChecklist) ? r.actionChecklist : [];
  const created = data?.created ? new Date(data.created).toLocaleString("vi-VN") : "";
  const card = c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:15px;padding:18px 20px");
  const tag = c("font-family:'Space Grotesk',sans-serif;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#a8946f;margin-bottom:6px");

  return (
    <div className="ns-fade ns-rise" style={c(`display:flex;flex-direction:column;gap:14px;max-width:${isMobile ? "100%" : "860px"}`)}>
      <div style={c("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <button onClick={onBack} style={c("padding:8px 14px;border:1px solid rgba(140,96,40,.3);border-radius:10px;background:#fffdf8;color:#6b5b44;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12.5px;cursor:pointer")}>← Lịch sử</button>
        <div style={c("flex:1;min-width:200px")}>
          <div style={c("font-family:'Fraunces',serif;font-size:20px;font-weight:700;color:#2a2016")}>{r.title || data?.title || "Báo cáo tổng hợp"}</div>
          <div style={c("font-size:12px;color:#8a7c67;margin-top:2px")}>🧩 Tổng hợp từ {data?.count} video · {created}</div>
        </div>
      </div>

      {r.overview && (
        <div style={card}>
          <div style={tag}>Tổng quan</div>
          <div style={c("font-size:14.5px;line-height:1.65;color:#4a3d2c")}>{r.overview}</div>
        </div>
      )}

      {reasons.length > 0 && (
        <div style={c("display:flex;flex-direction:column;gap:11px")}>
          <div style={c("font-family:'Fraunces',serif;font-size:17px;font-weight:700;color:#2a2016")}>⚡ Lý do thành công chung ({reasons.length})</div>
          {reasons.map((x, i) => (
            <div key={i} style={card}>
              <div style={c("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px")}>
                <span style={c("font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:15px;color:#8a5614")}>{i + 1}. {x.reason}</span>
                {x.share && <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:99px;background:rgba(60,122,94,.12);color:#2a5a44")}>{x.share}</span>}
              </div>
              {x.detail && <div style={c("font-size:13.5px;line-height:1.6;color:#4a3d2c;margin-bottom:8px")}>{x.detail}</div>}
              {Array.isArray(x.evidence) && x.evidence.length > 0 && (
                <div style={c("border-left:3px solid rgba(176,106,22,.4);padding:2px 0 2px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:5px")}>
                  {x.evidence.map((ev: any, j: number) => (
                    <div key={j} style={c("font-size:12.5px;line-height:1.55;color:#6b5b44;font-style:italic")}>“{String(ev)}”</div>
                  ))}
                </div>
              )}
              {x.apply && (
                <div style={c("background:rgba(176,106,22,.08);border-radius:10px;padding:9px 13px;font-size:13px;color:#6b4a12")}>
                  <b>👉 Áp dụng:</b> {x.apply}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {r.hookPattern && (
        <div style={card}>
          <div style={tag}>Khuôn hook chung</div>
          <div style={c("font-size:14px;line-height:1.6;color:#4a3d2c")}>{r.hookPattern}</div>
        </div>
      )}

      {r.formula && (
        <div style={card}>
          <div style={tag}>Công thức chung</div>
          <div style={c("font-family:'Space Grotesk',sans-serif;font-size:13.5px;line-height:1.7;color:#2a2016;background:rgba(140,96,40,.06);border-radius:10px;padding:12px 14px")}>{r.formula}</div>
        </div>
      )}

      {r.differences && (
        <div style={card}>
          <div style={tag}>Điểm cao vs điểm thấp</div>
          <div style={c("font-size:13.5px;line-height:1.6;color:#4a3d2c")}>{r.differences}</div>
        </div>
      )}

      {actions.length > 0 && (
        <div style={card}>
          <div style={tag}>Checklist hành động cho video tiếp theo</div>
          <div style={c("display:flex;flex-direction:column;gap:7px;margin-top:4px")}>
            {actions.map((a, i) => (
              <div key={i} style={c("display:flex;gap:9px;font-size:13.5px;line-height:1.55;color:#4a3d2c")}>
                <span style={c("color:#3c7a5e;font-weight:700")}>☐</span>
                <span>{a}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadView(props: any) {
  const { form, setFormPatch, youtubeUrl, setYoutubeUrl, tiktokUrl, setTiktokUrl, triggerFile, onDragOver, onDrop, dropTitle, dropSub, dropBorder, dropBg, startAnalyze, label, isMobile } = props;
  const inputSt = c("width:100%;padding:12px 14px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fffdf8;font-size:14.5px;transition:.2s");

  return (
    <div className="ns-fade">
      <div style={c(`max-width:${isMobile ? "100%" : "760px"}`)}>
        <div onClick={triggerFile} onDragOver={onDragOver} onDrop={onDrop}
          style={{ ...c(`border-radius:18px;padding:${isMobile ? "36px 20px" : "54px 30px"};text-align:center;cursor:pointer;transition:.2s;margin-bottom:20px`), border: "2px dashed " + dropBorder, background: dropBg }}>
          <div style={c("width:56px;height:56px;margin:0 auto 14px;border-radius:15px;background:linear-gradient(150deg,#e0a64e,#b06a16);display:grid;place-items:center;font-size:26px;box-shadow:0 8px 20px rgba(176,106,22,.3)")}>🎞️</div>
          <div style={c("font-family:'Fraunces',serif;font-size:19px;font-weight:600;margin-bottom:5px")}>{dropTitle}</div>
          <div style={c("color:#8a7c67;font-size:13.5px")}>{dropSub}</div>
        </div>

        <div style={c("display:flex;align-items:center;gap:12px;margin:6px 0 16px;color:#8a7c67;font-size:12px")}>
          <div style={c("flex:1;height:1px;background:rgba(140,96,40,.2)")} />
          <span style={c("font-family:'Space Grotesk',sans-serif;letter-spacing:.14em;text-transform:uppercase")}>hoặc</span>
          <div style={c("flex:1;height:1px;background:rgba(140,96,40,.2)")} />
        </div>

        <div>
          <label style={label()}>🎵 Dán link TikTok / Douyin — mỗi dòng 1 link, hệ thống tự nhận diện nền tảng, tải về & phân tích (nhiều link chạy song song trong hàng đợi)</label>
          <textarea className="ns-in" value={tiktokUrl} onChange={(e: any) => setTiktokUrl(e.target.value)} placeholder={"https://www.tiktok.com/@user/video/1234…\nhttps://v.douyin.com/AbCdEf/…\nhttps://www.douyin.com/video/7345…\nvt.tiktok.com/…"} style={c("width:100%;min-height:96px;resize:vertical;padding:12px 14px;border:1px solid rgba(140,96,40,.28);border-radius:11px;background:#fffdf8;font-size:14px;line-height:1.6;transition:.2s;font-family:'Space Grotesk',sans-serif")} />
        </div>

        <button onClick={startAnalyze} style={c(`margin-top:20px;${isMobile ? "width:100%;" : ""}padding:14px 26px;border:none;border-radius:12px;background:linear-gradient(150deg,#c07c1e,#9a5a12);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:15px;cursor:pointer;box-shadow:0 8px 20px rgba(154,90,18,.3)`)}>⚡ Bắt đầu phân tích</button>
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
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(videoFile);
  useEffect(() => {
    setLocalVideoFile(videoFile);
  }, [videoFile]);

  const chipStyle = (lv: Level): CSSProperties => {
    if (lv === "ok") return c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(60,122,94,.13);color:#2f6b4f;border:1px solid rgba(60,122,94,.4);white-space:nowrap");
    if (lv === "mid") return c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(176,106,22,.14);color:#8a5614;border:1px solid rgba(176,106,22,.4);white-space:nowrap");
    return c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;background:rgba(158,58,58,.12);color:#8f3232;border:1px solid rgba(158,58,58,.4);white-space:nowrap");
  };

  const frameW = isMobile ? 70 : 86;
  const frameH = isMobile ? 124 : 150;

  return (
    <div className="ns-fade" style={c("max-width:1000px;margin:0 auto")}>
      <div style={c("border:1px solid rgba(140,96,40,.2);border-radius:20px;overflow:hidden;background:#fffdf8;margin-bottom:26px")}>
        <div style={c(`padding:${isMobile ? "22px 18px" : "34px 36px"};background:linear-gradient(160deg,#241a10,#3a2a16);display:flex;gap:24px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap`)}>
          <div style={c("flex:1;min-width:240px")}>
            <div style={c("font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:.3em;font-size:10.5px;color:#e0a64e;font-weight:600;margin-bottom:16px")}>Nonelab · Phân tích video · Khung Năm Lực</div>
            <h1 style={c("font-family:'Fraunces',serif;font-weight:900;font-size:clamp(26px,5vw,52px);line-height:1.0;letter-spacing:-.02em;margin:0 0 10px;color:#f6efe0")}>Phiếu <span style={c("font-style:italic;font-weight:400;color:#e8bd72")}>phân tích</span> video</h1>
            <p style={c("font-family:'Fraunces',serif;font-style:italic;font-size:clamp(13px,2.4vw,20px);color:#cdbfa6;margin:0;max-width:60ch")}>{a.subtitle}</p>
            {(() => {
              const summary = a.contentSummary || (a.acts?.map((x) => x.summary).filter(Boolean).slice(0, 3).join(" ")) || "";
              return summary ? (
                <p style={c("font-size:clamp(12.5px,1.9vw,15px);color:#e9dcc4;line-height:1.6;margin:12px 0 0;max-width:66ch")}>{summary}</p>
              ) : null;
            })()}
            {(a.sourceUrl || a.ads?.link) && (
              <a href={a.sourceUrl || a.ads?.link} target="_blank" rel="noopener" style={c("display:inline-block;margin-top:12px;font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;color:#e8bd72;text-decoration:none;border-bottom:1px solid rgba(232,189,114,.4)")}>▶ Xem video gốc để đối chứng</a>
            )}
          </div>
          {(() => {
            const contentScore = a.checklist?.length ? scoreOf(a) : (typeof a.score === "number" ? a.score : null);
            const engScore = a.eng?.score;
            const adsScore = a.ads?.efficiencyScore;
            if (contentScore == null && engScore == null && adsScore == null) return null;
            return (
              <div style={c("flex:none;display:flex;flex-direction:column;align-items:center;gap:10px")}>
                {contentScore != null && (
                  <div style={c("width:96px;height:96px;border-radius:50%;background:#e8bd72;display:grid;place-items:center;box-shadow:0 6px 22px rgba(0,0,0,.3)")}>
                    <div style={c("text-align:center;line-height:1")}>
                      <div style={c("font-family:'Fraunces',serif;font-weight:900;font-size:34px;color:#241a10")}>{contentScore}</div>
                      <div style={c("font-family:'Space Grotesk',sans-serif;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:#6a4e1e;margin-top:2px")}>điểm/100</div>
                    </div>
                  </div>
                )}
                <div style={c("display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:160px")}>
                  {engScore != null && <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;background:rgba(232,189,114,.16);color:#e8bd72;border:1px solid rgba(232,189,114,.35)")}>Tương tác {engScore}{a.eng?.tier ? ` · ${a.eng.tier}` : ""}</span>}
                  {adsScore != null && <span style={c("font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;background:rgba(232,189,114,.16);color:#e8bd72;border:1px solid rgba(232,189,114,.35)")}>Hiệu quả {adsScore}</span>}
                </div>
              </div>
            );
          })()}
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

      {a.stats && (
        <>
          <SectionHead tag="Tương tác" title={`Chỉ số tương tác thực tế · ${a.stats.source}`} />
          <div className="ns-rise" style={c(`display:grid;grid-template-columns:${isMobile ? "1fr 1fr" : "repeat(auto-fit,minmax(150px,1fr))"};gap:12px;margin-bottom:32px`)}>
            {([["Lượt xem", a.stats.views], ["Lượt thích", a.stats.likes], ["Bình luận", a.stats.comments], ["Chia sẻ", a.stats.shares], ["Lưu", a.stats.saves]] as [string, number][]).map(([label, val], i) => (
              <div key={i} style={c("background:linear-gradient(160deg,#f7f0e2,#fffdf8);border:1px solid rgba(140,96,40,.22);border-radius:16px;padding:16px")}>
                <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;margin-bottom:8px")}>{label}</div>
                <div style={c("font-family:'Fraunces',serif;font-size:22px;font-weight:600;color:#9a5a12;line-height:1")}>{Number(val || 0).toLocaleString("vi-VN")}</div>
              </div>
            ))}
          </div>
        </>
      )}

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

      <div style={c("display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px")}>
        <SectionHead tag="Storyboard" title="Phân tích theo phân cảnh" />
        {!localVideoFile && (
          <button onClick={() => {
            const inp = document.createElement("input");
            inp.type = "file";
            inp.accept = "video/mp4,video/*";
            inp.onchange = () => {
              if (inp.files && inp.files[0]) {
                setLocalVideoFile(inp.files[0]);
              }
            };
            inp.click();
          }} style={c("padding:8px 14px;border:1px solid rgba(140,96,40,.3);border-radius:10px;background:#fffdf8;color:#b06a16;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12.5px;cursor:pointer;transition:.18s")}>
            📂 Chọn file video gốc để trích khung hình
          </button>
        )}
      </div>
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
                  <VideoFrame file={localVideoFile} ts={beat.ts} frame={beat.frame} width={frameW} height={frameH} />
                  <div style={c("min-width:0;flex:1")}>
                    <p style={c("font-size:13px;color:#9a5a12;margin:0 0 5px;line-height:1.45;font-weight:600")}>{beat.vi}</p>
                    <p style={c("font-size:11.5px;color:#8a7c67;margin:0 0 8px;line-height:1.5")}>{beat.note}</p>
                    {beat.voiceover && (
                      <div style={c("background:rgba(60,122,94,.07);border-left:3px solid #3c7a5e;border-radius:0 8px 8px 0;padding:7px 10px;margin:0 0 8px")}>
                        <div style={c("font-family:'Space Grotesk',sans-serif;font-size:8px;letter-spacing:.13em;text-transform:uppercase;color:#2f6b4f;font-weight:600;margin-bottom:2px")}>🎙 Voice-off</div>
                        <p style={c("margin:0;font-size:12px;line-height:1.5;color:#2a3a30;font-style:italic")}>“{beat.voiceover}”</p>
                      </div>
                    )}
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

      <SectionHead tag="Checklist" title="7 điểm hiệu quả" />
      {a.checklist?.length ? (() => {
        const total = scoreOf(a);
        const ok = a.checklist.filter((r) => r.level === "ok").length;
        const mid = a.checklist.filter((r) => r.level === "mid").length;
        const low = a.checklist.filter((r) => r.level === "low").length;
        const band = total >= 75 ? ["#2f6b4f", "rgba(60,122,94,.12)", "Tốt"] : total >= 50 ? ["#8a5614", "rgba(176,106,22,.12)", "Khá"] : ["#8f3232", "rgba(158,58,58,.1)", "Cần cải thiện"];
        return (
          <div style={c(`display:flex;align-items:center;gap:18px;background:${band[1]};border:1px solid rgba(140,96,40,.2);border-radius:16px;padding:${isMobile ? "14px 16px" : "16px 22px"};margin-bottom:14px;flex-wrap:wrap`)}>
            <div style={c("display:flex;align-items:baseline;gap:4px")}>
              <span style={c(`font-family:'Fraunces',serif;font-weight:900;font-size:${isMobile ? "40px" : "48px"};line-height:1;color:${band[0]}`)}>{total}</span>
              <span style={c("font-family:'Space Grotesk',sans-serif;font-size:15px;color:#8a7c67")}>/100</span>
            </div>
            <div style={c("flex:1;min-width:160px")}>
              <div style={c("font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8a7c67;margin-bottom:4px")}>Điểm nội dung tổng</div>
              <div style={c(`font-family:'Fraunces',serif;font-size:17px;font-weight:600;color:${band[0]}`)}>{band[2]}</div>
              <div style={c("font-size:12px;color:#574a3a;margin-top:4px")}>{ok} đạt · {mid} tạm · {low} yếu trên {a.checklist.length} tiêu chí (đạt 1đ · tạm 0,5đ · yếu 0đ)</div>
            </div>
          </div>
        );
      })() : null}
      <div style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:16px;overflow:hidden;margin-bottom:32px")}>
        {a.checklist.map((row, i) => (
          <div key={i} style={c(`display:flex;gap:12px;align-items:flex-start;padding:13px 16px;border-bottom:1px solid rgba(70,54,32,.1);${isMobile ? "flex-wrap:wrap" : ""}`)}>
            <div style={c(`flex:none;${isMobile ? "width:100%" : "width:26%"};font-weight:600;font-size:13px`)}>{row.crit}</div>
            <div style={c("flex:none")}><span style={chipStyle(row.level)}>{row.levelLabel}</span></div>
            <div style={c(`flex:1;color:#574a3a;font-size:12.5px;line-height:1.5;${isMobile ? "width:100%" : ""}`)}>{row.note}</div>
          </div>
        ))}
      </div>

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

      <div style={c(`display:grid;grid-template-columns:${isMobile ? "1fr" : "1fr 1fr"};gap:24px`)}>
        <Bank title="Kho lời thoại · 文案库" dot="#b06a16" items={a.quotes} />
        <Bank title="Kho hình ảnh · 画面库" dot="#3c7a5e" items={a.visuals} />
      </div>

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

      <div style={c("background:#fffdf8;border:1px solid rgba(140,96,40,.18);border-radius:16px;padding:22px 24px;margin-bottom:22px")}>
        <div style={c("display:flex;align-items:center;gap:13px;margin-bottom:6px")}>
          <div style={c("width:40px;height:40px;border-radius:11px;flex:none;background:linear-gradient(150deg,#5a8de0,#3a5fc0);display:grid;place-items:center;font-size:20px;box-shadow:0 5px 14px rgba(58,95,192,.3)")}>✦</div>
          <div style={c("flex:1;min-width:0")}>
            <div style={c("font-family:'Fraunces',serif;font-size:19px;font-weight:600;letter-spacing:-.01em")}>Tích hợp AI · Google Gemini</div>
            <div style={c("font-size:12.5px;color:#8a7c67")}>Kết nối API key để Gemini XEM & phân tích video bằng khung Nonelab</div>
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
