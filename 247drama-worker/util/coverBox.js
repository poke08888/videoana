// Ô che dòng chữ Hán trước khi đắp phụ đề mới lên.
//
// Trước đây ô này là hằng số (0,66 → 0,83 chiều cao) tính theo phim đặt chữ ở ~0,72. Phim nào
// đặt chữ thấp hơn — có phim đặt đáy ở ~0,90 — thì ô che trượt bên trên chữ: chữ Trung còn
// nguyên trên bản phát, mà OCR (dải 0,55–0,85) cũng không thấy để dịch. Nên ô che phải bám
// theo đáy chữ đo được, giữ đúng khoảng phủ như bản cũ.

// Phần ô che phủ NGƯỢC LÊN trên đáy chữ. 0,06 = đúng bằng mặc định cũ khi đáy chữ ở 0,72
// (0,72 - 0,66), đủ cho một dòng chữ Hán.
const LEAD = 0.06;

const ratio = (v) => (typeof v === "number" && isFinite(v) && v > 0 && v < 1 ? v : null);

/**
 * @param {object} o
 * @param {number|null} o.bottomRatio đáy dòng chữ Hán do OCR đo được (0-1)
 * @param {object} o.base ô che mặc định trong setting {yRatio, heightRatio, color, enabled}
 * @returns {object} ô che đã dịch xuống/lên cho khớp; không đo được thì trả nguyên bản mặc định
 */
function coverBoxFor({ bottomRatio, base = {} }) {
  const bottom = ratio(bottomRatio);
  if (!bottom) return base;
  const h = ratio(base.heightRatio) || 0.17;
  const y = Math.max(0, Math.min(1 - h, bottom - LEAD));
  return { ...base, yRatio: Number(y.toFixed(4)) };
}

module.exports = { coverBoxFor, LEAD };
