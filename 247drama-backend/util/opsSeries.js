// Dựng bản ghi MovieSeries cho phim nhập từ web vận hành.
// Hai field sống còn: bookId "<provider>:<sourceId>" (worker đọc qua extract52apiSource) và
// sourceProvider "52api-<provider>" (findPendingWork lọc theo field này). Sai một trong hai
// là worker không bao giờ nhặt phim đó.
const PROVIDERS = ["hg", "hm"];

function buildSeriesDoc({ provider, sourceId, info, categoryId, languageId, type }) {
  const p = String(provider || "").toLowerCase();
  if (!PROVIDERS.includes(p)) throw new Error(`provider không hợp lệ: ${provider}`);
  if (!sourceId) throw new Error("thiếu sourceId");
  if (!info || !info.name) throw new Error("nguồn không trả về tên phim");
  if (!categoryId) throw new Error("thiếu category");
  if (!languageId) throw new Error("thiếu language");

  return {
    name: info.name,
    description: info.description || "",
    thumbnail: info.cover || "",
    banner: info.cover || "",
    bookId: `${p}:${sourceId}`,
    sourceProvider: `52api-${p}`,
    sourceEpisodeCount: info.episodeCount || 0,
    category: categoryId,
    language: languageId,
    type,
    maxAdsForFreeView: 0,
    isActive: true,
    createdByOps: true,
  };
}

module.exports = { buildSeriesDoc };
