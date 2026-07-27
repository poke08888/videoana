// Chạy TRÊN SERVER (/var/www/247drama/backend): đẩy uploads/*.mp4 lên R2 + rewrite Mongo.
// Resumable: HEAD trước, đã có thì skip. Đọc R2 creds + Mongo từ env/.env.
// Cờ: --dry (không PUT, không ghi Mongo, chỉ đếm).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const mongoose = require("mongoose");

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE;
const KEY_PREFIX = process.env.R2_KEY_PREFIX || "videos";
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(__dirname, "../uploads");
const COLLECTION = process.env.SHORTVIDEO_COLLECTION || "shortvideos";

// Đổi URL /uploads cũ -> URL R2, giữ nguyên tên file. URL không phải /uploads giữ nguyên.
function rewriteUploadsUrl(url, r2PublicBase, keyPrefix) {
  if (!url || !url.includes("/uploads/")) return url;
  const name = url.split("/uploads/").pop();
  return `${r2PublicBase}/${keyPrefix}/${name}`;
}

function client() {
  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET },
  });
}

async function existsOnR2(c, key) {
  try {
    await c.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const dry = process.argv.includes("--dry");
  const c = client();
  const files = fs.readdirSync(UPLOADS_DIR).filter((f) => f.endsWith(".mp4"));
  console.log(`[backfill] ${files.length} mp4 trong ${UPLOADS_DIR} (dry=${dry})`);
  let put = 0,
    skip = 0,
    fail = 0;
  for (const f of files) {
    const key = `${KEY_PREFIX}/${f}`;
    try {
      if (await existsOnR2(c, key)) {
        skip++;
        continue;
      }
      if (!dry) {
        const body = fs.readFileSync(path.join(UPLOADS_DIR, f));
        await c.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: body,
            ContentType: "video/mp4",
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
      }
      put++;
      if (put % 20 === 0) console.log(`[backfill] đã put ${put} (skip ${skip})`);
    } catch (e) {
      fail++;
      console.error(`[backfill] fail ${f}:`, e.message);
    }
  }
  console.log(`[backfill] xong PUT: put=${put} skip=${skip} fail=${fail}`);

  // Rewrite Mongo videoUrl cho mọi tập còn trỏ /uploads.
  await mongoose.connect(process.env.MongoDb_Connection_String);
  const ShortVideo = mongoose.model("ShortVideo", new mongoose.Schema({}, { strict: false }), COLLECTION);
  const cur = ShortVideo.find({ videoUrl: /\/uploads\// }).cursor();
  let rew = 0;
  for (let d = await cur.next(); d; d = await cur.next()) {
    const nu = rewriteUploadsUrl(d.videoUrl, R2_PUBLIC_BASE, KEY_PREFIX);
    if (nu !== d.videoUrl) {
      if (!dry) await ShortVideo.updateOne({ _id: d._id }, { $set: { videoUrl: nu } });
      rew++;
    }
  }
  console.log(`[backfill] rewrite videoUrl: ${rew} bản ghi`);
  await mongoose.disconnect();
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });

module.exports = { rewriteUploadsUrl };
