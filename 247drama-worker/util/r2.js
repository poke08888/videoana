const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { env } = require("../config");

// S3 client trỏ R2 (region auto, path-style, endpoint R2).
function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: env.r2.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: env.r2.accessKey, secretAccessKey: env.r2.secret },
  });
}

// Upload buffer lên R2. Mặc định cache dài vì key video cố định theo tập; caller nào ghi đè
// nhiều lần (phụ đề) thì truyền opts.cacheControl ngắn hơn để không kẹt ở edge Cloudflare.
async function uploadToR2(buffer, key, contentType, opts = {}) {
  const client = r2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: opts.cacheControl || "public, max-age=31536000, immutable",
    }),
  );
}

// Kích thước object trên R2, null nếu không tồn tại. Dùng để XÁC NHẬN sau upload.
async function headSizeOnR2(key) {
  try {
    const r = await r2Client().send(new HeadObjectCommand({ Bucket: env.r2.bucket, Key: key }));
    return typeof r.ContentLength === "number" ? r.ContentLength : null;
  } catch (e) {
    return null;
  }
}

// Upload rồi đọc lại đúng key đó để chắc file THẬT SỰ nằm trên R2 với đúng kích thước.
// Có lần render báo thành công nhưng object trên R2 vẫn là bản cũ -> tập hỏng nằm im,
// vì Mongo đã upsert nên work.js không bao giờ render lại. Sai lệch -> ném lỗi.
async function uploadAndVerify(buffer, key, contentType, opts = {}) {
  await uploadToR2(buffer, key, contentType, opts);
  const size = await headSizeOnR2(key);
  if (size !== buffer.length) {
    throw new Error(`R2 xác nhận hụt ${key}: đã up ${buffer.length}B nhưng đọc lại ${size === null ? "không thấy object" : size + "B"}`);
  }
}

module.exports = { r2Client, uploadToR2, headSizeOnR2, uploadAndVerify };
