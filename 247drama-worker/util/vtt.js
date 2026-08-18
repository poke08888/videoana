// Chuyển segment phụ đề ({start,end,text} theo giây) sang WebVTT để player nạp làm
// track ngoài. Dùng chung cho cả track vi lẫn en; timing lấy y hệt bản burn (buildAss)
// nên hai đường soft/burn không lệch nhau.

function vttTime(sec) {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

/**
 * segments: [{start,end,text}] (giây). offsetSec: dịch thời gian (giống subStartOffsetMs).
 * Trả chuỗi WebVTT, hoặc "" nếu không còn dòng nào có chữ.
 */
function segsToVtt(segments, opts = {}) {
  const offset = typeof opts.offsetSec === "number" ? opts.offsetSec : 0;
  const cues = (segments || [])
    .filter((s) => s && s.text && String(s.text).trim())
    .map((s) => {
      const text = String(s.text)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
      return `${vttTime(s.start + offset)} --> ${vttTime(s.end + offset)}\n${text}\n`;
    });
  if (!cues.length) return "";
  return `WEBVTT\n\n${cues.join("\n")}`;
}

module.exports = { segsToVtt };
