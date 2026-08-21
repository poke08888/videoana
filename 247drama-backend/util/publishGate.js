// Cổng xuất bản: phim chỉ lên app khi ĐỦ TẬP và KHÔNG TẬP NÀO HỎNG.
//
// Người xem trả xu để mở tập; một phim mới render được 21/52 tập, hay có 3 tập lọt lên mà
// không có lấy một dòng phụ đề, là hỏng theo đúng nghĩa người dùng — nên phim như vậy phải
// nằm ngoài mọi danh sách của app cho tới khi máy render làm xong.
//
// Cách chạy: quét định kỳ (index.js) chấm điểm từng phim rồi ghi cờ isComplete + phần
// completeness vào MovieSeries. Mọi truy vấn phía app lọc bằng publishedMatch(), KHÔNG tự
// tính lại — tính một chỗ, đọc nhiều chỗ.

// Ngôn ngữ bắt buộc: thị trường chính là Việt Nam, tập không có phụ đề Việt coi như chưa xong.
// Tập đời cũ đốt chữ thẳng vào video (burnedLang) nên không có track rời — vẫn tính là có.
const PRIMARY_LANG = "vi";

// Điều kiện "tập hỏng" viết bằng ngôn ngữ aggregation để đếm ngay trong Mongo, không kéo
// mười nghìn bản ghi tập về Node mỗi hai phút.
const BROKEN_EXPR = {
  $or: [
    { $eq: [{ $ifNull: ["$videoUrl", ""] }, ""] },
    {
      $and: [
        { $eq: [{ $ifNull: ["$burnedLang", ""] }, ""] },
        {
          $eq: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ["$subTracks", []] },
                  as: "t",
                  cond: { $eq: ["$$t.lang", PRIMARY_LANG] },
                },
              },
            },
            0,
          ],
        },
      ],
    },
  ],
};

// Phim nhập từ 52api thì tổng số tập là con số của nguồn; phim admin tự tạo tay không có
// nguồn nào để đối chiếu -> lấy chính số tập đang có làm tổng.
function hasSource(series) {
  const prov = String((series && series.sourceProvider) || "");
  const book = String((series && series.bookId) || "");
  return /^52api-/.test(prov) || /^(hg|hm|dl):/.test(book);
}

const list = (nums, max = 8) => {
  const shown = nums.slice(0, max).map((n) => n + 1); // người vận hành đếm tập từ 1
  return shown.join(", ") + (nums.length > max ? `, +${nums.length - max} tập nữa` : "");
};

// Chấm một phim. stat là kết quả gộp từ collection tập (có thể thiếu = phim chưa có tập nào).
// Trả về đúng những gì sẽ ghi xuống Mongo, để hàm quét chỉ việc so sánh rồi ghi.
function evaluateSeries(series, stat) {
  const s = stat || { have: 0, uniq: 0, minEp: 0, maxEp: 0, bad: [] };
  const have = s.have || 0;
  const uniq = s.uniq || 0;
  const badEps = (s.bad || []).slice().sort((a, b) => a - b);
  const sourced = hasSource(series);
  const declared = Number(series && series.sourceEpisodeCount) || 0;
  const expected = sourced ? declared : uniq;
  const span = uniq ? s.maxEp - s.minEp + 1 : 0;

  let reason = "";
  if (have === 0) reason = "chưa có tập nào";
  else if (sourced && declared === 0) reason = "chưa biết tổng số tập bên nguồn";
  else if (have < expected) reason = `mới có ${have}/${expected} tập`;
  else if (badEps.length) reason = `${badEps.length} tập lỗi (tập ${list(badEps)})`;
  else if (uniq !== have) reason = "có tập trùng số";
  else if (span !== uniq) reason = "số tập đứt quãng, thiếu tập ở giữa";

  return {
    isComplete: !reason,
    completeness: {
      expected,
      have,
      missing: Math.max(0, expected - have),
      badEps,
      reason,
    },
  };
}

// Điều kiện lọc dùng CHUNG cho mọi truy vấn phía app. prefix để dùng được sau $lookup
// ("movieSeriesDetails." / "movie.").
function publishedMatch(prefix = "") {
  return { [`${prefix}isActive`]: true, [`${prefix}isComplete`]: true };
}

// Gộp trạng thái tập của cả kho trong MỘT lượt aggregate.
async function collectStats(ShortVideo) {
  const rows = await ShortVideo.aggregate([
    { $match: { movieSeries: { $ne: null } } },
    {
      $group: {
        _id: "$movieSeries",
        have: { $sum: 1 },
        eps: { $addToSet: "$episodeNumber" },
        minEp: { $min: "$episodeNumber" },
        maxEp: { $max: "$episodeNumber" },
        bad: { $push: { $cond: [BROKEN_EXPR, "$episodeNumber", "$$REMOVE"] } },
      },
    },
  ]);
  const map = new Map();
  for (const r of rows) {
    map.set(String(r._id), {
      have: r.have,
      uniq: (r.eps || []).length,
      minEp: r.minEp,
      maxEp: r.maxEp,
      bad: r.bad || [],
    });
  }
  return map;
}

const sameEval = (doc, next) => {
  const c = doc.completeness || {};
  return (
    !!doc.isComplete === next.isComplete &&
    c.reason === next.completeness.reason &&
    c.have === next.completeness.have &&
    c.expected === next.completeness.expected &&
    (c.badEps || []).join(",") === next.completeness.badEps.join(",")
  );
};

// Quét toàn kho. CHỈ ghi phim có thay đổi: bảng vận hành sắp theo updatedAt, ghi đè cả kho
// mỗi hai phút sẽ xoá sạch thứ tự đó và tạo hàng nghìn lượt ghi vô ích.
async function sweepPublishGate({ MovieSeries, ShortVideo, log = () => {} }) {
  const series = await MovieSeries.find({})
    .select("_id name isActive isComplete completeness sourceProvider bookId sourceEpisodeCount")
    .lean();
  const stats = await collectStats(ShortVideo);

  const ops = [];
  const flipped = [];
  let published = 0;
  for (const s of series) {
    const next = evaluateSeries(s, stats.get(String(s._id)));
    if (next.isComplete) published++;
    if (sameEval(s, next)) continue;
    if (!!s.isComplete !== next.isComplete) {
      flipped.push(`${next.isComplete ? "LÊN" : "ẨN"} ${s.name}${next.completeness.reason ? ` (${next.completeness.reason})` : ""}`);
    }
    ops.push({
      updateOne: {
        filter: { _id: s._id },
        update: { $set: { isComplete: next.isComplete, completeness: { ...next.completeness, checkedAt: new Date() } } },
        timestamps: false,
      },
    });
  }
  if (ops.length) await MovieSeries.bulkWrite(ops, { ordered: false });
  if (flipped.length) log(`[cổng app] ${flipped.length} phim đổi trạng thái: ${flipped.slice(0, 10).join(" | ")}`);
  return { checked: series.length, published, hidden: series.length - published, changed: ops.length, flipped };
}

module.exports = { PRIMARY_LANG, BROKEN_EXPR, evaluateSeries, publishedMatch, sweepPublishGate, collectStats, hasSource };
