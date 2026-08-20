// Gộp trạng thái của nhiều máy render thành một bức tranh chung.
//
// Mỗi máy đẩy lên một file render-status-<tên-máy>.json. Gộp KHÔNG phải là cộng tất cả:
// số tập đã xong và tổng mục tiêu là hai con số ĐỌC TỪ CÙNG MỘT KHO, máy nào cũng thấy như
// nhau — cộng lại thì hai máy sẽ báo 200%. Chỉ tốc độ, số luồng và số lỗi mới là của riêng
// từng máy nên mới cộng được.
const fs = require("fs");
const path = require("path");

const STALE_MS = 60 * 1000; // worker đẩy mỗi 3 giây; quá 1 phút coi như máy đã tắt
const FILE_RE = /^render-status(?:-[a-z0-9-]+)?\.json$/i;

function readStatusDir(dir, { readFile = fs.readFileSync, list = fs.readdirSync } = {}) {
  let names = [];
  try {
    names = list(dir).filter((n) => FILE_RE.test(n));
  } catch (e) {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(readFile(path.join(dir, name), "utf8"));
      out.push({ file: name, ...raw });
    } catch (e) {
      // File đang được ghi dở thì bỏ qua vòng này, lần sau đọc lại.
    }
  }
  return out;
}

function mergeWorkerStatus(list, now = Date.now()) {
  const workers = (list || [])
    .map((d) => {
      const at = new Date(d.updatedAt).getTime();
      const stale = !isFinite(at) || now - at > STALE_MS;
      return {
        worker: d.worker || (d.file || "").replace(/^render-status-?|\.json$/g, "") || "máy",
        updatedAt: d.updatedAt || null,
        stale,
        running: !!d.running && !stale,
        overall: d.overall || {},
        throughput: d.throughput || {},
        inflight: Array.isArray(d.inflight) ? d.inflight : [],
      };
    })
    // Máy còn sống lên trước, rồi tới máy nhiều việc nhất.
    .sort((a, b) => Number(a.stale) - Number(b.stale) || b.inflight.length - a.inflight.length);

  const live = workers.filter((w) => w.running);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

  // done/target đọc từ cùng một kho -> lấy số lớn nhất, KHÔNG cộng.
  const target = Math.max(0, ...workers.map((w) => num(w.overall.target)));
  const done = Math.max(0, ...workers.map((w) => num(w.overall.done)));
  const failed = workers.reduce((n, w) => n + num(w.overall.failed), 0);
  const perMin = Number(live.reduce((n, w) => n + num(w.throughput.perMin), 0).toFixed(1));
  const concurrency = live.reduce((n, w) => n + num(w.throughput.concurrency), 0);
  const remaining = Math.max(0, target - done);

  return {
    workers,
    running: live.length > 0,
    updatedAt: workers.length ? workers[0].updatedAt : null,
    overall: {
      done,
      target,
      failed,
      pct: target ? Math.min(100, Math.round((done / target) * 100)) : 0,
    },
    throughput: {
      perMin,
      concurrency,
      machines: live.length,
      etaMin: perMin > 0 ? Math.round(remaining / perMin) : null,
    },
    inflight: workers.flatMap((w) => w.inflight.map((x) => ({ ...x, worker: w.worker }))),
  };
}

module.exports = { readStatusDir, mergeWorkerStatus, STALE_MS };
