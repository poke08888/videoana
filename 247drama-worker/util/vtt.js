// Chuyển segment phụ đề ({start,end,text} theo giây) sang WebVTT để player nạp làm
// track ngoài. Dùng chung cho cả track vi lẫn en; timing lấy y hệt bản burn (buildAss)
// nên hai đường soft/burn không lệch nhau.

function vttTime(sec) {
  const t = Math.max(0, sec);
  // Làm tròn về tổng số mili-giây NGAY TỪ ĐẦU rồi mới tách giờ/phút/giây/mili-giây.
  // Nếu làm tròn giờ/phút/giây (floor) và mili-giây (round) riêng lẻ như trước, phần
  // thập phân >= 0.9995 sẽ cho ms=1000 mà không cộng dồn được sang giây (ví dụ
  // 1.9996 -> "00:00:01.1000" sai định dạng, đúng ra phải là "00:00:02.000").
  const totalMs = Math.round(t * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

// Escape ký tự đặc biệt của WebVTT trong nội dung cue. Thứ tự bắt buộc: escape "&"
// trước tiên (kẻo escape luôn "&" vừa sinh ra từ "<"/">"), rồi mới tới "<" và ">" —
// dấu "<" mở tag trong WebVTT nên để nguyên có thể bị hiểu nhầm thành markup.
function escapeVttText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
        .map(escapeVttText)
        .join("\n");
      return `${vttTime(s.start + offset)} --> ${vttTime(s.end + offset)}\n${text}\n`;
    });
  if (!cues.length) return "";
  return `WEBVTT\n\n${cues.join("\n")}`;
}

module.exports = { segsToVtt };
