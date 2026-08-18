// Tool LOCAL: tìm + TẢI phim short-drama qua short-drama-pro (46 platform) về ổ BINGNET.
// Chạy: node poc/searchsite.js -> http://localhost:8848
// Endpoint mỗi platform lấy từ MCP map. Tải: resolver generic (mảng tập -> videos[] best quality).
require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { env, buildSubtitleConfig } = require("./../config");
const db = require("./../db");
const { translateSegments } = require("./../util/translate");
const { buildAss, probeDimensions } = require("./../util/subtitle");
const { transcodeBurnSub } = require("./../util/transcode");

let SETTINGS_READY = false;
async function ensureSettings() {
  if (SETTINGS_READY) return;
  try { await db.connect(); await db.loadSettings(); SETTINGS_READY = true; } catch (e) { console.error("[searchsite] settings lỗi:", e.message); }
}

// VTT/SRT -> [{start,end,text}] (giây).
function parseVtt(vtt) {
  const toSec = (t) => { const m = t.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+("0." + m[4])) : 0; };
  const segs = [];
  for (const block of String(vtt).replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n").filter((l) => l && !/^WEBVTT/i.test(l) && !/^NOTE/i.test(l));
    const tl = lines.find((l) => l.includes("-->"));
    if (!tl) continue;
    const [a, b] = tl.split("-->");
    const text = lines.slice(lines.indexOf(tl) + 1).join(" ").trim();
    if (text) segs.push({ start: toSec(a), end: toSec(b), text });
  }
  return segs;
}

// Sau khi tải: mỗi tập có VTT -> dịch sang tiếng Việt (Gemini) -> burn vietsub -> ep<N>_vietsub.mp4.
async function makeVietsub(dir, job) {
  await ensureSettings();
  const cfg = buildSubtitleConfig(global.settingJSON);
  if (!cfg.apiKey) { job.status = "tải xong (thiếu Gemini key -> bỏ dịch VTT)"; return; }
  const files = fs.readdirSync(dir).filter((f) => /\.vtt$/i.test(f) && !/^\._/.test(f));
  job.subTotal = files.length; job.subDone = 0;
  for (const vf of files) {
    const epTag = vf.replace(/\.[^.]+\.vtt$/i, "").replace(/\.vtt$/i, ""); // ep1
    const mp4 = path.join(dir, epTag + ".mp4");
    const out = path.join(dir, epTag + "_vietsub.mp4");
    if (!fs.existsSync(mp4) || fs.existsSync(out)) { job.subDone++; continue; }
    try {
      const segs = parseVtt(fs.readFileSync(path.join(dir, vf), "utf8"));
      if (!segs.length) { job.subDone++; continue; }
      const srcLang = /id[_-]?ID|\.id\./i.test(vf) ? "tiếng Indonesia" : (/en[_-]?US|\.en\./i.test(vf) ? "tiếng Anh" : "ngôn ngữ gốc");
      const vi = await translateSegments(segs, { apiKey: cfg.apiKey, model: cfg.geminiModel, sourceLang: srcLang, targetLang: "vi" });
      const dims = await probeDimensions(mp4);
      const assF = path.join(dir, epTag + ".vi.ass");
      buildAss(vi, { width: dims.width, height: dims.height, assPath: assF });
      const buf = await transcodeBurnSub(mp4, assF, { enabled: false });
      fs.writeFileSync(out, buf);
      job.subDone++; job.status = `gắn vietsub ${job.subDone}/${job.subTotal}...`;
    } catch (e) { job.subDone++; }
  }
  job.status = "xong (đã gắn vietsub)";
}

const KEY = process.env.RAPIDAPI_KEY;
const HOST = process.env.RAPIDAPI_HOST || "short-drama-pro.p.rapidapi.com";
const PORT = process.env.SEARCH_PORT || 8848;
const DL_DIR = path.join(env.workDir, "shortdrama-downloads");
const enc = encodeURIComponent;

// Config mỗi platform: search + cách lấy tập (từ MCP endpoint map).
//  mode "oneshot": 1 call ra hết tập+link. "twostep": detail lấy danh sách -> mỗi tập 1 call link.
const CFG = {
  // ĐÃ VERIFY tải chạy thật (mode = tải được):
  netshort:   { search: (q, p) => `/netshort/api/v1/search/${enc(q)}/${p}`, mode: "twostep", detail: (id) => `/netshort/api/v1/detail/${id}`, epList: (d) => (d.episodes || []).map((e) => e.episodeNo), ep: (id, n) => `/netshort/api/v1/episode/${id}/${n}` },
  rapidtv:    { search: (q, p, l) => `/rapidtv/api/v1/search?q=${enc(q)}&lang=${l}`, mode: "oneshot", eps: (id, l) => `/rapidtv/api/v1/dramas/${id}/episodes?lang=${l}` },
  microdrama: { search: (q, p, l) => `/microdrama/api/v1/dramas/search?q=${enc(q)}&lang=${l}`, mode: "oneshot", eps: (id, l) => `/microdrama/api/v1/dramas/${id}?lang=${l}` },
  // flextv: TIẾNG VIỆT SẴN (hardsub Việt). 2-bước: list section -> play. Video ở progressive[].video_url.
  flextv:     { search: (q, p, l) => `/flextv/api/v1/search?q=${enc(q)}&lang=vi`, mode: "twostep", detail: (id) => `/flextv/api/v1/series/${id}/episodes?lang=vi`, epList: (d) => ((d && d.list) || []).map((e) => ({ no: e.series_no ?? e.id, key: e.id })), ep: (id, k) => `/flextv/api/v1/play/${id}/${k}?lang=vi` },
  // SEARCH-ONLY (tìm được nhưng resolver chưa khớp shape link video -> nút tải khoá):
  dramarush:  { search: (q, p, l) => `/dramarush/api/v1/search/${enc(q)}?lang=${l}` },
  dramapops:  { search: (q, p, l) => `/dramapops/api/v1/search?q=${enc(q)}&lang=${l}` },
  dramabite:  { search: (q, p, l) => `/dramabite/api/v1/search?q=${enc(q)}&lang=${l}` },
  meloshort:  { search: (q, p, l) => `/meloshort/api/v1/dramas/search?q=${enc(q)}&lang=${l}` },
  dramanova:  { search: (q, p, l) => `/dramanova/api/v1/search?q=${enc(q)}&lang=${l}` },
  flickshort: { search: (q, p, l) => `/flickshort/api/v1/search?q=${enc(q)}&lang=${l}` },
  reelshort:  { search: (q, p, l) => `/reelshort/api/v1/search?q=${enc(q)}&lang=${l}` },
  reelife:    { search: (q, p, l) => `/reelife/api/v1/search?q=${enc(q)}` },
};
const DL_OK = Object.keys(CFG).filter((k) => CFG[k].mode); // platform tải được

const api = (p) => axios.get(`https://${HOST}${p}`, { headers: { "X-RapidAPI-Key": KEY, "X-RapidAPI-Host": HOST }, timeout: 30000, validateStatus: () => true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- extractor generic ----
// Tìm mảng phim (item có id + title/name) trong response bất kỳ shape.
function extractDramas(data) {
  let best = [];
  (function walk(o) {
    if (o == null) return;
    if (Array.isArray(o)) {
      const items = o.filter((x) => x && typeof x === "object" && (x.id || x.bookId || x.dramaId || x.book_id || x.t_book_id || x.series_id) && (x.title || x.name || x.book_title || x.bookName || x.series_name));
      if (items.length > best.length) best = items;
      o.forEach(walk);
    } else if (typeof o === "object") { for (const k in o) walk(o[k]); }
  })(data);
  return best.map((x) => ({
    id: String(x.id || x.bookId || x.dramaId || x.book_id || x.t_book_id || x.series_id || ""),
    title: x.title || x.name || x.book_title || x.bookName || x.series_name || "(no title)",
    cover: x.cover || x.coverUrl || x.cover_url || x.pic || x.book_pic || x.imageUrl || "",
    lang: x.lang || x.language || "",
  }));
}
// Tìm mảng TẬP (item có videos[] hoặc field số tập + link).
function extractEpisodeArray(data) {
  let best = null;
  (function walk(o) {
    if (o == null || best) return;
    if (Array.isArray(o)) {
      if (o.some((x) => x && typeof x === "object" && (Array.isArray(x.videos) || x.videoUrl || x.playUrl || x.chapterUrl || (x.url && (x.episode != null || x.episodeNo != null || x.chapter != null))))) { best = o; return; }
      o.forEach(walk);
    } else if (typeof o === "object") { for (const k in o) walk(o[k]); }
  })(data);
  return best || [];
}
function extractEpNos(data) {
  return extractEpisodeArray(data).map((x, i) => x.episode ?? x.episodeNo ?? x.chapter ?? x.index ?? (i + 1));
}
// Link video tốt nhất từ 1 object tập.
function bestUrl(ep) {
  const vids = ep.videos || ep.videoList || ep.qualities || ep.playList || ep.progressive || [];
  if (Array.isArray(vids) && vids.length) {
    const q = (v) => v.quality || v.title || v.label || "";
    const pick = vids.find((v) => /1080/i.test(q(v))) || vids.find((v) => /720/i.test(q(v))) || vids[0];
    return pick.url || pick.playUrl || pick.videoUrl || pick.video_url || "";
  }
  return ep.videoUrl || ep.playUrl || ep.chapterUrl || ep.url || ep.mp4 || ep.video_url || "";
}
// Phụ đề (VTT/SRT) từ 1 object tập -> [{lang,url}]. Nhiều platform (netshort...) trả subtitles[].
function extractSubs(ep) {
  const subs = ep.subtitles || ep.subtitle || ep.captions || ep.subs || [];
  if (!Array.isArray(subs)) return [];
  return subs.map((s) => ({ lang: s.language || s.lang || s.label || "sub", url: s.url || s.src || s.file || "" })).filter((s) => /^https?:/.test(s.url));
}

// Trả [{no, url}] cho 1 phim.
async function resolveEpisodes(platform, id, lang, onProgress) {
  const c = CFG[platform];
  if (!c || !c.mode) return [];
  if (c.mode === "oneshot") {
    const r = await api(c.eps(id, lang));
    return extractEpisodeArray(r.data).map((ep, i) => ({ no: ep.episode ?? ep.episodeNo ?? ep.chapter ?? (i + 1), url: bestUrl(ep), subs: extractSubs(ep) })).filter((e) => e.url);
  }
  // twostep
  const det = await api(c.detail(id));
  const dd = det.data && (det.data.data || det.data);
  const nos = c.epList(dd);
  const out = [];
  for (const item of nos) {
    if (!c.ep) break;
    const no = (item && typeof item === "object") ? item.no : item; // số tập (đặt tên file)
    const key = (item && typeof item === "object") ? item.key : item; // khoá gọi link (section id...)
    try {
      const r = await api(c.ep(id, key));
      const rd = r.data && (r.data.data || r.data);
      const url = bestUrl(rd) || bestUrl(extractEpisodeArray(r.data)[0] || {});
      const subs = extractSubs(rd).length ? extractSubs(rd) : extractSubs(extractEpisodeArray(r.data)[0] || {});
      if (url) out.push({ no, url, subs });
    } catch (e) {}
    if (onProgress) onProgress(out.length, nos.length);
    await sleep(500);
  }
  return out;
}

// ---- jobs tải ----
const jobs = {}; let jobSeq = 0;
async function downloadDrama(platform, id, lang, jobId, vietsub) {
  const job = jobs[jobId];
  try {
    job.status = "lấy danh sách tập...";
    const eps = await resolveEpisodes(platform, id, lang, (d, t) => { job.total = t; job.status = `lấy link ${d}/${t}...`; });
    job.total = eps.length;
    if (!eps.length) { job.status = "không lấy được tập/link (shape lạ hoặc phim trống)"; return; }
    const dir = path.join(DL_DIR, `${platform}_${id}`);
    fs.mkdirSync(dir, { recursive: true });
    job.dir = dir;
    job.status = "đang tải video...";
    for (const ep of eps) {
      const mp4 = path.join(dir, `ep${ep.no}.mp4`);
      try {
        if (!fs.existsSync(mp4)) {
          const r = await axios.get(ep.url, { responseType: "arraybuffer", timeout: 180000, maxContentLength: 500 * 1024 * 1024 });
          fs.writeFileSync(mp4, Buffer.from(r.data));
        }
        // lưu phụ đề (VTT/SRT) từng ngôn ngữ có sẵn
        for (const s of ep.subs || []) {
          try {
            const sf = path.join(dir, `ep${ep.no}.${s.lang}.vtt`);
            if (!fs.existsSync(sf)) { const sr = await axios.get(s.url, { timeout: 30000, transformResponse: (x) => x }); fs.writeFileSync(sf, sr.data); }
          } catch (x) {}
        }
        job.done++;
      } catch (e) { job.failed++; }
    }
    // hậu-tải: dịch VTT -> vietsub (nếu bật + có VTT)
    const hasVtt = fs.readdirSync(dir).some((f) => /\.vtt$/i.test(f) && !/^\._/.test(f));
    if (vietsub && hasVtt) { job.status = "dịch VTT + gắn vietsub..."; await makeVietsub(dir, job); }
    else job.status = "xong" + (vietsub && !hasVtt ? " (không có VTT để dịch)" : "");
  } catch (e) { job.status = "lỗi: " + e.message; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };

  if (url.pathname === "/api/platforms") return json({ all: Object.keys(CFG), downloadable: DL_OK });

  if (url.pathname === "/api/search") {
    const q = url.searchParams.get("q") || "", lang = url.searchParams.get("lang") || "en";
    const plats = (url.searchParams.get("platforms") || "rapidtv,dramabite,netshort").split(",").filter(Boolean);
    const out = [];
    for (const p of plats) {
      const c = CFG[p];
      try {
        const r = await api(c && c.search ? c.search(q, 1, lang) : `/${p}/api/v1/search?q=${enc(q)}&lang=${lang}`);
        if (r.status === 503) out.push({ platform: p, status: "maintenance", items: [] });
        else if (r.status === 429) out.push({ platform: p, status: "quota", items: [] });
        else out.push({ platform: p, status: "ok", items: extractDramas(r.data), canDl: DL_OK.includes(p) });
      } catch (e) { out.push({ platform: p, status: "error", items: [] }); }
      await sleep(1000);
    }
    return json({ q, lang, results: out });
  }

  if (url.pathname === "/api/download") {
    const platform = url.searchParams.get("platform"), id = url.searchParams.get("id"), lang = url.searchParams.get("lang") || "en";
    const vietsub = url.searchParams.get("vietsub") === "1";
    if (!DL_OK.includes(platform)) return json({ error: `Tải chưa hỗ trợ "${platform}". Hỗ trợ: ${DL_OK.join(", ")}` });
    if (!id) return json({ error: "thiếu id" });
    const jobId = "job" + (++jobSeq);
    jobs[jobId] = { platform, id, total: 0, done: 0, failed: 0, status: "bắt đầu", dir: "" };
    downloadDrama(platform, id, lang, jobId, vietsub);
    return json({ jobId });
  }
  if (url.pathname === "/api/progress") return json(jobs[url.searchParams.get("job")] || { status: "?" });

  // Gắn vietsub cho phim ĐÃ TẢI (dịch VTT có sẵn -> burn), KHÔNG tải lại / không tốn quota API.
  if (url.pathname === "/api/vietsub") {
    const dir = url.searchParams.get("dir") || "";
    const fp = path.join(DL_DIR, dir);
    if (!fp.startsWith(DL_DIR) || !fs.existsSync(fp)) return json({ error: "không thấy thư mục " + dir });
    const jobId = "job" + (++jobSeq);
    jobs[jobId] = { platform: "vietsub", id: dir, total: 0, done: 0, failed: 0, status: "gắn vietsub...", dir: fp };
    makeVietsub(fp, jobs[jobId]);
    return json({ jobId });
  }

  // Thư viện phim ĐÃ TẢI (ưu tiên bản _vietsub).
  if (url.pathname === "/api/library") {
    const dirs = fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR).filter((d) => { try { return fs.statSync(path.join(DL_DIR, d)).isDirectory(); } catch { return false; } }) : [];
    const out = dirs.map((d) => {
      const files = fs.readdirSync(path.join(DL_DIR, d)).filter((f) => /\.mp4$/i.test(f) && !/^\._/.test(f));
      const eps = {};
      for (const f of files) { const m = f.match(/^ep(\d+)(_vietsub)?\.mp4$/i); if (!m) continue; const n = m[1]; if (!eps[n] || m[2]) eps[n] = f; }
      const list = Object.keys(eps).sort((a, b) => a - b).map((n) => ({ no: n, file: d + "/" + eps[n], vietsub: /_vietsub/i.test(eps[n]) }));
      return { dir: d, episodes: list };
    }).filter((x) => x.episodes.length);
    return json(out);
  }

  // Stream 1 file video (hỗ trợ Range để tua).
  if (url.pathname === "/media") {
    const rel = url.searchParams.get("f") || "";
    const fp = path.join(DL_DIR, rel);
    if (!fp.startsWith(DL_DIR) || !fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
    const stat = fs.statSync(fp), range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d+)-(\d*)/); const start = +m[1], end = m[2] ? +m[2] : stat.size - 1;
      res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Content-Type": "video/mp4" });
      fs.createReadStream(fp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Length": stat.size, "Content-Type": "video/mp4", "Accept-Ranges": "bytes" });
      fs.createReadStream(fp).pipe(res);
    }
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
});
server.listen(PORT, () => { fs.mkdirSync(DL_DIR, { recursive: true }); console.log(`[searchsite] http://localhost:${PORT} | tải: ${DL_DIR}\n  Platform tải được: ${DL_OK.join(", ")}`); });

const PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tìm & tải phim</title>
<style>
:root{--bg:#0f1115;--card:#181b22;--line:#262b36;--tx:#e6e9ef;--mut:#8b93a3;--acc:#4ea1ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px system-ui,sans-serif;padding:16px}
h1{font-size:18px;margin:0 0 12px}.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
input,select,button{background:var(--card);color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:14px}
input{flex:1;min-width:180px}button{cursor:pointer;background:var(--acc);color:#001;font-weight:600;border:0}
.plats{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.plats label{font-size:12px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:3px 8px;cursor:pointer}
.plats label.dl{border-color:var(--acc)}.plats input{margin-right:4px}
.grp{margin:14px 0 6px;color:var(--mut);font-size:12px;text-transform:uppercase}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;aspect-ratio:2/3;object-fit:cover;background:#222}
.card .t{padding:6px 8px;font-size:12px;flex:1}.card .id{padding:0 8px 4px;font-size:10px;color:var(--mut);word-break:break-all}
.card button{margin:6px;padding:5px;font-size:12px;border-radius:6px}.card button.alt{background:var(--card);color:var(--mut);border:1px solid var(--line)}
.st{font-size:11px;padding:2px 6px;border-radius:6px;margin-left:6px;background:#5a3a00;color:#ffb020}
#dl{position:fixed;right:12px;bottom:12px;width:300px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:12px;display:none}
</style></head><body>
<h1>🔍 Tìm & ⬇️ tải phim short-drama</h1>
<div class="bar"><input id="q" placeholder="Từ khoá..." value="love">
<select id="lang"><option>en</option><option>id</option><option>vi</option><option>zh</option><option>th</option></select>
<button onclick="go()">Tìm</button>
<button onclick="library()" style="background:var(--card);color:var(--tx);border:1px solid var(--line)">📁 Đã tải / Xem</button>
<label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--mut)"><input type=checkbox id="vietsub" checked>tải xong dịch VTT → gắn vietsub</label></div>
<div class="plats" id="plats"></div>
<video id="player" controls style="display:none;width:100%;max-width:420px;margin:0 auto 12px;border-radius:10px;background:#000"></video>
<div id="out"></div><div id="dl"></div>
<script>
let DL=[];const DEFAULT=["rapidtv","dramabite","microdrama","netshort"];
fetch("/api/platforms").then(r=>r.json()).then(o=>{DL=o.downloadable;
  document.getElementById("plats").innerHTML=o.all.map(p=>'<label class="'+(DL.includes(p)?"dl":"")+'"><input type=checkbox value="'+p+'" '+(DEFAULT.includes(p)?"checked":"")+'>'+p+(DL.includes(p)?" ⬇️":"")+'</label>').join("");
});
const sel=()=>[...document.querySelectorAll(".plats input:checked")].map(x=>x.value);
function card(x,plat,can){return '<div class=card>'+(x.cover?'<img loading=lazy src="'+x.cover+'" onerror="this.style.display=0">':'')+
 '<div class=t>'+esc(x.title)+(x.lang?' <b style=color:#4ea1ff>['+esc(x.lang)+']</b>':'')+'</div><div class=id>'+plat+' · '+x.id+'</div>'+
 (can?'<button onclick="dl(\\''+plat+'\\',\\''+x.id+'\\',this)">⬇️ Tải BINGNET</button>':'<button class=alt disabled>tải: chưa hỗ trợ</button>')+'</div>';}
async function go(){const q=document.getElementById("q").value.trim(),lang=document.getElementById("lang").value,plats=sel();if(!q||!plats.length)return;
 document.getElementById("out").innerHTML="<div class=grp>Đang tìm "+plats.length+" platform...</div>";
 const d=await(await fetch("/api/search?q="+encodeURIComponent(q)+"&lang="+lang+"&platforms="+plats.join(","))).json();
 document.getElementById("out").innerHTML=d.results.map(g=>{const h='<div class=grp>'+g.platform+' — '+g.items.length+' phim'+(g.status!=="ok"?'<span class=st>'+g.status+'</span>':'')+(g.canDl?' · TẢI ĐƯỢC':'')+'</div>';
  return g.items.length?h+'<div class=grid>'+g.items.map(x=>card(x,g.platform,g.canDl)).join("")+'</div>':h;}).join("");}
async function dl(platform,id,btn){btn.disabled=true;btn.textContent="bắt đầu...";
 const lang=document.getElementById("lang").value,vs=document.getElementById("vietsub").checked?"&vietsub=1":"";
 const r=await(await fetch("/api/download?platform="+platform+"&id="+id+"&lang="+lang+vs)).json();
 if(r.error){alert(r.error);btn.textContent="✗";btn.disabled=false;return;}btn.textContent="⏳ tải...";poll(r.jobId,btn);}
function poll(job,btn){const box=document.getElementById("dl");box.style.display="block";
 const t=setInterval(async()=>{const j=await(await fetch("/api/progress?job="+job)).json();
  let sub=(j.subTotal!=null)?"<br>vietsub: "+(j.subDone||0)+"/"+j.subTotal:"";
  box.innerHTML="<b>"+esc(j.platform+" "+j.id)+"</b><br>tải: "+j.done+"/"+j.total+" tập"+(j.failed?" (lỗi "+j.failed+")":"")+sub+"<br>"+esc(j.status||"")+(j.dir?"<br><small>"+esc(j.dir)+"</small>":"");
  if(/^xong/.test(j.status||"")||/lỗi|không lấy/.test(j.status||"")){clearInterval(t);btn.textContent=/^xong/.test(j.status||"")?"✅":"✗";btn.disabled=false;}},2000);}
async function library(){
 const d=await(await fetch("/api/library")).json();
 if(!d.length){document.getElementById("out").innerHTML="<div class=grp>Chưa có phim nào tải về.</div>";return;}
 document.getElementById("out").innerHTML=d.map(m=>{const nosub=m.episodes.filter(e=>!e.vietsub).length;
  return '<div class=grp>📁 '+esc(m.dir)+' — '+m.episodes.length+' tập'+(nosub?' · <button onclick="subVietsub(\\''+esc(m.dir)+'\\',this)" style="font-size:11px;padding:2px 8px;border-radius:6px">🇻🇳 Gắn vietsub ('+nosub+' chưa)</button>':' · ✅ đã sub hết')+'</div>'+
  '<div style="display:flex;flex-wrap:wrap;gap:6px">'+m.episodes.map(e=>'<button class="'+(e.vietsub?"":"alt")+'" style="padding:6px 10px;border-radius:6px;'+(e.vietsub?"":"background:var(--card);color:var(--mut);border:1px solid var(--line)")+'" onclick="playVid(\\''+encodeURIComponent(e.file)+'\\')">ep'+e.no+(e.vietsub?" 🇻🇳":"")+'</button>').join("")+'</div>';}).join("");
}
function subVietsub(dir,btn){btn.disabled=true;btn.textContent="⏳ đang dịch+burn...";
 fetch("/api/vietsub?dir="+encodeURIComponent(dir)).then(r=>r.json()).then(r=>{if(r.error){alert(r.error);btn.disabled=false;return;}
  const box=document.getElementById("dl");box.style.display="block";
  const t=setInterval(async()=>{const j=await(await fetch("/api/progress?job="+r.jobId)).json();
   box.innerHTML="<b>vietsub "+esc(dir)+"</b><br>"+(j.subDone||0)+"/"+(j.subTotal||"?")+" tập<br>"+esc(j.status||"");
   if(/^xong/.test(j.status||"")){clearInterval(t);btn.textContent="✅ xong";library();}},2000);});}
function playVid(f){const p=document.getElementById("player");p.style.display="block";p.src="/media?f="+f;p.scrollIntoView({behavior:"smooth"});p.play();}
function esc(s){return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}
</script></body></html>`;
