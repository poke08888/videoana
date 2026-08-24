/**
 * duanjuProvider.js
 *
 * Wrapper cho API short-drama của 52api.cn (https://www.52api.cn).
 * Hỗ trợ 2 nguồn:
 *   - "hg" => hg_duanju (红果短剧)
 *   - "hm" => hm_duanju (河马短剧)
 *
 * Config đọc runtime từ global.settingJSON.chineseDramaApi (lưu trong Setting DB),
 * KHÔNG lưu trong .env (theo convention resendApiKey / payment keys của dự án).
 *
 * Vì 52api giới hạn tốc độ (gói free ~1 request / 3 giây, trả phí tới 20 QPS),
 * mọi request tới 52api đi qua một hàng đợi throttle dùng chung theo minRequestIntervalMs.
 */

const { default: axios } = require("axios");
const { createGate } = require("./gate");
const https = require("https");

// proxy agents (chỉ dùng cho tải video hm khi CDN cbread.cn bị chặn từ server)
let HttpsProxyAgent, SocksProxyAgent;
try {
  ({ HttpsProxyAgent } = require("https-proxy-agent"));
} catch (e) {}
try {
  ({ SocksProxyAgent } = require("socks-proxy-agent"));
} catch (e) {}

// force IPv4 (giống code DramaBox có sẵn) + keep-alive để tái dùng kết nối tới CDN
const agent = new https.Agent({ family: 4, keepAlive: true });

// Tạo proxy agent từ settingJSON.chineseDramaApi.proxyUrl (http(s):// hoặc socks5://). Cache theo url.
let _proxyCache = { url: null, agent: null };
function getProxyAgent() {
  const url = (getConfig().proxyUrl || "").trim();
  if (!url) return null;
  if (_proxyCache.url === url) return _proxyCache.agent;
  let ag = null;
  try {
    if (/^socks/i.test(url)) {
      ag = SocksProxyAgent ? new SocksProxyAgent(url) : null;
    } else {
      ag = HttpsProxyAgent ? new HttpsProxyAgent(url) : null;
    }
  } catch (e) {
    console.error("[52api] proxy agent lỗi:", e.message);
    ag = null;
  }
  _proxyCache = { url, agent: ag };
  return ag;
}

// ---- config ----
function getConfig() {
  const cfg = (global.settingJSON && global.settingJSON.chineseDramaApi) || {};
  return {
    enabled: !!cfg.enabled,
    apiKey: cfg.apiKey || "",
    hgBaseUrl: cfg.hgBaseUrl || "https://www.52api.cn/api/hg_duanju",
    hmBaseUrl: cfg.hmBaseUrl || "https://www.52api.cn/api/hm_duanju",
    hgTopBaseUrl: cfg.hgTopBaseUrl || "https://www.52api.cn/api/hg_new_top",
    hgDecryptUrl: cfg.hgDecryptUrl || "https://www.52api.cn/api/hg_decrypt",
    hgPlayUrl: cfg.hgPlayUrl || "https://www.52api.cn/api/hg_play",
    dlBaseUrl: cfg.dlBaseUrl || "https://www.52api.cn/api/dongli", // nguồn 东梨, video h264 sẵn
    hgDefinition: cfg.hgDefinition || "1080p", // chất lượng ưu tiên khi lấy link qua hg_play
    minRequestIntervalMs: Number(cfg.minRequestIntervalMs) || 3100,
    proxyUrl: cfg.proxyUrl || "",
  };
}

// ---- throttle dùng chung cho toàn bộ request tới 52api (rate limit theo key) ----
let lastRequestAt = 0;
let queue = Promise.resolve();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gate() {
  const { minRequestIntervalMs } = getConfig();
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + minRequestIntervalMs - now);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

// Chạy fn sau khi tới lượt trong hàng đợi (đảm bảo cách nhau minRequestIntervalMs).
// Lỗi của fn được propagate cho caller nhưng KHÔNG làm hỏng hàng đợi cho request sau.
function throttle(fn) {
  const run = queue.then(() => gate()).then(fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---- low level request ----
// Gọi 1 endpoint 52api bất kỳ (qua throttle dùng chung), trả về body.data hoặc throw.
async function apiGet(baseUrl, params) {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    throw new Error("52api chưa được cấu hình (thiếu apiKey trong Setting.chineseDramaApi)");
  }

  const res = await throttle(() =>
    axios.get(baseUrl, {
      params: { key: cfg.apiKey, ...params },
      httpsAgent: agent,
      timeout: 30000,
    }),
  );

  const body = res.data;
  if (!body || body.code !== 200) {
    const err = new Error(`52api trả lỗi: ${body ? body.msg : "no body"} (code ${body ? body.code : "?"})`);
    err.apiCode = body ? body.code : undefined;
    // "超出免费总额度" = hết quota miễn phí của key. Đánh dấu để bên gọi biết mà DỪNG, đừng
    // hỏi tiếp: đã có 22.883 lượt gọi hỏng vì lý do này nằm trong log, mỗi vòng quét lại nện
    // thêm một lượt cho từng phim.
    err.outOfQuota = /超出免费总额度|额度/.test(String(body && body.msg));
    throw err;
  }
  return body.data;
}

async function request(provider, params) {
  const cfg = getConfig();
  const baseUrl = provider === "hm" ? cfg.hmBaseUrl : provider === "dl" ? cfg.dlBaseUrl : cfg.hgBaseUrl;
  return apiGet(baseUrl, params);
}

// ---- hg_decrypt (doc/130): giải mã link video 红果 ----
// hg_duanju?type=video trả link ĐÃ MÃ HÓA + decrypt_key. Phải POST (form-urlencoded) qua
// hg_decrypt để lấy link mp4 giải mã (host hg-cache*.52api.cn, hạn dùng ngắn ~vài phút).
// Đi chung throttle với các request 52api khác (tính quota theo key).
async function apiPost(baseUrl, form) {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    throw new Error("52api chưa được cấu hình (thiếu apiKey trong Setting.chineseDramaApi)");
  }
  const body = new URLSearchParams({ key: cfg.apiKey, ...form }).toString();
  const res = await throttle(() =>
    axios.post(baseUrl, body, {
      httpsAgent: agent,
      timeout: 60000,
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    }),
  );
  const b = res.data;
  if (!b || b.code !== 200) {
    const err = new Error(`52api trả lỗi: ${b ? b.msg : "no body"} (code ${b ? b.code : "?"})`);
    err.apiCode = b ? b.code : undefined;
    throw err;
  }
  return b.data;
}

// Giải mã 1 link video hg -> url mp4 đã giải mã. Trả "" nếu không có url.
async function hgDecrypt(encUrl, decryptKey) {
  const baseUrl = getConfig().hgDecryptUrl;
  const b64 = Buffer.from(String(encUrl), "utf8").toString("base64");
  const data = await apiPost(baseUrl, { url: b64, decrypt_key: decryptKey });
  return (data && data.url) || "";
}

// ---- hg_play (doc/136): link phát 红果 KHÔNG mã hóa (绕加密) ----
// Trả link h264 chuẩn (720p/1080p) truyền thẳng video_id, KHỎI giải mã -> hết lỗi đen màn hình
// do cloud decrypt hỏng (bvc2/NAL nát). 52api lưu ý: kênh này có thể mất hiệu lực bất kỳ lúc nào
// -> caller phải fallback về flow decrypt cũ khi lỗi.
async function hgPlay(videoId) {
  const cfg = getConfig();
  const data = await apiGet(cfg.hgPlayUrl, { video_id: videoId });
  const lists = (data && data.lists) || [];
  if (!lists.length) return null;
  const pick = lists.find((x) => x.definition === cfg.hgDefinition) || lists[0];
  if (!pick || !pick.main_url) return null;
  return {
    mp4Url: pick.main_url,
    durationText: pick.video_duration || "",
    definition: pick.definition || "",
  };
}

// ---- normalized API ----

// Tìm kiếm phim theo keyword. Trả về danh sách chuẩn hoá.
async function search(provider, keyword, page = 1) {
  // dl CẤM tham số page: gửi kèm là API trả "参数 page 未配置，禁止传递" (code 400).
  const params = provider === "dl" ? { type: "search", keyword } : { type: "search", keyword, page };
  const data = await request(provider, params);

  if (provider === "hm") {
    const lists = (data && data.lists) || [];
    return lists.map((it) => ({
      sourceId: String(it.id),
      title: it.name || "",
      cover: it.cover || "",
      intro: it.introduction || "",
      episodeCount: it.updateNum || 0,
      tags: Array.isArray(it.tags) ? it.tags : [],
    }));
  }

  if (provider === "dl") {
    const arr = Array.isArray(data) ? data : (data && (data.list || data.lists)) || [];
    return arr.map((it) => ({
      sourceId: String(it.id),
      title: it.title || "",
      cover: it.cover || "",
      intro: it.introduction || "",
      episodeCount: it.total || 0,
      tags: Array.isArray(it.desc_tags) ? it.desc_tags : [],
    }));
  }

  // hg: data là mảng
  const arr = Array.isArray(data) ? data : [];
  return arr.map((it) => ({
    sourceId: String(it.id),
    title: it.title || "",
    cover: it.cover || "",
    intro: it.intro || "",
    episodeCount: it.chapter_number || 0,
    tags: it.type ? String(it.type).split(",") : [],
  }));
}

// Lấy chi tiết + danh sách tập (video_id) của 1 phim.
// Nguồn dl trả THẲNG link video trong phần chi tiết, kèm hạn dùng. Nhớ lại trong ít phút để
// render nhiều tập của cùng một phim không phải gọi lại API cho từng tập (mỗi lượt gọi bị chặn
// hơn 3 giây). Hết hạn nhớ thì gọi lại, không dùng link cũ vì link sẽ chết.
const DL_CACHE_MS = 8 * 60 * 1000;
const dlCache = new Map(); // "dl:<id>" -> { at, urls: Map<videoId, url> }

async function detail(provider, id) {
  const data = await request(provider, { type: "detail", id });
  const lists = (data && data.lists) || [];

  if (provider === "dl") {
    const urls = new Map();
    const episodes = lists.map((ep, i) => {
      const vid = String(ep.id);
      if (ep.video_url) urls.set(vid, ep.video_url);
      return { index: i, videoId: vid, title: ep.title || `第${i + 1}集` };
    });
    dlCache.set(`dl:${id}`, { at: Date.now(), urls });
    return {
      title: data.title || "",
      cover: data.cover || "",
      description: data.introduction || data.desc || "",
      tags: Array.isArray(data.desc_tags) ? data.desc_tags : [],
      episodes,
    };
  }

  const episodes = lists.map((ep, i) => ({
    index: i, // 0-based: tập đầu = 0 (trailer theo mô hình app)
    videoId: String(ep.video_id),
    title: ep.title || ep.name || `第${i + 1}集`,
  }));

  if (provider === "hm") {
    return {
      title: data.name || "",
      cover: data.cover || "",
      description: data.introduction || "",
      tags: Array.isArray(data.tags) ? data.tags : [],
      episodes,
    };
  }

  return {
    title: data.title || "",
    cover: data.book_pic || "",
    description: data.desc || "",
    tags: Array.isArray(data.category) ? data.category : [],
    episodes,
  };
}

// ---- hg_new_top: bảng xếp hạng 红果 (duyệt top, khỏi cần từ khoá) ----

// Lấy danh mục các bảng xếp hạng + mục con.
async function hgTopCategories() {
  const data = await apiGet(getConfig().hgTopBaseUrl, { type: "top" });
  const lists = (data && data.lists) || [];
  return lists.map((c) => ({
    cellId: c.cell_id,
    cellName: c.cell_name,
    subs: (c.sub_lists || []).map((s) => ({
      subCellId: s.sub_cell_id || "",
      subCellName: s.sub_cell_name,
    })),
  }));
}

// Lấy danh sách phim trong 1 bảng xếp hạng. Chuẩn hoá giống search (để tái dùng UI + import).
async function hgTopList(cellId, subCellId = "", page = 1) {
  const params = { type: "list", cell_id: cellId, page };
  if (subCellId) params.sub_cell_id = subCellId;
  const data = await apiGet(getConfig().hgTopBaseUrl, params);
  const lists = (data && data.lists) || [];
  return lists.map((it) => ({
    sourceId: String(it.id),
    title: it.title || "",
    cover: it.cover || "",
    intro: it.desc || "",
    episodeCount: it.episode_num || 0,
    tags: it.type ? String(it.type).split(",") : [],
  }));
}

// Resolve link phát (mp4) của 1 tập.
// hg: chỉ cần video_id. hm: cần cả id + video_id.
async function resolveVideo(provider, id, videoId) {
  if (provider === "dl") {
    const hit = dlCache.get(`dl:${id}`);
    if (hit && Date.now() - hit.at < DL_CACHE_MS && hit.urls.has(String(videoId))) {
      return { mp4Url: hit.urls.get(String(videoId)), thumbnail: "", index: null, durationText: "" };
    }
    await detail("dl", id); // nạp lại link (link cũ đã hết hạn nhớ)
    const fresh = dlCache.get(`dl:${id}`);
    const url = fresh && fresh.urls.get(String(videoId));
    if (!url) throw new Error(`dl: không có link cho tập ${videoId}`);
    return { mp4Url: url, thumbnail: "", index: null, durationText: "" };
  }

  const params =
    provider === "hm" ? { type: "video", id, video_id: videoId } : { type: "video", video_id: videoId };

  if (provider === "hm") {
    const data = await request(provider, params);
    return {
      mp4Url: data.chapterUrl || "",
      thumbnail: data.chapterCover || "",
      index: data.chapterIndex,
    };
  }
  // hg: ƯU TIÊN hg_play (link h264 không mã hóa, chuẩn phát mọi trình duyệt).
  // hg_play lỗi/mất hiệu lực -> fallback flow cũ: type=video + hg_decrypt (thử lại vài lần
  // theo khuyến cáo 52api vì cloud decrypt có tỉ lệ thất bại).
  try {
    const p = await hgPlay(videoId);
    if (p && p.mp4Url) {
      return { mp4Url: p.mp4Url, thumbnail: "", index: null, durationText: p.durationText };
    }
    console.warn("[52api] hg_play không có luồng -> fallback decrypt.");
  } catch (e) {
    console.warn("[52api] hg_play lỗi:", e.message, "-> fallback decrypt.");
  }

  const data = await request(provider, params);
  let playUrl = data.url || "";
  if (playUrl && data.decrypt_key) {
    let decUrl = "";
    for (let attempt = 1; attempt <= 3 && !decUrl; attempt++) {
      try {
        decUrl = await hgDecrypt(playUrl, data.decrypt_key);
        if (!decUrl) console.error(`[52api] hg_decrypt không trả url (lần ${attempt}/3).`);
      } catch (e) {
        console.error(`[52api] hg_decrypt lỗi (lần ${attempt}/3):`, e.message);
      }
    }
    if (decUrl) playUrl = decUrl;
    else console.error("[52api] hg_decrypt thất bại cả 3 lần -> dùng link gốc (có thể lỗi phát).");
  }
  return {
    mp4Url: playUrl,
    thumbnail: "",
    index: null,
    durationText: data.duration || "",
  };
}

// Tải một URL (mp4 / ảnh) về Buffer. Không đi qua throttle vì hit CDN, không phải 52api.
// CDN video TQ (cbread.cn / qznovelvod.com) hay reset kết nối từ server nước ngoài
// -> retry nhiều lần với backoff + header giống trình duyệt. Retry ở đây KHÔNG tốn quota 52api.
// useProxy=true: đi qua proxy (dùng cho hm vì cbread.cn chặn TLS từ server VN).
// Tải qua proxy phải xếp hàng: mọi luồng đi ra bằng CÙNG một IP của VPS, mà CDN Trung Quốc
// bóp băng thông theo IP. Mở 6 luồng thì mỗi luồng chỉ còn một phần tốc độ, kết nối treo quá
// hạn rồi bị tính là lỗi, trong khi tổng lượng tải về không hơn. Tải trực tiếp (hg) không qua
// cổng này vì mỗi tập đi thẳng tới CDN, không chung nút thắt nào.
const proxyGate = createGate(process.env.PROXY_DOWNLOAD_CONCURRENCY || 2);

async function downloadToBuffer(url, opts = {}) {
  if (opts.useProxy) return proxyGate.run(() => downloadOnce(url, opts));
  return downloadOnce(url, opts);
}

async function downloadOnce(url, { timeout = 120000, retries = 4, useProxy = false } = {}) {
  const proxyAgent = useProxy ? getProxyAgent() : null;
  const httpsAgent = proxyAgent || agent;
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        httpsAgent,
        proxy: false, // ép dùng httpsAgent (proxy agent), bỏ qua biến môi trường
        timeout,
        maxContentLength: 300 * 1024 * 1024,
        maxBodyLength: 300 * 1024 * 1024,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "*/*",
        },
      });
      return Buffer.from(res.data);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(1200 * attempt); // 1.2s, 2.4s, 3.6s
    }
  }
  throw lastErr;
}

module.exports = {
  PROVIDERS: ["hg", "hm", "dl"],
  getConfig,
  search,
  detail,
  resolveVideo,
  downloadToBuffer,
  hgTopCategories,
  hgTopList,
  hgPlay,
};
