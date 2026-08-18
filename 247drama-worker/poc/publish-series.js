// Đưa các tập _vietsub.mp4 của 1 series lên R2 + tạo trang WATCH (player + nút ◀ ▶ Next,
// tự chuyển tập) đặt trên server /uploads/. In URL xem cuối cùng.
// Dùng: node poc/publish-series.js <folder>   (vd netshort_2069683666620014593)
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { env } = require("./../config");
const { uploadToR2 } = require("./../util/r2");

const FOLDER = process.argv[2];
if (!FOLDER) { console.error("cần <folder>"); process.exit(1); }
const DIR = path.join(env.workDir, "shortdrama-downloads", FOLDER);
const KEY_PREFIX = `vietsub/${FOLDER}`;
const SERVER = env.server;

function run(cmd, args) {
  return new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (e, o) => (e ? rej(e) : res(o))));
}

async function main() {
  if (!fs.existsSync(DIR)) throw new Error("không thấy thư mục " + DIR);
  const files = fs.readdirSync(DIR).filter((f) => /^ep(\d+)_vietsub\.mp4$/.test(f) && !/^\._/.test(f));
  const eps = files.map((f) => ({ no: +f.match(/^ep(\d+)_/)[1], file: f })).sort((a, b) => a.no - b.no);
  if (!eps.length) throw new Error("chưa có tập _vietsub nào");
  console.log(`[publish] ${eps.length} tập vietsub -> R2...`);

  const out = [];
  for (const ep of eps) {
    const key = `${KEY_PREFIX}/ep${ep.no}.mp4`;
    const url = `${env.r2.publicBase}/${key}`;
    // upload nếu chưa có (HEAD tốn thời gian -> cứ upload đè, R2 immutable cache theo key)
    process.stdout.write(`\r[publish] up ep${ep.no}   `);
    await uploadToR2(fs.readFileSync(path.join(DIR, ep.file)), key, "video/mp4");
    out.push({ no: ep.no, url });
  }
  console.log(`\n[publish] xong upload ${out.length} tập`);

  // trang watch
  const title = FOLDER.replace(/_/g, " ");
  const html = PAGE(title, out);
  const localHtml = path.join(env.tmpDir, `watch-${FOLDER}.html`);
  fs.writeFileSync(localHtml, html);
  const remote = `${SERVER.uploadsPath}/watch-${FOLDER}.html`;
  const rsh = `sshpass -p ${JSON.stringify(SERVER.password)} ssh -o StrictHostKeyChecking=accept-new`;
  await run("rsync", ["-t", "-e", rsh, localHtml, `${SERVER.user}@${SERVER.host}:${remote}`]);
  await run("sshpass", ["-p", SERVER.password, "ssh", "-o", "StrictHostKeyChecking=accept-new", `${SERVER.user}@${SERVER.host}`, `chmod 644 ${remote}`]);
  console.log(`\n✅ XEM: http://${SERVER.host}/uploads/watch-${FOLDER}.html  (${out.length} tập)`);
}

function PAGE(title, eps) {
  const data = JSON.stringify(eps);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
:root{--bg:#0f1115;--card:#181b22;--line:#262b36;--tx:#e6e9ef;--mut:#8b93a3;--acc:#4ea1ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px system-ui,sans-serif}
.wrap{max-width:480px;margin:0 auto;padding:12px}
h1{font-size:16px;margin:6px 0 10px}
video{width:100%;border-radius:10px;background:#000;aspect-ratio:9/16;max-height:78vh}
.nav{display:flex;gap:8px;margin:10px 0}
.nav button{flex:1;background:var(--acc);color:#001;border:0;border-radius:8px;padding:12px;font-size:15px;font-weight:700;cursor:pointer}
.nav button:disabled{opacity:.4}
.now{text-align:center;color:var(--mut);font-size:13px;margin:6px 0}
.eps{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:6px;margin-top:10px}
.eps button{background:var(--card);color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:8px 0;cursor:pointer;font-size:13px}
.eps button.on{background:var(--acc);color:#001;font-weight:700;border:0}
</style></head><body><div class="wrap">
<h1>🎬 ${title}</h1>
<video id="v" controls autoplay playsinline></video>
<div class="now" id="now"></div>
<div class="nav"><button id="prev" onclick="go(idx-1)">◀ Tập trước</button><button id="next" onclick="go(idx+1)">Tập sau ▶</button></div>
<div class="eps" id="eps"></div>
</div><script>
const EPS=${data};let idx=0;const v=document.getElementById("v");
function go(i){if(i<0||i>=EPS.length)return;idx=i;v.src=EPS[i].url;v.play();render();window.scrollTo({top:0,behavior:"smooth"});}
function render(){document.getElementById("now").textContent="Tập "+EPS[idx].no+" / "+EPS.length+" tập";
 document.getElementById("prev").disabled=idx<=0;document.getElementById("next").disabled=idx>=EPS.length-1;
 document.getElementById("eps").innerHTML=EPS.map((e,i)=>'<button class="'+(i===idx?"on":"")+'" onclick="go('+i+')">'+e.no+'</button>').join("");}
v.addEventListener("ended",()=>{if(idx<EPS.length-1)go(idx+1);}); // tự chuyển tập
go(0);
</script></body></html>`;
}

main().catch((e) => { console.error("[publish] LỖI:", e.message); process.exit(1); });
