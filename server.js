// Simple proxy server for 52api.cn short-drama APIs.
// - Serves the static UI from ./public
// - Proxies to 52api.cn so the browser never hits CORS and the key stays server-side.
//
// Run:  API52_KEY=your_key_here node server.js
// or edit API_KEY below, then:  node server.js
// Open: http://localhost:3000

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

// ---- Config -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
// Put your 52api.cn key here, or pass it via env: API52_KEY=xxx node server.js
const API_KEY = process.env.API52_KEY || 'PUT_YOUR_52API_KEY_HERE';

// Which upstream endpoint to use. Both share the exact same params.
//   hm_duanju = 河马短剧 (Hippo) | hg_duanju = 红果短剧 (Hongguo)
const SOURCES = {
  hm: 'https://www.52api.cn/api/hm_duanju',
  hg: 'https://www.52api.cn/api/hg_duanju',
};

const log = (...a) => console.log('[server]', ...a);

// ---- Upstream call ------------------------------------------------------
function callUpstream(params) {
  const source = SOURCES[params.source] || SOURCES.hm;
  const u = new URL(source);
  u.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (k === 'source' || v == null || v === '') continue;
    u.searchParams.set(k, v);
  }
  return new Promise((resolve, reject) => {
    https
      .get(u.toString(), (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            // Return raw text if it isn't JSON (e.g. an error page)
            resolve({ code: -1, msg: 'Upstream did not return JSON', raw: body });
          }
        });
      })
      .on('error', reject);
  });
}

// ---- Static files -------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.vtt': 'text/vtt' };
function serveStatic(res, file) {
  const full = path.join(__dirname, 'public', file);
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'text/plain' });
    res.end(data);
  });
}

// ---- Server -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Subtitle generation (Whisper + Gemini) --------------------------------
  if (url.pathname === '/api/subtitle') {
    const source = url.searchParams.get('source') || 'hm';
    const id = url.searchParams.get('id') || '';
    const video_id = url.searchParams.get('video_id') || '';
    const outRel = `subs/${video_id}.vi.vtt`;
    const outAbs = path.join(__dirname, 'public', outRel);
    const respond = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (fs.existsSync(outAbs)) return respond({ ready: true, cached: true, url: '/' + outRel });

    try {
      const vid = await callUpstream({ source, type: 'video', id, video_id });
      const mp4 = vid && vid.data && vid.data.chapterUrl;
      if (!mp4) return respond({ ready: false, msg: 'Không lấy được chapterUrl: ' + (vid && vid.msg) });

      log(`subtitle: bắt đầu cho video_id=${video_id}`);
      const py = spawn('python3', [path.join(__dirname, 'subtitle.py'), '--url', mp4, '--out', outAbs],
        { env: process.env });
      let err = '';
      py.stderr.on('data', (d) => { err += d; process.stderr.write(d); });
      py.on('close', (code) => {
        if (code === 0 && fs.existsSync(outAbs)) respond({ ready: true, url: '/' + outRel });
        else respond({ ready: false, msg: 'Script lỗi (code ' + code + '). ' + err.split('\n').slice(-4).join(' ') });
      });
    } catch (e) {
      respond({ ready: false, msg: 'Lỗi: ' + e.message });
    }
    return;
  }

  // API proxy routes ------------------------------------------------------
  if (url.pathname.startsWith('/api/')) {
    const source = url.searchParams.get('source') || 'hm';
    let params = { source };

    if (url.pathname === '/api/search') {
      params.type = 'search';
      params.keyword = url.searchParams.get('keyword') || '';
      params.page = url.searchParams.get('page') || '1';
    } else if (url.pathname === '/api/detail') {
      params.type = 'detail';
      params.id = url.searchParams.get('id') || '';
    } else if (url.pathname === '/api/video') {
      params.type = 'video';
      params.id = url.searchParams.get('id') || '';
      params.video_id = url.searchParams.get('video_id') || '';
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: -1, msg: 'Unknown route' }));
      return;
    }

    if (API_KEY === 'PUT_YOUR_52API_KEY_HERE') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: -1, msg: 'Chưa cấu hình API key. Sửa API_KEY trong server.js hoặc chạy: API52_KEY=xxx node server.js' }));
      return;
    }

    try {
      const data = await callUpstream(params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: -1, msg: 'Proxy error: ' + e.message }));
    }
    return;
  }

  // Static -----------------------------------------------------------------
  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveStatic(res, 'index.html');
  } else {
    serveStatic(res, url.pathname.replace(/^\//, ''));
  }
});

server.listen(PORT, () => {
  console.log(`\n  ▶ Short-drama demo chạy tại: http://localhost:${PORT}`);
  console.log(`  ▶ API key: ${API_KEY === 'PUT_YOUR_52API_KEY_HERE' ? '❌ CHƯA CẤU HÌNH' : '✅ đã nạp'}\n`);
});
