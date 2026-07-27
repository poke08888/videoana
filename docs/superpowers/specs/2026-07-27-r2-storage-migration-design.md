# Migrate storage video sang Cloudflare R2 — Design

**Ngày:** 2026-07-27
**App:** 247drama (server 103.179.185.196) + Mac render farm (`/Users/kevin/video/247drama-worker`)

## Mục tiêu

Chuyển toàn bộ lưu trữ video ra khỏi server (đang 8.3GB, hướng tới ~1TB) sang **Cloudflare R2** (egress miễn phí, S3-compatible). Server chỉ còn giữ Mongo + phục vụ app. Mac worker đẩy video thẳng R2 thay vì rsync vào `/uploads`.

## Quyết định đã chốt với user

1. **Đã có** bucket R2 + API token. Account ID `00106d0da3e1eeda8d9b71ed371bdf68`, S3 endpoint `https://00106d0da3e1eeda8d9b71ed371bdf68.r2.cloudflarestorage.com`.
2. **Chưa có domain** → dùng URL công khai `r2.dev` tạm (`R2_PUBLIC_BASE = https://pub-<hash>.r2.dev`). Đổi sang custom domain sau = đổi 1 biến + 1 `updateMany` prefix trong Mongo.
3. **Migrate hết + giải phóng server**: backfill 8.3GB lên R2, rewrite `videoUrl` trong Mongo, xoá mp4 local (giữ `render-status.*` + ảnh để không sập dashboard).
4. Mac worker **bỏ hẳn rsync video**, up thẳng R2 (giữ raw backup trên BINGNET).

## Bối cảnh kỹ thuật (đã khảo sát)

- Server `util/storageHelper.js` **đã có** `uploadBufferToStorage(buffer, folder, filename, contentType)` dùng `@aws-sdk/client-s3` (`S3` + `PutObjectCommand`). Nhánh `aws` tạo client với `region`, `credentials`, `endpoint`(+`forcePathStyle`), upload `Key = <folder>/<filename>`, trả URL = `${awsEndpoint}/${folder}/${filename}`. **Không set ACL** (đúng cho R2 — R2 public ở cấp bucket, không cấp object).
- `getActiveStorage()`: `awsS3 → "aws"`, `digitalOcean → "digitalocean"`, else `"local"`.
- `setting.model.js` có sẵn field `storage.{local,awsS3,digitalOcean}` + `awsEndpoint/awsHostname/awsAccessKey/awsSecretKey/awsBucketName/awsRegion`.
- **R2 tương thích S3** → slot `awsS3` dùng lại được, chỉ cần cấu hình. Không viết backend storage mới.
- Mac worker **không** dùng storageHelper — nó `rsyncToServer` + `config.buildVideoUrl` tự dựng `http://103.179.185.196/uploads/<filename>`.
- Tên file đã unique: `<provider>_<sourceId>_ep<index>.mp4`.

## Kiến trúc

### Key scheme trên R2
Phẳng, một prefix chung: **`videos/<provider>_<sourceId>_ep<index>.mp4`**. Server và Mac worker dùng cùng scheme → nhất quán (nếu server pipeline bật lại vẫn khớp).

### Public URL
`videoUrl = ${R2_PUBLIC_BASE}/videos/<filename>` với `R2_PUBLIC_BASE = https://pub-<hash>.r2.dev` (tạm). R2 hỗ trợ HTTP range → player seek được.

### Metadata object
- `ContentType: video/mp4` (phát inline, không tải về).
- `CacheControl: public, max-age=31536000, immutable` (CDN cache lâu; tên file cố định theo tập nên an toàn).

### Mapping cấu hình R2 vào slot awsS3 (server Setting)
| Setting field | Giá trị R2 |
|---|---|
| `storage.awsS3` | `true` |
| `awsHostname` | `https://00106d0da3e1eeda8d9b71ed371bdf68.r2.cloudflarestorage.com` (endpoint PUT, forcePathStyle) |
| `awsRegion` | `auto` |
| `awsAccessKey` / `awsSecretKey` | R2 token key/secret |
| `awsBucketName` | tên bucket |
| `awsEndpoint` | `${R2_PUBLIC_BASE}` (base đọc công khai, để dựng URL trả về) |

## Components (thay đổi)

### 1. Mac worker (`247drama-worker/`) — đường sản xuất video hiện tại
- `.env` (gitignored): thêm `R2_ENDPOINT`, `R2_ACCESS_KEY`, `R2_SECRET`, `R2_BUCKET`, `R2_PUBLIC_BASE`, `R2_KEY_PREFIX=videos`.
- `package.json`: thêm `@aws-sdk/client-s3`.
- `util/r2.js` (mới): tạo S3 client (endpoint R2, region `auto`, forcePathStyle), export `uploadToR2(buffer, key, contentType)` PUT lên bucket với ContentType + CacheControl.
- `config.js`: `buildR2Key(provider,sourceId,index)` = `${prefix}/<filename>`; `buildVideoUrl` → `${R2_PUBLIC_BASE}/${key}`. Thêm block `r2` trong `env`.
- `render.js`: thay `await rsyncToServer(outPath, filename)` bằng `await uploadToR2(buf, key, "video/mp4")`. Bỏ hàm `rsyncToServer` (không xoá phần rsync dashboard trong status.js). Giữ raw backup BINGNET.
- Phase "upload" giờ = đẩy R2.

### 2. Backfill (chạy trên server — file sẵn tại chỗ)
- `scripts/backfill-r2.js` (trên server `/var/www/247drama/backend`):
  - Duyệt `uploads/*.mp4`.
  - Với mỗi file: nếu **chưa có** trên R2 (HEAD) → PUT `videos/<name>` (video/mp4, cache-control).
  - `ShortVideo.updateOne` theo videoUrl cũ → mới (hoặc updateMany prefix cuối cùng).
  - Resumable: chạy lại bỏ qua file đã có trên R2.
  - Log tiến độ, đếm ok/skip/fail.
- Sau backfill: `ShortVideo.updateMany` đảm bảo mọi `videoUrl` `http://103.179.185.196/uploads/<f>` → `${R2_PUBLIC_BASE}/videos/<f>`. (Ảnh `videoImage`/`thumbnail` nếu trỏ `/uploads` cũng rewrite tương tự khi đã backfill ảnh — nhưng ảnh nhỏ, có thể để lại local; xử lý riêng nếu cần.)
- Verify N mẫu qua app → **xoá mp4 local** (`uploads/*.mp4`), giữ `render-status.*` + ảnh.

### 3. Server Setting → R2
Set `storage.awsS3=true` + `aws*` như bảng trên, để upload server sau này (ảnh admin, hoặc pipeline nếu bật lại) vào R2. Ảnh cũ trên `/uploads` vẫn phục vụ bình thường (URL tuyệt đối không đổi).

## Thứ tự thực thi (an toàn, không downtime)
1. Code worker R2 + `util/r2.js`; test PUT 1 object test → mở `r2.dev` URL → kiểm tra phát + seek + Content-Type.
2. Deploy `backfill-r2.js` lên server; chạy backfill toàn bộ → verify N mẫu qua app.
3. **Restart worker** → tập mới đi thẳng R2 (dedup: tập đã xong không render lại).
4. Set Setting server = R2.
5. Xoá mp4 local sau khi verify R2 ổn.

## Rủi ro & lưu ý
- ⚠️ **r2.dev rate-limit, không cho production nặng** → khuyến nghị mua domain (~$10/năm) đưa về Cloudflare sớm. Đổi domain = đổi `R2_PUBLIC_BASE` + `awsEndpoint` + 1 `updateMany` prefix Mongo (thiết kế sẵn để rẻ).
- **CORS**: set CORS mở trên bucket (phòng web player); app mobile native không cần.
- **Cutover**: giữ mp4 local tới khi R2 verified mới xoá. Backfill resumable.
- **Bảo mật**: R2 creds chỉ trong `.env` (gitignored) + Mongo Setting; không commit.
- **Worker đang chạy** (455 tập): restart sau khi có code R2 — tập đã xong không render lại.
- **Public Development URL phải Enable** trên bucket, nếu không file R2 không đọc công khai được.

## Verify (end-to-end)
1. PUT 1 file test lên R2 → `curl -I ${R2_PUBLIC_BASE}/videos/test.mp4` trả 200 + `content-type: video/mp4` + hỗ trợ `accept-ranges: bytes`.
2. Backfill 1 tập → rewrite Mongo → mở tập đó trong app → phát được, tua được.
3. Backfill full → spot-check N tập ngẫu nhiên qua app.
4. Render 1 tập MỚI qua worker R2 → videoUrl trỏ r2.dev → phát trong app.
5. Xoá mp4 local → app vẫn phát (chứng minh đã rời server).
