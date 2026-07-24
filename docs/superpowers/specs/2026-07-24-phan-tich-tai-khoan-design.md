# Thiết kế: Phân tích tài khoản (Account Analysis)

**Ngày:** 2026-07-24
**Dự án:** Nonelab Studio (videoana) — video.nonelab.net
**Trạng thái:** Đã brainstorm, chờ review spec

## 1. Mục tiêu

Người dùng dán **link một tài khoản** TikTok hoặc Douyin. Hệ thống lấy **≤100 video gần nhất**, cho chọn **bộ lọc** (like/view/tỉ lệ tương tác/khoảng thời gian), phân tích toàn bộ video đạt lọc (mổ xẻ từng video qua Gemini như luồng hiện có), rồi rút ra **thành công chung của tài khoản**: nội dung gì lặp lại, tại sao thành công — kèm **đối chiếu nội dung↔chỉ số** (content nào gắn với view/like/ER cao trong chính tài khoản đó).

Tính năng về bản chất là **"Campaign nhưng nguồn = 1 tài khoản thay vì từ khóa"**, nên tái dùng tối đa hạ tầng đã có (hàng đợi phân tích nền, `rankEngagement`, cohort + `finalizeCohortIfDone`, `contentInsight`, `synthesize`).

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Nền tảng | TikTok **và** Douyin (cả hai endpoint đã kiểm chứng live) |
| Bộ lọc | Tối thiểu like, tối thiểu view, tỉ lệ tương tác (ER %), khoảng thời gian (N ngày gần đây) |
| Kiểm soát chi phí | Sau lọc hiện "X video đạt", có **trần chỉnh được** (mặc định **100**), **xác nhận** mới chạy phân tích |
| Số video lấy | Mặc định **100** gần nhất (cấu hình được) |
| Đầu ra | **Cả hai**: tổng hợp điểm chung (synthesis) + đối chiếu nội dung↔chỉ số (contentInsight) |
| Kiến trúc | **Phương án C** — job nền như Campaign, tái dùng `search_jobs` (kind='account') + polling |
| ER Douyin | Chấp nhận **không tính save** (`fetch_user_post_videos` có thể thiếu `collect_count`) |
| Nickname Douyin | Chấp nhận thêm 1 lời gọi `handler_user_profile?sec_user_id=` để lấy tên hiển thị |
| Nơi phát triển | **Trực tiếp trên server** `/var/www/videoana`; deploy `docker compose up -d --build` |

## 3. Phạm vi quyền

Dùng `requireEditor` (Biên tập + Quản trị) — đồng nhất với Campaign/Ads. Khách/Cộng tác không truy cập.

## 4. Kiến trúc & thay đổi file

### Module mới
- **`server/account.ts`**
  - `resolveAccount(input: string): Promise<Account>` — nhận link hoặc `@handle`, tự nhận nền tảng theo domain (`isTikTokUrl`/`isDouyinUrl`, mặc định coi `@handle` trơn là TikTok), gọi API resolve → `{platform: 'tiktok'|'douyin', secId, handle, nickname, avatar}`.
    - TikTok: `GET /v1/user/@handle` (tokapi) → `user.sec_uid`, `nickname`, avatar.
    - Douyin: `GET /api/v1/douyin/web/get_sec_user_id?url=<profileUrl>` (douyin-api6) → `sec_user_id`; nickname/avatar qua `GET /api/v1/douyin/web/handler_user_profile?sec_user_id=` (thêm 1 lời gọi — đã chấp nhận).
  - `fetchAccountVideos(account, opts): Promise<AccountVideo[]>` — phân trang lấy ≤`count` video.
    - TikTok: `GET /v1/post/user/{sec_uid}/posts?count=&offset=|max_cursor=` → `aweme_list[]`, dùng `has_more`/`max_cursor` để lật trang.
    - Douyin: `GET /api/v1/douyin/web/fetch_user_post_videos?sec_user_id=&max_cursor=&count=` → `data.aweme_list[]` (**hình dạng cần validate + fixture ở task code đầu tiên**).
    - Mỗi video: `{awemeId, desc, link, createTime, stats}` (reuse `computeEngagement`).
  - `filterAccountVideos(videos, filter): AccountVideo[]` — lọc theo `minLikes`, `minViews`, `minER` (%), `sinceDays` (0 = không giới hạn). ER = `(like+cmt+share+save)/view*100`; Douyin thiếu save thì save=0.

### File sửa
- **`server/tiktokSearch.ts`** — worker job tách nhánh theo `kind`: `'account'` gọi `fetchAccountVideos` + `filterAccountVideos` (thay vì `searchVideos`). Tái dùng `rankEngagement()` để chấm percentile tương tác trong tập tài khoản. Chuẩn hóa output về cùng `SearchVideo` shape (thêm `createTime`).
- **`server/cohort.ts`** — `finalizeCohortIfDone` cho `kind='account'`: chạy `contentInsight` (đối chiếu nội dung↔chỉ số) **và** synthesis "vì sao tài khoản này thành công"; lưu `insight = { correlation, synthesis }`.
- **`server/synthesize.ts`** — tách/tái dùng lõi đúc digest nhiều phiếu để dùng cho synthesis account (prompt nhấn "công thức lặp lại của tài khoản").
- **`server/index.ts`** — thêm 4 route account (mirror campaign); `resumeSearchJobs` xử lý luôn `kind='account'`.
- **`server/db.ts`** — migration cột mới (dưới).
- **`src/App.tsx`, `src/lib/api.ts`, `src/types.ts`** — tab UI mới + hàm API.

## 5. Data model

### `search_jobs` (thêm cột qua `addColumnIfMissing`, không phá DB cũ)
- `kind TEXT DEFAULT 'keyword'` — `'keyword'` | `'account'`
- `account_url TEXT`
- `account_meta TEXT` — JSON `{platform, secId, handle, nickname, avatar}`
- `min_er REAL DEFAULT 0` — ER tối thiểu (%)
- `since_days INTEGER DEFAULT 0` — 0 = không giới hạn

Cột sẵn có tái dùng: `min_likes`, `min_views`, `target` (= count lấy về, default 100), `status`, `found`, `scanned`, `videos`, `message`, `region`.

### `ads_cohorts`
- Thêm giá trị `kind='account'` (cột `kind` đã tồn tại). `product` = nickname/handle. `insight` JSON `{correlation, synthesis}`. Không tạo bảng mới → cohort tài khoản nằm chung danh sách ads/campaign.

## 6. API routes (mirror Campaign)

1. `POST /api/account/search` (requireEditor)
   - Body: `{ url, count?=100, minLikes?, minViews?, minER?, sinceDays?, region? }`
   - `resolveAccount(url)` → tạo `search_jobs` kind='account' (status `searching`), chạy nền `fetchAccountVideos`+`filterAccountVideos`+`rankEngagement`. Trả `{ jobId }`. Lỗi resolve → 400 với thông báo rõ.
2. `GET /api/account/job/:id` (requireEditor) — poll `{ status, found, scanned, message, account, videos? }` (videos khi `ready`, kèm eng ranking).
3. `POST /api/account/job/:id/stop` · `POST /api/account/job/:id/discard` (requireEditor) — dừng/hủy (tái dùng logic campaign job).
4. `POST /api/account/create` (requireEditor)
   - Body: `{ jobId, cap?=100 }` (hoặc `{ account, videos, cap }`).
   - Tạo cohort `kind='account'` (product = nickname); chọn **top-`cap` video theo tương tác**; đẩy mỗi video vào hàng đợi `history` (status `pending`, `queue_meta`: `{ tiktokUrl: link, eng: <ranking>, cohortId, apiKey, model, email, form:{product:nickname} }`, `cohort_id`, `owner`). Trả `{ cohortId }`.
   - **Lưu ý:** trường `queue_meta.tiktokUrl` mang **cả link TikTok lẫn Douyin** — `queue.ts` sẵn có tự nhận diện Douyin qua `isDouyinUrl` và tải bằng đúng API. Không thêm trường mới; giữ nguyên hợp đồng queue hiện tại.
5. Xem kết quả: tái dùng `GET /api/ads/cohort/:id` + `GET /api/ads/cohorts`.

**Luồng:** phân tích Gemini nặng chạy trên **hàng đợi nền sẵn có** (async, sống sót F5, có cache tái dùng link theo `source_url` → video trùng không gọi lại Gemini). Khi mọi video của cohort xong, `finalizeCohortIfDone` dựng `insight`.

## 7. Resolve + fetch theo nền tảng (đã kiểm chứng live 2026-07-24)

- **TikTok**: `tiktok.com/@handle` / `@handle` → `/v1/user/@handle` → `sec_uid`; video `/v1/post/user/{sec_uid}/posts` (có `has_more`, `max_cursor`, `create_time`, `statistics`).
- **Douyin**: `douyin.com/user/...` → `/api/v1/douyin/web/get_sec_user_id?url=` → `sec_user_id`; video `/api/v1/douyin/web/fetch_user_post_videos?sec_user_id=&max_cursor=&count=`.
- Key: tái dùng `resolveTokapiKey` (TikTok) / `resolveDouyinKey` (Douyin).

## 8. Đầu ra (cả hai cơ chế)

Khi cohort hoàn tất:
- **Đối chiếu nội dung↔chỉ số** (`contentInsight.ts`): trong chính tài khoản, đặc điểm nội dung nào gắn với view/like/ER cao/thấp.
- **Tổng hợp điểm chung** (synthesize): nội dung/chủ đề lặp lại, hook chung, công thức/cấu trúc chung, style sản xuất (góc máy/wardrobe), và "vì sao tài khoản này thành công".
- Lưu `insight = {correlation, synthesis}`. UI cohort hiển thị: bảng xếp hạng tương tác các video + 2 khối insight + danh sách phiếu link tới từng phiếu mổ xẻ.

## 9. Frontend (App.tsx)

Tab mới **"Phân tích tài khoản"** tái dùng scaffold UI Campaign:
- Nhập: link/@handle (auto-detect nền tảng theo domain) · count (mặc định 100) · 4 bộ lọc (like/view/ER/số ngày).
- "Lấy video" → `startAccountSearch` → poll `getAccountJob` → hiển thị danh sách video + số đạt lọc (lọc cập nhật trực tiếp client-side trên danh sách đã lấy).
- Ô trần **N** (mặc định 100) + nút "Phân tích N video" → `createAccountAnalysis` → chuyển sang xem cohort.
- `src/lib/api.ts`: `startAccountSearch`, `getAccountJob`, `stopAccountSearch`, `discardAccountJob`, `createAccountAnalysis`. `src/types.ts`: type `Account`, `AccountVideo`.

## 10. Xử lý lỗi

- Tài khoản riêng tư / không có video / bị chặn → job `failed` + thông báo tiếng Việt.
- Link sai định dạng → 400 khi `resolveAccount`.
- 429 / hết quota RapidAPI → tái dùng thông báo humanize sẵn có (tokapi/douyin).
- Backend restart giữa chừng → `resumeSearchJobs` chạy lại job `searching` kind='account'; video kẹt `processing` → `pending` (cơ chế queue sẵn có).

## 11. Kiểm thử

Repo hiện **chưa có test runner**. Thêm `node:test` (built-in, chạy qua `tsx`, **không thêm dependency**) + script `"test": "tsx --test server/*.test.ts"`.
- **Unit (thuần, hermetic — không gọi API thật):**
  - `resolveAccount`: parse link TikTok (`@handle`, có/không `https`, có query), link Douyin (`douyin.com/user/...`, `v.douyin.com`), bare `@handle`, và input rác → ném lỗi rõ. Mock lớp fetch resolve.
  - `filterAccountVideos`: từng bộ lọc riêng, kết hợp, giá trị biên (đúng ngưỡng), `sinceDays=0`, video view=0 (ER=0), Douyin thiếu save.
  - `rankEngagement` (đã có) — thêm test tập tài khoản nếu cần.
- **Integration:** mock fetch RapidAPI trả fixture `aweme_list` (TikTok + Douyin) → `fetchAccountVideos` chuẩn hóa đúng shape (`createTime`, `stats`), phân trang tới `count`.

## 12. Ngoài phạm vi (YAGNI)

- Không tải video Instagram/YouTube theo tài khoản (chỉ TikTok/Douyin).
- Không lịch tự động re-scan tài khoản định kỳ.
- Không so sánh chéo nhiều tài khoản trong một báo cáo (mỗi cohort = 1 tài khoản).
- Không phân tích bài ảnh (chỉ video).
