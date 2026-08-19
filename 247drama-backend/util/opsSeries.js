// Dựng bản ghi MovieSeries cho phim nhập từ web vận hành.
// Hai field sống còn: bookId "<provider>:<sourceId>" (worker đọc qua extract52apiSource) và
// sourceProvider "52api-<provider>" (findPendingWork lọc theo field này). Sai một trong hai
// là worker không bao giờ nhặt phim đó.
const PROVIDERS = ["hg", "hm"];

function buildSeriesDoc({ provider, sourceId, info, categoryId, languageId, type, meta }) {
  const p = String(provider || "").toLowerCase();
  if (!PROVIDERS.includes(p)) throw new Error(`provider không hợp lệ: ${provider}`);
  if (!sourceId) throw new Error("thiếu sourceId");
  if (!info || !info.name) throw new Error("nguồn không trả về tên phim");
  if (!categoryId) throw new Error("thiếu category");
  if (!languageId) throw new Error("thiếu language");

  // meta = kết quả translateSeriesMeta. Không có (hoặc dịch hụt) thì giữ nguyên tiếng Trung
  // và để metaTranslatedAt trống -> web vận hành hiện phim đó là "chưa dịch" để bấm dịch lại.
  const vi = (meta && meta.vi) || {};
  const en = (meta && meta.en) || {};
  const translated = !!(meta && meta.ok);

  return {
    name: vi.name || info.name,
    description: vi.description || info.description || "",
    nameEn: translated ? en.name || "" : "",
    descriptionEn: translated ? en.description || "" : "",
    nameOriginal: info.name,
    descriptionOriginal: info.description || "",
    metaTranslatedAt: translated ? new Date() : null,
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
