// Đối chiếu danh sách tập nguồn với bản ghi trong Mongo. Cùng quy tắc mà worker dùng:
// định danh thật là videoId, bản ghi cũ chưa có videoId thì coi là hợp lệ.
function diffEpisodes(sourceEpisodes, rows) {
  const byIndex = new Map((rows || []).map((r) => [r.episodeNumber, r]));
  const drift = [];
  const missing = [];
  let rendered = 0;
  for (const ep of sourceEpisodes || []) {
    const row = byIndex.get(ep.index);
    if (!row) {
      missing.push(ep.index);
      continue;
    }
    rendered++;
    const stored = row.sourceVideoId ? String(row.sourceVideoId) : "";
    if (stored && stored !== String(ep.videoId)) {
      drift.push({ index: ep.index, storedVideoId: stored, sourceVideoId: String(ep.videoId) });
    }
  }
  return { rendered, drift, missing };
}

module.exports = { diffEpisodes };
