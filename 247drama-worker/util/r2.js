const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
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

// Upload buffer lên R2. Cache dài vì key cố định theo tập.
async function uploadToR2(buffer, key, contentType) {
  const client = r2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

module.exports = { r2Client, uploadToR2 };
