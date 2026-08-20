// Theo dõi tiến độ render realtime + đẩy JSON lên server để trang dashboard poll.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { env } = require("./config");

const os = require("os");
const WORKER_NAME = process.env.WORKER_NAME || os.hostname().replace(/\.local$/, "");
const WORKER_SLUG = WORKER_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "may";
const STATUS_FILE = path.join(env.tmpDir, "render-status.json");

const state = {
  startedAt: Date.now(),
  target: 0,
  doneAtStart: 0,   // số tập đã có trước khi run (server làm trước)
  doneThisRun: 0,
  failed: 0,
  concurrency: env.concurrency,
  movies: {},        // key -> { name, done, target }
  inflight: {},      // tag -> { phase, since }
  recent: [],        // [{ tag, sub, segs, sec, at }]
  needsRedo: [],     // [{ name, eps:[...] }] — tập trống vietsub (subLang != "vi") cần làm lại
};

// Danh sách tập trống vietsub (worker query DB mỗi pass) -> khu "cần làm lại" trên dashboard.
function setNeedsRedo(list) {
  state.needsRedo = Array.isArray(list) ? list : [];
}

// Cập nhật target 1 phim GIỮA pass: refreshMovieRows chạy đầu pass đọc sourceEpisodeCount cũ
// (=0 với phim mới) -> target thiếu suốt cả pass dài. findPendingWork biết số tập thật thì gọi
// hàm này để target + % hiện đúng ngay, không phải chờ pass sau.
function setTarget(key, target) {
  const m = state.movies[key];
  if (!m || typeof target !== "number") return;
  state.target += target - (m.target || 0);
  m.target = target;
}

// movieRows: [{ key, name, done, target }] — nạp 1 lần lúc khởi động (mọi phim 52api).
function initMovies(movieRows) {
  state.target = 0;
  state.doneAtStart = 0;
  for (const m of movieRows) {
    state.movies[m.key] = { name: m.name, done: m.done, target: m.target };
    state.target += m.target;
    state.doneAtStart += m.done;
  }
}

function setPhase(tag, phase) {
  state.inflight[tag] = { phase, since: Date.now() };
}
function done(tag, movieKey, info = {}) {
  delete state.inflight[tag];
  state.doneThisRun++;
  if (state.movies[movieKey]) state.movies[movieKey].done++;
  state.recent.unshift({ tag, ...info, at: Date.now() });
  state.recent = state.recent.slice(0, 12);
}
function fail(tag) {
  delete state.inflight[tag];
  state.failed++;
}

function snapshot() {
  const now = Date.now();
  const elapsedMin = (now - state.startedAt) / 60000;
  const perMin = elapsedMin > 0 ? state.doneThisRun / elapsedMin : 0;
  // done = tổng số THẬT của từng phim (initMovies đặt lại mỗi pass + done() cộng live),
  // cap ở target từng phim để tránh doc trùng làm vượt. KHÔNG cộng doneThisRun (daemon lặp
  // nhiều pass -> doneThisRun cộng dồn sẽ double-count -> >100%).
  const totalDone = Object.values(state.movies).reduce((n, m) => n + Math.min(m.done, m.target || m.done), 0);
  const remaining = Math.max(0, state.target - totalDone);
  const etaMin = perMin > 0 ? Math.round(remaining / perMin) : null;
  // Phim chưa xác định số tập (target<=0, vd nguồn hỏng / mới thêm chưa quét) -> KHÔNG được
  // tính là xong. Nếu còn phim như vậy thì chặn % ở 99 để dashboard không báo 100% giả.
  const unresolved = Object.values(state.movies).filter((m) => !m.target || m.target <= 0).length;
  let pct = state.target ? Math.round((totalDone / state.target) * 100) : 0;
  pct = unresolved > 0 ? Math.min(99, pct) : Math.min(100, pct);
  return {
    worker: WORKER_NAME,
    updatedAt: new Date(now).toISOString(),
    running: true,
    overall: {
      done: totalDone,
      target: state.target,
      remaining,
      failed: state.failed,
      pct,
      unresolved,
      doneThisRun: state.doneThisRun,
    },
    throughput: { perMin: Math.round(perMin * 10) / 10, etaMin, concurrency: state.concurrency },
    movies: Object.values(state.movies).sort(
      (a, b) => a.done / (a.target || 1) - b.done / (b.target || 1),
    ),
    inflight: Object.entries(state.inflight)
      .map(([tag, v]) => ({ tag, phase: v.phase, sec: Math.round((now - v.since) / 1000) }))
      .sort((a, b) => b.sec - a.sec),
    recent: state.recent.map((r) => ({ tag: r.tag, sub: r.sub, segs: r.segs, sec: r.sec, agoSec: Math.round((now - r.at) / 1000) })),
    needsRedo: state.needsRedo,
    needsRedoCount: state.needsRedo.reduce((n, m) => n + (m.eps ? m.eps.length : 0), 0),
  };
}

let pushing = false;
async function pushToServer(finalRunning) {
  if (pushing) return;
  pushing = true;
  try {
    const snap = snapshot();
    if (finalRunning === false) snap.running = false;
    fs.writeFileSync(STATUS_FILE, JSON.stringify(snap));
    const { host, user, password, uploadsPath } = env.server;
    const rsh = `sshpass -p ${JSON.stringify(password)} ssh -o StrictHostKeyChecking=accept-new`;
    // Mỗi máy render đẩy file trạng thái RIÊNG: nhiều máy cùng ghi một tên file thì máy sau
    // đè máy trước, bảng điều khiển chỉ thấy một máy. Backend gộp lại khi hiển thị.
    const remote = `${uploadsPath}/render-status-${WORKER_SLUG}.json`;
    await new Promise((res) =>
      execFile("rsync", ["-t", "-e", rsh, STATUS_FILE, `${user}@${host}:${remote}`], { timeout: 30000 }, () => res()),
    );
    await new Promise((res) =>
      execFile("sshpass", ["-p", password, "ssh", "-o", "StrictHostKeyChecking=accept-new", `${user}@${host}`, `chmod 644 ${remote}`], { timeout: 20000 }, () => res()),
    );
  } catch (e) {
    // đẩy status không được thì bỏ qua, không làm hỏng render
  } finally {
    pushing = false;
  }
}

module.exports = { initMovies, setNeedsRedo, setTarget, setPhase, done, fail, snapshot, pushToServer, STATUS_FILE };
