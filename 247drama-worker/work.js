const duanju = require("./util/duanjuProvider");
const { MovieSeries, ShortVideo } = require("./db");

const PROVIDERS = ["hg", "hm"];
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
    const m = String(series.sourceProvider).match(/^52api-(hg|hm)$/);
    if (m) provider = m[1];
  }
  return { provider, sourceId };
}

// Thuần: đối chiếu danh sách tập nguồn với bản ghi đã có.
// Số tập của ta là VỊ TRÍ trong danh sách nguồn (detail() gán index = i), nên nguồn chèn/xoá/
// đảo một tập là mọi vị trí sau đó trỏ sai phim. Định danh ổn định duy nhất là videoId, đã lưu
// trong ShortVideo.sourceVideoId -> dùng nó để phát hiện lệch và TỪ CHỐI ghi đè.
// Bản ghi cũ chưa có sourceVideoId thì coi là hợp lệ (cả kho cũ nhập trước khi worker ghi field này).
function classifyEpisodes(detailEpisodes, existingRows) {
  const byIndex = new Map((existingRows || []).map((r) => [r.episodeNumber, r]));
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
      drift.push({ index: ep.index, storedVideoId: stored, sourceVideoId: String(ep.videoId) });
    }
  }
  return { missing, drift };
}

// Quét mọi phim 52api, trả về danh sách việc cần render (chỉ phim còn thiếu tập).
async function findPendingWork() {
  const movies = await MovieSeries.find({ sourceProvider: /^52api-/ })
    .select("_id name thumbnail bookId sourceProvider sourceEpisodeCount")
    .lean();

  const work = [];
  for (const m of movies) {
    const { provider, sourceId } = extract52apiSource(m);
    if (!provider || !sourceId) continue;

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
    const { missing, drift } = classifyEpisodes(episodes, existing);

    if (drift.length) {
      console.warn(`[work] ${m.name}: ${drift.length} tập LỆCH videoId (nguồn đổi thứ tự) -> bỏ qua, không ghi đè`);
    }

    if (missing.length || drift.length) {
      work.push({
        series: { _id: m._id, name: m.name, thumbnail: m.thumbnail || "" },
        provider,
        sourceId,
        episodes,
        missing,
        drift,
      });
    }
  }
  return work;
}

module.exports = { classifyEpisodes, findPendingWork, extract52apiSource };
