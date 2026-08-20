// Chọn luồng video của nguồn hg.
//
// hg_play trả nhiều luồng cho một tập, mỗi luồng có codec_type riêng. "bytevc1" là biến thể
// HEVC của ByteDance: vỏ container trông như HEVC chuẩn (ffprobe báo hevc/hvc1) nên ffmpeg vẫn
// mở file, nhưng giải ra 0 khung hình. Code cũ chọn luồng CHỈ theo độ phân giải nên gặp luồng
// nào lấy luồng đó — hên xui.
//
// Từ 20/08/2026 nguồn đổi gần như toàn bộ sang bytevc1, nên phần lớn tập phải đi đường
// hg_decrypt. Vẫn giữ ưu tiên codec ở đây để khi nguồn trả lại luồng thường thì tự dùng ngay.
const BAD_CODECS = ["bytevc1"];

const isBad = (c) => BAD_CODECS.includes(String(c || "").toLowerCase());

/**
 * @param {Array} lists danh sách luồng từ hg_play
 * @param {string} preferred độ phân giải mong muốn, vd "1080p"
 * @returns {{stream:object|null, codecType:string, decodable:boolean}}
 *   decodable=false nghĩa là mọi luồng đều là codec ffmpeg không giải được -> caller nên thử
 *   đường hg_decrypt.
 */
function pickHgStream(lists, preferred = "") {
  const all = (Array.isArray(lists) ? lists : []).filter((x) => x && x.main_url);
  if (!all.length) return { stream: null, codecType: "", decodable: false };

  const good = all.filter((x) => !isBad(x.codec_type));
  const byDef = (arr) => arr.find((x) => x.definition === preferred);

  // Ưu tiên: codec dùng được + đúng độ phân giải > codec dùng được > đúng độ phân giải > đầu tiên.
  const stream = byDef(good) || good[0] || byDef(all) || all[0];
  const codecType = String(stream.codec_type || "").toLowerCase();
  return { stream, codecType, decodable: !isBad(codecType) };
}

module.exports = { pickHgStream, isBad, BAD_CODECS };
