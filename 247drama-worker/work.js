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

// Thuần: từ danh sách tập nguồn + tập đã có -> tập còn thiếu (theo episodeNumber = index).
function computeMissingEpisodes(detailEpisodes, existingNumbers) {
  return (detailEpisodes || []).filter((ep) => !existingNumbers.has(ep.index));
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

    const existing = await ShortVideo.find({ movieSeries: m._id }).select("episodeNumber").lean();
    const existingNumbers = new Set(existing.map((e) => e.episodeNumber));
    const missing = computeMissingEpisodes(episodes, existingNumbers);

    if (missing.length) {
      work.push({
        series: { _id: m._id, name: m.name, thumbnail: m.thumbnail || "" },
        provider,
        sourceId,
        episodes,
        missing,
      });
    }
  }
  return work;
}

module.exports = { computeMissingEpisodes, findPendingWork, extract52apiSource };
