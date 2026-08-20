// Bản đọc-only của provider 52api dùng cho web vận hành. Cố ý KHÔNG dùng lại
// controllers/admin (đang gọi api.sansekai.my.id — khác nguồn với worker).
// Hai thứ bắt buộc: giãn nhịp (cùng một key với worker, gọi dồn sẽ dính rate limit)
// và cache (mỗi lượt duyệt là một lượt API mất tiền thật).

const BASE = {
  hg: "https://www.52api.cn/api/hg_duanju",
  hm: "https://www.52api.cn/api/hm_duanju",
  // 东梨: nguồn thứ ba, video trả về là h264 phát được ngay (hg đã đổi sang bytevc1 mà
  // ffmpeg giải ra 0 khung hình). Endpoint này CẤM tham số page.
  dl: "https://www.52api.cn/api/dongli",
};
const NO_PAGE = ["dl"];
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

  // Thực tế 52api trả thẳng một mảng (không bọc trong { lists: [...] }) cho
  // tìm kiếm/danh sách. Vẫn chấp nhận dạng { lists: [...] } phòng khi nhà
  // cung cấp đổi lại, để không vỡ trang vận hành.
  function extractList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.lists)) return data.lists;
    return [];
  }

  // hg và hm đặt tên field khác nhau -> chuẩn hoá về một hình dạng cho web.
  // Bỏ qua phần tử rác (null, undefined, không phải object).
  // desc/introduction: tên field cũ (đoán); intro: tên field thật của 52api cho kết quả tìm kiếm.
  function normalizeItem(it) {
    if (it == null || typeof it !== "object" || Array.isArray(it)) return null;
    return {
      sourceId: String(it.id != null ? it.id : (it.book_id != null ? it.book_id : "")),
      name: it.title || it.name || "",
      description: it.desc || it.introduction || it.intro || "",
      cover: it.book_pic || it.cover || it.coverWap || "",
    };
  }

  // Chuẩn hoá một danh mục cha: lọc null, xử lý số 0 đúng.
  function normalizeCategory(cat) {
    if (cat == null || typeof cat !== "object") return null;
    return {
      cellId: String(cat.cell_id != null ? cat.cell_id : (cat.cellId != null ? cat.cellId : "")),
      name: cat.cell_name || cat.name || "",
    };
  }

  // Mục con của bảng xếp hạng nằm lồng hai tầng: sub_lists[].panel_lists[].items[].
  // Gom phẳng toàn bộ items của mọi panel_lists trong mọi sub_lists thành một danh
  // sách mục con {cellId, name} (lấy từ panel_id/panel_name, khác cell_id/cell_name
  // của danh mục cha). panel_id có thể rỗng (mục "tổng") -> vẫn giữ, không lọc bỏ.
  function flattenSubItems(cat) {
    const subLists = Array.isArray(cat && cat.sub_lists) ? cat.sub_lists : [];
    const out = [];
    for (const sub of subLists) {
      if (sub == null || typeof sub !== "object") continue;
      const panelLists = Array.isArray(sub.panel_lists) ? sub.panel_lists : [];
      for (const panel of panelLists) {
        if (panel == null || typeof panel !== "object") continue;
        const items = Array.isArray(panel.items) ? panel.items : [];
        for (const it of items) {
          if (it == null || typeof it !== "object") continue;
          out.push({
            cellId: String(it.panel_id != null ? it.panel_id : ""),
            name: it.panel_name || "",
          });
        }
      }
    }
    return out;
  }

  return {
    async search(provider, keyword, page = 1) {
      const p = String(provider || "").toLowerCase();
      const params = NO_PAGE.includes(p) ? { type: "search", keyword } : { type: "search", keyword, page };
      const data = await call(baseOf(provider), params);
      return extractList(data).map(normalizeItem).filter((x) => x != null);
    },
    async topCategories() {
      const data = await call(TOP_BASE, { type: "top" });
      return ((data && data.lists) || [])
        .map((c) => {
          const normalized = normalizeCategory(c);
          if (!normalized) return null;
          return {
            cellId: normalized.cellId,
            name: normalized.name,
            subs: flattenSubItems(c),
          };
        })
        .filter((c) => c != null);
    },
    // page bị 52api cấm cho endpoint bảng xếp hạng (trả code 400 "参数 page 未配置，
    // 禁止传递") -> không được gửi. Mục con dùng tham số panel_id (không phải sub_cell_id).
    async topList(cellId, subCellId = "") {
      const data = await call(TOP_BASE, { type: "list", cell_id: cellId, panel_id: subCellId });
      return extractList(data).map(normalizeItem).filter((x) => x != null);
    },
    async detail(provider, sourceId) {
      const data = await call(baseOf(provider), { type: "detail", id: sourceId });
      const item = normalizeItem(data || {});
      return {
        name: item.name,
        description: item.description,
        cover: item.cover,
        // dl trả sẵn tổng số tập ở trường total; hg/hm thì đếm mảng lists.
        episodeCount: Number((data && data.total) || 0) || ((data && data.lists) || []).length,
      };
    },
    _cacheSize: () => cache.size,
  };
}

module.exports = { createClient };
