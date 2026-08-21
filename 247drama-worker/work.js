const duanju = require("./util/duanjuProvider");
const { MovieSeries, ShortVideo } = require("./db");
const { env } = require("./config");

const PROVIDERS = ["hg", "hm", "dl"];
function normalizeProvider(p) {
  const v = String(p || "").toLowerCase();
  return PROVIDERS.includes(v) ? v : null;
}

// Khớp extract52apiSource của server: ưu tiên bookId "hg:<id>", fallback sourceProvider.
function extract52apiSource(series) {
  let provider = null;
  let sourceId = null;
  if (series && series.bookId && series.bookId.includes(":")) {
    const [p, sid] = series.bookId.split(":");
    provider = normalizeProvider(p);
    sourceId = sid;
  }
  if (!provider && series && series.sourceProvider) {
    const m = String(series.sourceProvider).match(/^52api-(hg|hm|dl)$/);
    if (m) provider = m[1];
  }
  return { provider, sourceId };
}

// Thuần: đối chiếu danh sách tập nguồn với bản ghi đã có.
// Số tập của ta là VỊ TRÍ trong danh sách nguồn (detail() gán index = i), nên nguồn chèn/xoá/
// đảo một tập là mọi vị trí sau đó trỏ sai phim. Định danh ổn định duy nhất là videoId, đã lưu
// trong ShortVideo.sourceVideoId -> dùng nó để phát hiện lệch và TỪ CHỐI ghi đè.
// Bản ghi cũ chưa có sourceVideoId thì coi là hợp lệ (cả kho cũ nhập trước khi worker ghi field này).
// badEps = số tập mà backend chấm là HỎNG (thiếu video hoặc không có lấy một dòng phụ đề
// Việt). Có bản ghi nên vòng quét coi như "đã xong" và không bao giờ làm lại — phim vì thế
// nằm ngoài app vĩnh viễn. Đưa những tập đó vào danh sách cần làm để render đè lên.
function classifyEpisodes(detailEpisodes, existingRows, badEps) {
  const byIndex = new Map((existingRows || []).map((r) => [r.episodeNumber, r]));
  const bad = new Set(badEps || []);
  const missing = [];
  const drift = [];
  for (const ep of detailEpisodes || []) {
    const row = byIndex.get(ep.index);
    if (!row) {
      missing.push(ep);
      continue;
    }
    const stored = row.sourceVideoId ? String(row.sourceVideoId) : "";
    if (stored && stored !== String(ep.videoId)) {
      // Lệch thì KHÔNG đụng vào, kể cả khi tập đang hỏng: nguồn đã xáo thứ tự nên render đè
      // sẽ ghép nội dung mới vào giữa dàn tập cũ. Để người vận hành xử lý cả phim.
      drift.push({ index: ep.index, storedVideoId: stored, sourceVideoId: String(ep.videoId) });
      continue;
    }
    if (bad.has(ep.index)) missing.push(ep);
  }
  return { missing, drift };
}

// Quét mọi phim 52api, trả về danh sách việc cần render (chỉ phim còn thiếu tập).
async function findPendingWork() {
  // Phim MỚI NHẬP chạy trước: người vận hành vừa thêm phim thì mong thấy nó về ngay, chứ
  // không phải chờ hết vài nghìn tập của những phim thêm từ tháng trước. Thứ tự tự nhiên của
  // Mongo là thứ tự ghi, nên phim mới luôn nằm cuối hàng và có khi chờ cả ngày mới tới lượt.
  // Lọc theo CẢ HAI dấu hiệu nguồn: phim nhập bằng script ngoài web vận hành có khi chỉ có
  // bookId "<nguồn>:<id>" mà thiếu sourceProvider — lọc mỗi sourceProvider là 32 phim như vậy
  // nằm im mãi mãi, không máy nào nhặt.
  const movies = await MovieSeries.find({ $or: [{ sourceProvider: /^52api-/ }, { bookId: /^(hg|hm|dl):/ }] })
    .select("_id name thumbnail bookId sourceProvider sourceEpisodeCount zhBottomRatio zhBottomSource completeness createdAt")
    .sort({ createdAt: -1 })
    .lean();

  const work = [];
  for (const m of movies) {
    const { provider, sourceId } = extract52apiSource(m);
    if (!provider || !sourceId) continue;
    // Lọc TRƯỚC khi gọi detail: mỗi lượt gọi 52api bị chặn 3,2 giây, quét phim mình không
    // render là phí thời gian lẫn quota.
    if (!env.providers.includes(provider)) continue;

    let info;
    try {
      info = await duanju.detail(provider, sourceId); // đi qua throttle 52api
    } catch (e) {
      console.error(`[work] detail lỗi ${provider}:${sourceId}:`, e.message);
      continue;
    }
    const episodes = info.episodes || [];
    if (!episodes.length) continue;

    const existing = await ShortVideo.find({ movieSeries: m._id })
      .select("episodeNumber sourceVideoId")
      .lean();
    const badEps = (m.completeness && m.completeness.badEps) || [];
    const { missing, drift } = classifyEpisodes(episodes, existing, badEps);
    const redo = missing.filter((ep) => badEps.includes(ep.index)).length;
    if (redo) console.log(`[work] ${m.name}: ${redo} tập hỏng -> render lại`);

    if (drift.length) {
      console.warn(`[work] ${m.name}: ${drift.length} tập LỆCH videoId (nguồn đổi thứ tự) -> bỏ qua, không ghi đè`);
    }

    if (missing.length || drift.length) {
      work.push({
        createdAt: m.createdAt ? new Date(m.createdAt).getTime() : 0,
        // Phải mang theo mức chữ Hán đã chốt của phim: render.js đọc series.zhBottomRatio để
        // đặt dòng phụ đề. Thiếu hai field này thì tập nào OCR không tự đo được vị trí sẽ bị
        // bỏ, dù phim đã chốt mức từ lâu — cả trăm tập rơi mỗi vòng quét mà không ai hiểu vì sao.
        series: {
          _id: m._id,
          name: m.name,
          thumbnail: m.thumbnail || "",
          zhBottomRatio: typeof m.zhBottomRatio === "number" ? m.zhBottomRatio : null,
          zhBottomSource: m.zhBottomSource || "",
        },
        provider,
        sourceId,
        episodes,
        missing,
        drift,
      });
    }
  }
  return sortWork(work);
}

// Phim GẦN XONG làm trước. Đích của cả hệ thống là phim lên app, mà phim chỉ lên khi đủ tập —
// làm nốt phim còn thiếu 1 tập thì vài phút sau app có thêm một phim, còn bắt đầu một phim 80
// tập thì hai tiếng nữa mới có gì để xem. Cùng số tập thiếu thì phim mới nhập được ưu tiên
// (người vận hành vừa thêm là mong thấy nó chạy).
function sortWork(work) {
  return (work || []).slice().sort((a, b) => {
    const d = (a.missing || []).length - (b.missing || []).length;
    if (d) return d;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

module.exports = { classifyEpisodes, findPendingWork, extract52apiSource, sortWork };
