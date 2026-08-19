// Vị trí dòng phụ đề rời (.vtt) của MỘT tập.
//
// Mỗi phim đặt chữ Hán ở một độ cao khác nhau, nên KHÔNG có hằng số chung nào đúng cho
// mọi phim: số phải đo từ chính video. OCR trả chineseBottomRatio = đáy dòng chữ Hán
// (median các khung mẫu) của tập đó. Tập đầu tiên đo được sẽ "chốt" mức cho cả phim
// (MovieSeries.zhBottomRatio), các tập sau bám theo mức đó để cả phim thống nhất và một
// tập OCR nhiễu không tự đẩy phụ đề đi chỗ khác.
//
// Không đo được và phim cũng chưa có mức đã chốt -> trả null: render.js bỏ tập, lần chạy
// sau làm lại. Thà chậm một tập còn hơn đẩy lên bản phát chữ Việt đè lên chữ Hán.

const MAX_TOP = 0.88; // đừng đẩy dòng chữ sát mép dưới khung hình
const TOLERANCE = 0.05; // lệch quá 5% chiều cao so với mức phim = OCR nhiễu, không tin

const num = (v) => (typeof v === "number" && isFinite(v) && v > 0 && v < 1 ? v : null);

/**
 * @param {object} o
 * @param {number|null} o.episodeRatio  đáy chữ Hán do OCR tập này đo được
 * @param {number|null} o.seriesRatio   mức đã chốt cho phim
 * @param {string} o.seriesSource       "manual" = người vận hành đặt tay -> luôn thắng
 * @param {number} o.gapRatio           khoảng cách dưới chữ Hán (~0,3cm = 0.012 chiều cao)
 * @returns {{topRatio:number, source:"episode"|"series", pin:boolean, warn:string}|null}
 */
function resolveSubPosition({ episodeRatio, seriesRatio, seriesSource = "", gapRatio = 0.012, tolerance = TOLERANCE, maxTop = MAX_TOP }) {
  const ep = num(episodeRatio);
  const se = num(seriesRatio);
  const gap = typeof gapRatio === "number" && isFinite(gapRatio) && gapRatio >= 0 ? gapRatio : 0.012;
  const top = (base) => Math.min(maxTop, base + gap);

  if (se && seriesSource === "manual") {
    const warn = ep && Math.abs(ep - se) > tolerance ? `OCR đo ${ep.toFixed(3)} nhưng phim đặt tay ${se.toFixed(3)} -> theo số đặt tay` : "";
    return { topRatio: top(se), source: "series", pin: false, warn };
  }
  if (ep && se) {
    if (Math.abs(ep - se) <= tolerance) return { topRatio: top(ep), source: "episode", pin: false, warn: "" };
    return { topRatio: top(se), source: "series", pin: false, warn: `OCR đo ${ep.toFixed(3)} lệch quá ${tolerance} so với mức phim ${se.toFixed(3)} -> theo mức phim` };
  }
  if (ep) return { topRatio: top(ep), source: "episode", pin: true, warn: "" }; // tập chốt mức cho phim
  if (se) return { topRatio: top(se), source: "series", pin: false, warn: "OCR không đo được vị trí chữ Hán -> theo mức phim" };
  return null;
}

module.exports = { resolveSubPosition, MAX_TOP, TOLERANCE };
