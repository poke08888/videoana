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
  // categoryId để trống = chọn "tự động theo nội dung": máy xếp thể loại ngay sau khi nhập,
  // nên bản ghi tạm thời chưa có thể loại. language thì vẫn bắt buộc vì không đoán được.
  if (!languageId) throw new Error("thiếu language");

  // meta = kết quả translateSeriesMeta. Ngôn ngữ nào dịch được thì lưu ngôn ngữ đó; ngôn ngữ
  // hụt nằm ở metaMissingLangs để web vận hành hiện nút dịch lại. Không dịch được chữ nào thì
  // giữ nguyên tiếng Trung — vẫn nhập phim, không chặn.
  const i18n = (meta && meta.i18n) || {};
  const vi = i18n.vi || {};
  const en = i18n.en || {};

  return {
    name: vi.name || info.name,
    description: vi.description || info.description || "",
    nameEn: en.name || "",
    descriptionEn: en.description || "",
    i18n,
    metaMissingLangs: (meta && meta.missing) || [],
    nameOriginal: info.name,
    descriptionOriginal: info.description || "",
    metaTranslatedAt: Object.keys(i18n).length ? new Date() : null,
    thumbnail: info.cover || "",
    banner: info.cover || "",
    bookId: `${p}:${sourceId}`,
    sourceProvider: `52api-${p}`,
    sourceEpisodeCount: info.episodeCount || 0,
    category: categoryId || null,
    language: languageId,
    type,
    maxAdsForFreeView: 0,
    isActive: true,
    createdByOps: true,
  };
}

module.exports = { buildSeriesDoc };
