// Bản đọc-only của provider 52api dùng cho web vận hành. Cố ý KHÔNG dùng lại
// controllers/admin (đang gọi api.sansekai.my.id — khác nguồn với worker).
// Hai thứ bắt buộc: giãn nhịp (cùng một key với worker, gọi dồn sẽ dính rate limit)
// và cache (mỗi lượt duyệt là một lượt API mất tiền thật).

const BASE = {
  hg: "https://www.52api.cn/api/hg_duanju",
  hm: "https://www.52api.cn/api/hm_duanju",
};
const TOP_BASE = "https://www.52api.cn/api/hg_new_top";

function createClient({ getKey, httpGet, minIntervalMs = 3200, cacheTtlMs = 600000, now = () => Date.now() }) {
  const cache = new Map(); // khoá -> { at, value }
  let queue = Promise.resolve();
  let lastAt = -Infinity;

  // Hàng đợi tuần tự: mọi request cách nhau tối thiểu minIntervalMs.
  function throttle(fn) {
    const run = queue.then(async () => {
      const wait = Math.max(0, lastAt + minIntervalMs - now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = now();
      return fn();
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function call(url, params) {
    const key = getKey();
    if (!key) throw new Error("chưa cấu hình key 52api trong Setting.chineseDramaApi");
    const cacheKey = url + "?" + JSON.stringify(params);
    const hit = cache.get(cacheKey);
    if (hit && now() - hit.at < cacheTtlMs) return hit.value;
    const data = await throttle(() => httpGet(url, { key, ...params }));
    cache.set(cacheKey, { at: now(), value: data });
    return data;
  }

  function baseOf(provider) {
    const b = BASE[String(provider || "").toLowerCase()];
    if (!b) throw new Error(`provider không hợp lệ: ${provider}`);
    return b;
  }

  // hg và hm đặt tên field khác nhau -> chuẩn hoá về một hình dạng cho web.
  // Bỏ qua phần tử rác (null, undefined, không phải object).
  function normalizeItem(it) {
    if (it == null || typeof it !== "object" || Array.isArray(it)) return null;
    return {
      sourceId: String(it.id != null ? it.id : (it.book_id != null ? it.book_id : "")),
      name: it.title || it.name || "",
      description: it.desc || it.introduction || "",
      cover: it.book_pic || it.cover || it.coverWap || "",
    };
  }

  return {
    async search(provider, keyword, page = 1) {
      const data = await call(baseOf(provider), { type: "search", keyword, page });
      return ((data && data.lists) || []).map(normalizeItem).filter((x) => x != null);
    },
    async topCategories() {
      const data = await call(TOP_BASE, { type: "top" });
      return ((data && data.lists) || []).map((c) => ({
        cellId: String(c.cell_id || c.cellId || ""),
        name: c.cell_name || c.name || "",
        subs: ((c.sub_cell || c.subs) || []).map((s) => ({
          cellId: String(s.cell_id || s.cellId || ""),
          name: s.cell_name || s.name || "",
        })),
      }));
    },
    async topList(cellId, subCellId = "", page = 1) {
      const data = await call(TOP_BASE, { type: "list", cell_id: cellId, sub_cell_id: subCellId, page });
      return ((data && data.lists) || []).map(normalizeItem).filter((x) => x != null);
    },
    async detail(provider, sourceId) {
      const data = await call(baseOf(provider), { type: "detail", id: sourceId });
      const item = normalizeItem(data || {});
      return {
        name: item.name,
        description: item.description,
        cover: item.cover,
        episodeCount: ((data && data.lists) || []).length,
      };
    },
    _cacheSize: () => cache.size,
  };
}

module.exports = { createClient };
