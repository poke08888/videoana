// Sao ảnh bìa phim về kho của mình (R2 + cdn.247tv.app).
//
// 52api trả ảnh bìa trỏ thẳng vào CDN của ByteDance (p6-novel.byteimg.com). Ảnh đó nằm ngoài
// tầm kiểm soát: nhà mạng chặn, host đổi chính sách hoặc xoá file là phim mất ảnh, mà mình
// không làm gì được. Sao về R2 một lần rồi dùng link của mình cho chắc.
const { uploadAndVerify } = require("./r2");
const { env } = require("../config");

const MAX_BYTES = 8 * 1024 * 1024;

function coverKey(provider, sourceId) {
  return `covers/${provider}_${sourceId}.jpg`;
}

function coverUrl(provider, sourceId, base = env.r2.publicBase) {
  return `${base || ""}/${coverKey(provider, sourceId)}`;
}

// Đã là ảnh của mình chưa (để khỏi sao lại mỗi vòng quét).
function isMirrored(url, base = env.r2.publicBase) {
  const b = String(base || "");
  return !!b && String(url || "").startsWith(`${b}/covers/`);
}

// Nhận diện ảnh theo mấy byte đầu, KHÔNG tin content-type của host lạ: có host trả HTML báo
// lỗi kèm content-type ảnh, sao về thì được một file rác nằm vĩnh viễn trên CDN của mình.
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return "";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.slice(0, 3).toString("ascii") === "GIF") return "image/gif";
  return "";
}

/**
 * @param {{provider:string, sourceId:string, url:string, download:Function, upload?:Function}} o
 * @returns {Promise<{url:string, bytes:number, contentType:string}>}
 */
async function mirrorCover({ provider, sourceId, url, download, upload = uploadAndVerify }) {
  if (!provider || !sourceId) throw new Error("thiếu provider/sourceId");
  if (!url) throw new Error("phim không có ảnh bìa ở nguồn");
  const buf = await download(url);
  if (!buf || !buf.length) throw new Error("tải ảnh về rỗng");
  if (buf.length > MAX_BYTES) throw new Error(`ảnh quá lớn (${Math.round(buf.length / 1024)}KB)`);
  const contentType = sniffImageType(buf);
  if (!contentType) throw new Error("file tải về không phải ảnh");

  const key = coverKey(provider, sourceId);
  // Ảnh bìa hiếm khi đổi; đổi thì cũng là phim khác -> cache dài như video.
  await upload(buf, key, contentType, { cacheControl: "public, max-age=31536000, immutable" });
  return { url: coverUrl(provider, sourceId), bytes: buf.length, contentType };
}

module.exports = { mirrorCover, coverKey, coverUrl, isMirrored, sniffImageType, MAX_BYTES };
