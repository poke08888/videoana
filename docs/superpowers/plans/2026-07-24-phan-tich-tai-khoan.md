# Phân tích tài khoản (Account Analysis) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép dán link 1 tài khoản TikTok/Douyin, lấy ≤100 video gần nhất, lọc theo like/view/tỉ lệ tương tác/khoảng thời gian, phân tích hàng loạt qua Gemini, rồi rút ra "vì sao tài khoản này thành công" + đối chiếu nội dung↔chỉ số.

**Architecture:** Tái dùng nguyên pipeline "Campaign" hiện có — job nền trong bảng `search_jobs` (thêm `kind='account'`), hàng đợi phân tích `history`, cohort `ads_cohorts` (thêm `kind='account'`), `rankEngagement`, `finalizeCohortIfDone`/`buildCampaignInsight` (đối chiếu chỉ số) và `buildSynthesisPrompt`/`generateJSON` (tổng hợp lý do thành công). Toàn bộ mã mạng MỚI gom vào `server/account.ts` với HTTP layer **injectable** để test hermetic.

**Tech Stack:** Node 22 + Express + tsx (chạy TS trực tiếp, KHÔNG compile), sqlite3, @google/genai, RapidAPI (tokapi-mobile-version cho TikTok, douyin-api6/TikHub cho Douyin), React 18 + Vite. Test: `node:test` chạy qua `tsx --test` (không thêm dependency runtime).

## Global Constraints

- **Nơi biên soạn & deploy:** Code viết trong bản sync local `/Users/kevin/video` (dùng Edit/Write + chạy test). Sau MỖI task: `rsync` file đã đổi lên server `/var/www/videoana`, commit trên server, rồi `docker compose up -d --build` để app chạy bản mới. Server là nguồn chân lý; giữ local + server + GitHub đồng bộ.
- **Kết nối server:** `export SSHPASS='Dinh2510@'; sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 '<cmd>'`. Rsync: `rsync -az -e "sshpass -e ssh -o StrictHostKeyChecking=no" <file> root@150.95.104.255:/var/www/videoana/<path>`.
- **KHÔNG compile TS** — server chạy `tsx server/index.ts`. Import nội bộ dùng đuôi `.js` (vd `import { x } from "./account.js"`) theo đúng convention hiện có, dù file là `.ts`.
- **Migration DB:** chỉ dùng `addColumnIfMissing` — KHÔNG DROP/ALTER phá dữ liệu (DB production ~141MB, 778 phiếu, 82 users).
- **Quyền:** mọi route account dùng `requireEditor` (Biên tập + Quản trị).
- **Nền tảng:** TikTok + Douyin. ER = `(likes+comments+shares+saves)/views*100`; Douyin thiếu `saves` thì `saves=0` (chấp nhận).
- **Mặc định:** count lấy về = 100 (trần 100); trần phân tích `cap` = 100 (chỉnh được). RapidAPI key dùng chung `TOKAPI_RAPIDAPI_KEY` (đã có trong `.env`).
- **Không phá luồng cũ:** queue.ts, campaign, ads đang chạy production — chỉ THÊM, không sửa hợp đồng cũ. Trường `queue_meta.tiktokUrl` mang cả link TikTok lẫn Douyin (queue.ts tự nhận diện bằng `isDouyinUrl`).

---

## File Structure

| File | Trách nhiệm | Loại |
|---|---|---|
| `server/account.ts` | Resolve link→sec_id, lấy video theo tài khoản, lọc, ER. HTTP layer injectable. | Tạo |
| `server/account.test.ts` | Unit test cho các hàm thuần/injectable của account.ts. | Tạo |
| `server/db.ts` | Thêm cột `search_jobs` (kind, account_url, account_meta, min_er, since_days) + `ads_cohorts.synthesis`. | Sửa |
| `server/index.ts` | `runAccountJob` + 4 route account + 1 route synthesize + resumeSearchJobs branch + trả `synthesis` ở cohort GET. | Sửa |
| `server/cohort.ts` | `finalizeCohortIfDone`: coi `kind='account'` như campaign (eng), bỏ qua saveProductKnowledge cho account. | Sửa |
| `src/lib/api.ts` | Client: startAccountAnalysis, getAccountJob, createAccountAnalysis, synthesizeAccountCohort. | Sửa |
| `src/types.ts` | Type `Account`, `AccountVideo` (frontend). | Sửa |
| `src/App.tsx` | Tab "Phân tích tài khoản" (clone tab Campaign + đổi API + thêm 4 ô lọc + ô count/cap). | Sửa |
| `package.json` | Thêm script `"test": "tsx --test server/*.test.ts"`. | Sửa |

---

## Task 0: Setup môi trường test local

**Files:**
- Modify: `package.json` (thêm script test)

- [ ] **Step 1: Cài dependencies local (một lần)**

Run: `cd /Users/kevin/video && npm install`
Expected: cài xong node_modules (có `tsx`, `sqlite3`, `@google/genai`). Nếu sqlite3 build lỗi trên macOS, vẫn OK — test của account.ts KHÔNG import db/sqlite.

- [ ] **Step 2: Thêm script test vào package.json**

Trong `"scripts"` thêm dòng:
```json
"test": "tsx --test server/*.test.ts",
```

- [ ] **Step 3: Xác minh test runner chạy**

Run: `cd /Users/kevin/video && npx tsx --test server/*.test.ts 2>&1 | tail -3`
Expected: "no test files found" hoặc chạy được (chưa có file test) — miễn là `tsx --test` không lỗi cú pháp.

- [ ] **Step 4: Commit**

```bash
cd /Users/kevin/video
git add package.json
git commit -m "chore: thêm script test (node:test qua tsx)"
```

---

## Task 1: `filterAccountVideos` + `engagementRate` (thuần, TDD)

**Files:**
- Create: `server/account.ts`
- Test: `server/account.test.ts`

**Interfaces:**
- Produces:
  - `engagementRate(s: EngagementStats): number` — % tương tác; 0 nếu views≤0.
  - `interface AccountVideo { awemeId: string; desc: string; author: string; nickname: string; link: string; createTime: number; stats: EngagementStats }`
  - `interface AccountFilter { minLikes?: number; minViews?: number; minER?: number; sinceDays?: number }`
  - `filterAccountVideos(videos: AccountVideo[], filter: AccountFilter, nowSec: number): AccountVideo[]`
- Consumes: `EngagementStats`, `computeEngagement` từ `./tiktok.js`.

- [ ] **Step 1: Viết test thất bại**

Tạo `server/account.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { engagementRate, filterAccountVideos, type AccountVideo } from "./account.js";

const V = (o: Partial<AccountVideo> & { likes: number; views: number; createTime?: number; comments?: number; shares?: number; saves?: number }): AccountVideo => ({
  awemeId: o.awemeId || "1", desc: o.desc || "", author: "a", nickname: "n", link: "http://x/1",
  createTime: o.createTime ?? 0,
  stats: { source: "TikTok", views: o.views, likes: o.likes, comments: o.comments ?? 0, shares: o.shares ?? 0, saves: o.saves ?? 0 },
});

test("engagementRate: views=0 -> 0", () => {
  assert.equal(engagementRate({ source: "TikTok", views: 0, likes: 5, comments: 0, shares: 0, saves: 0 }), 0);
});

test("engagementRate: tính đúng %", () => {
  // (10+2+3+5)/1000*100 = 2
  assert.equal(engagementRate({ source: "TikTok", views: 1000, likes: 10, comments: 2, shares: 3, saves: 5 }), 2);
});

test("filter minLikes/minViews (biên: đúng ngưỡng thì GIỮ)", () => {
  const vids = [V({ likes: 100, views: 1000 }), V({ awemeId: "2", likes: 99, views: 1000 }), V({ awemeId: "3", likes: 100, views: 999 })];
  const out = filterAccountVideos(vids, { minLikes: 100, minViews: 1000 }, 0);
  assert.deepEqual(out.map((v) => v.awemeId), ["1"]);
});

test("filter minER (%)", () => {
  const vids = [V({ likes: 30, views: 1000 }), V({ awemeId: "2", likes: 10, views: 1000 })]; // ER 3% vs 1%
  const out = filterAccountVideos(vids, { minER: 2 }, 0);
  assert.deepEqual(out.map((v) => v.awemeId), ["1"]);
});

test("filter sinceDays: bỏ video cũ hơn cutoff", () => {
  const now = 1_000_000; // giây
  const vids = [V({ createTime: now - 5 * 86400, likes: 1, views: 1 }), V({ awemeId: "2", createTime: now - 40 * 86400, likes: 1, views: 1 })];
  const out = filterAccountVideos(vids, { sinceDays: 30 }, now);
  assert.deepEqual(out.map((v) => v.awemeId), ["1"]);
});

test("filter sinceDays=0: không lọc theo ngày", () => {
  const vids = [V({ createTime: 1, likes: 1, views: 1 })];
  assert.equal(filterAccountVideos(vids, { sinceDays: 0 }, 9_999_999).length, 1);
});

test("filter rỗng: giữ nguyên", () => {
  const vids = [V({ likes: 0, views: 0 }), V({ awemeId: "2", likes: 5, views: 9 })];
  assert.equal(filterAccountVideos(vids, {}, 0).length, 2);
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd /Users/kevin/video && npx tsx --test server/account.test.ts 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './account.js'`.

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `server/account.ts`:
```ts
/**
 * server/account.ts — phân tích tài khoản: resolve link→sec_id, lấy video theo
 * tài khoản (TikTok/Douyin), lọc theo like/view/ER/ngày. HTTP layer injectable
 * để test hermetic (không gọi API thật trong unit test).
 */
import { computeEngagement, type EngagementStats } from "./tiktok.js";

export interface AccountVideo {
  awemeId: string;
  desc: string;
  author: string;
  nickname: string;
  link: string;
  createTime: number; // epoch giây
  stats: EngagementStats;
}

export interface AccountFilter {
  minLikes?: number;
  minViews?: number;
  minER?: number; // %
  sinceDays?: number; // 0 = không giới hạn
}

/** Tỉ lệ tương tác (%) = (like+cmt+share+save)/view*100. 0 nếu view≤0. */
export function engagementRate(s: EngagementStats): number {
  if (!s || s.views <= 0) return 0;
  return ((s.likes + s.comments + s.shares + s.saves) / s.views) * 100;
}

/** Lọc danh sách video theo bộ lọc. `nowSec` truyền vào để test tất định. */
export function filterAccountVideos(videos: AccountVideo[], filter: AccountFilter, nowSec: number): AccountVideo[] {
  const minLikes = Math.max(0, filter.minLikes || 0);
  const minViews = Math.max(0, filter.minViews || 0);
  const minER = Math.max(0, filter.minER || 0);
  const sinceDays = Math.max(0, filter.sinceDays || 0);
  const cutoff = sinceDays > 0 ? nowSec - sinceDays * 86400 : 0;
  return videos.filter((v) => {
    if (v.stats.likes < minLikes) return false;
    if (v.stats.views < minViews) return false;
    if (minER > 0 && engagementRate(v.stats) < minER) return false;
    if (cutoff > 0 && v.createTime > 0 && v.createTime < cutoff) return false;
    return true;
  });
}
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run: `cd /Users/kevin/video && npx tsx --test server/account.test.ts 2>&1 | tail -5`
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/kevin/video
git add server/account.ts server/account.test.ts
git commit -m "feat(account): engagementRate + filterAccountVideos (TDD)"
```

---

## Task 2: `normalizeAccountInput` (parse link, thuần, TDD)

**Files:**
- Modify: `server/account.ts`
- Test: `server/account.test.ts`

**Interfaces:**
- Produces:
  - `type Platform = "tiktok" | "douyin"`
  - `normalizeAccountInput(input: string): { platform: Platform; ref: string } | null` — TikTok: `ref` = handle (không `@`); Douyin: `ref` = URL profile đầy đủ (cho `get_sec_user_id`).

- [ ] **Step 1: Viết test thất bại**

Thêm vào `server/account.test.ts`:
```ts
import { normalizeAccountInput } from "./account.js";

test("normalize: link TikTok @handle", () => {
  assert.deepEqual(normalizeAccountInput("https://www.tiktok.com/@nerman.official"), { platform: "tiktok", ref: "nerman.official" });
});
test("normalize: TikTok có query/đuôi", () => {
  assert.deepEqual(normalizeAccountInput("tiktok.com/@abc_123/video/999?is=1"), { platform: "tiktok", ref: "abc_123" });
});
test("normalize: bare @handle -> tiktok", () => {
  assert.deepEqual(normalizeAccountInput("@shop.cool"), { platform: "tiktok", ref: "shop.cool" });
});
test("normalize: bare handle không @ -> tiktok", () => {
  assert.deepEqual(normalizeAccountInput("shopcool"), { platform: "tiktok", ref: "shopcool" });
});
test("normalize: Douyin user url -> giữ nguyên url có https", () => {
  const r = normalizeAccountInput("https://www.douyin.com/user/MS4wLjABAAAAxyz");
  assert.equal(r?.platform, "douyin");
  assert.equal(r?.ref, "https://www.douyin.com/user/MS4wLjABAAAAxyz");
});
test("normalize: Douyin thiếu scheme -> thêm https", () => {
  const r = normalizeAccountInput("v.douyin.com/abc/");
  assert.equal(r?.platform, "douyin");
  assert.equal(r?.ref, "https://v.douyin.com/abc/");
});
test("normalize: rác -> null", () => {
  assert.equal(normalizeAccountInput("   "), null);
  assert.equal(normalizeAccountInput("has space"), null);
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd /Users/kevin/video && npx tsx --test server/account.test.ts 2>&1 | tail -5`
Expected: FAIL — `normalizeAccountInput` chưa export.

- [ ] **Step 3: Viết implementation**

Thêm vào đầu `server/account.ts` (sau import):
```ts
export type Platform = "tiktok" | "douyin";

/** Chuẩn hoá input người dùng thành {platform, ref}. TikTok ref=handle; Douyin ref=url. */
export function normalizeAccountInput(input: string): { platform: Platform; ref: string } | null {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/(douyin|iesdouyin)\.com/i.test(s)) {
    const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    return { platform: "douyin", ref: url };
  }
  if (/tiktok\.com/i.test(s)) {
    const m = s.match(/@([A-Za-z0-9_.\-]+)/);
    return m ? { platform: "tiktok", ref: m[1] } : null;
  }
  const bare = s.replace(/^@/, "");
  if (/^[A-Za-z0-9_.\-]+$/.test(bare)) return { platform: "tiktok", ref: bare };
  return null;
}
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run: `cd /Users/kevin/video && npx tsx --test server/account.test.ts 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kevin/video
git add server/account.ts server/account.test.ts
git commit -m "feat(account): normalizeAccountInput parse link TikTok/Douyin (TDD)"
```

---

## Task 3: `resolveAccount` (injectable HTTP, TDD)

**Files:**
- Modify: `server/account.ts`
- Test: `server/account.test.ts`

**Interfaces:**
- Produces:
  - `type ApiGet = (host: string, pathname: string, params: Record<string, string>, key: string) => Promise<any>`
  - `interface Account { platform: Platform; secId: string; handle: string; nickname: string; avatar: string }`
  - `resolveAccount(input: string, key: string, apiGet?: ApiGet): Promise<Account>`
  - Hằng export: `TIKTOK_HOST`, `DOUYIN_HOST`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `server/account.test.ts`:
```ts
import { resolveAccount, type ApiGet } from "./account.js";

const fakeTikTok: ApiGet = async (_h, path) => {
  if (path === "/v1/user/@nerman") return { user: { sec_uid: "MS4wSEC", nickname: "Nerman", avatar_168x168: { url_list: ["http://a/av.webp"] } } };
  throw new Error("unexpected " + path);
};
const fakeDouyin: ApiGet = async (_h, path, params) => {
  if (path === "/api/v1/douyin/web/get_sec_user_id") return { data: "MS4wDYSEC" };
  if (path === "/api/v1/douyin/web/handler_user_profile") { assert.equal(params.sec_user_id, "MS4wDYSEC"); return { data: { user: { nickname: "抖音号", avatar_larger: { url_list: ["http://a/dy.webp"] } } } }; }
  throw new Error("unexpected " + path);
};

test("resolveAccount TikTok -> sec_uid + nickname", async () => {
  const acc = await resolveAccount("https://www.tiktok.com/@nerman", "K", fakeTikTok);
  assert.deepEqual({ p: acc.platform, s: acc.secId, h: acc.handle, n: acc.nickname }, { p: "tiktok", s: "MS4wSEC", h: "nerman", n: "Nerman" });
});
test("resolveAccount Douyin -> sec_user_id + nickname từ profile", async () => {
  const acc = await resolveAccount("https://www.douyin.com/user/xyz", "K", fakeDouyin);
  assert.equal(acc.platform, "douyin");
  assert.equal(acc.secId, "MS4wDYSEC");
  assert.equal(acc.nickname, "抖音号");
});
test("resolveAccount TikTok không tồn tại -> ném lỗi", async () => {
  const empty: ApiGet = async () => ({ user: {} });
  await assert.rejects(() => resolveAccount("@ghost", "K", empty), /Không tìm thấy/);
});
test("resolveAccount input rác -> ném lỗi", async () => {
  await assert.rejects(() => resolveAccount("has space", "K", fakeTikTok), /không hợp lệ/i);
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd /Users/kevin/video && npx tsx --test server/account.test.ts 2>&1 | tail -5`
Expected: FAIL — `resolveAccount` chưa export.

- [ ] **Step 3: Viết implementation**

Thêm vào `server/account.ts`:
```ts
export const TIKTOK_HOST = "tokapi-mobile-version.p.rapidapi.com";
export const DOUYIN_HOST = "douyin-api6.p.rapidapi.com";

export type ApiGet = (host: string, pathname: string, params: Record<string, string>, key: string) => Promise<any>;

/** HTTP GET JSON qua RapidAPI (mặc định). Thay bằng stub trong test. */
export const defaultApiGet: ApiGet = async (host, pathname, params, key) => {
  const u = new URL(`https://${host}${pathname}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v);
  const res = await fetch(u.toString(), { headers: { "x-rapidapi-key": key, "x-rapidapi-host": host } });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    throw new Error(`RapidAPI ${host} HTTP ${res.status}: ${b.slice(0, 160)}`);
  }
  return res.json();
};

export interface Account {
  platform: Platform;
  secId: string;
  handle: string;
  nickname: string;
  avatar: string;
}

function firstAvatar(u: any): string {
  for (const f of [u?.avatar_168x168, u?.avatar_larger, u?.avatar_medium, u?.avatar_thumb]) {
    const url = f?.url_list?.[0];
    if (typeof url === "string" && url) return url;
  }
  return "";
}

/** Resolve link/@handle → Account (sec_id + nickname + avatar). */
export async function resolveAccount(input: string, key: string, apiGet: ApiGet = defaultApiGet): Promise<Account> {
  const norm = normalizeAccountInput(input);
  if (!norm) throw new Error("Link tài khoản không hợp lệ. Dán link TikTok (tiktok.com/@ten) hoặc Douyin (douyin.com/user/...).");
  if (norm.platform === "tiktok") {
    const j = await apiGet(TIKTOK_HOST, `/v1/user/@${norm.ref}`, {}, key);
    const u = j?.user;
    const secId = String(u?.sec_uid || "");
    if (!secId) throw new Error(`Không tìm thấy tài khoản TikTok @${norm.ref}.`);
    return { platform: "tiktok", secId, handle: norm.ref, nickname: String(u?.nickname || norm.ref), avatar: firstAvatar(u) };
  }
  const sj = await apiGet(DOUYIN_HOST, "/api/v1/douyin/web/get_sec_user_id", { url: norm.ref }, key);
  const secId = String(sj?.data || "");
  if (!secId) throw new Error("Không resolve được tài khoản Douyin từ link (kiểm tra lại link hoặc RapidAPI key).");
  let nickname = "";
  let avatar = "";
  try {
    const pj = await apiGet(DOUYIN_HOST, "/api/v1/douyin/web/handler_user_profile", { sec_user_id: secId }, key);
    nickname = String(pj?.data?.user?.nickname || "");
    avatar = firstAvatar(pj?.data?.user);
  } catch {
    /* nickname là tuỳ chọn — bỏ qua nếu lỗi */
  }
  return { platform: "douyin", secId, handle: nickname || secId.slice(0, 12), nickname: nickname || "Tài khoản Douyin", avatar };
}
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run: `cd /Users/kevin/video && npx tsx --test server/account.test.ts 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kevin/video
git add server/account.ts server/account.test.ts
git commit -m "feat(account): resolveAccount TikTok/Douyin với ApiGet injectable (TDD)"
```

---

## Task 4: `fetchAccountVideos` (phân trang, injectable, TDD)

**Files:**
- Modify: `server/account.ts`
- Test: `server/account.test.ts`

**Interfaces:**
- Produces: `fetchAccountVideos(account: Account, opts: { count?: number; key: string; apiGet?: ApiGet; shouldStop?: () => boolean }): Promise<AccountVideo[]>`
- Chuẩn hoá mỗi aweme → `AccountVideo` (dùng `computeEngagement`); TikTok path `/v1/post/user/{secId}/posts`, Douyin path `/api/v1/douyin/web/fetch_user_post_videos`; phân trang qua `max_cursor`+`has_more`; dừng khi đủ `count`/hết trang/`shouldStop`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `server/account.test.ts`:
```ts
import { fetchAccountVideos, type Account } from "./account.js";

const AW = (id: string, ct: number, likes: number) => ({ aweme_id: id, desc: "v" + id, create_time: ct, statistics: { play_count: likes * 10, digg_count: likes, comment_count: 0, share_count: 0, collect_count: 0 } });

test("fetchAccountVideos TikTok: gộp 2 trang, dừng khi hết has_more", async () => {
  const acc: Account = { platform: "tiktok", secId: "SEC", handle: "nerman", nickname: "Nerman", avatar: "" };
  const pages: Record<string, any> = {
    "0": { aweme_list: [AW("1", 100, 10), AW("2", 90, 20)], has_more: 1, max_cursor: "50" },
    "50": { aweme_list: [AW("3", 80, 30)], has_more: 0, max_cursor: "0" },
  };
  const apiGet: ApiGet = async (host, path, params) => {
    assert.equal(host, "tokapi-mobile-version.p.rapidapi.com");
    assert.equal(path, "/v1/post/user/SEC/posts");
    return pages[params.max_cursor];
  };
  const out = await fetchAccountVideos(acc, { count: 100, key: "K", apiGet });
  assert.deepEqual(out.map((v) => v.awemeId), ["1", "2", "3"]);
  assert.equal(out[0].link, "https://www.tiktok.com/@nerman/video/1");
  assert.equal(out[0].createTime, 100);
  assert.equal(out[0].stats.likes, 10);
});

test("fetchAccountVideos: tôn trọng count (cắt sớm)", async () => {
  const acc: Account = { platform: "tiktok", secId: "SEC", handle: "n", nickname: "N", avatar: "" };
  const apiGet: ApiGet = async () => ({ aweme_list: [AW("1", 1, 1), AW("2", 1, 1), AW("3", 1, 1)], has_more: 1, max_cursor: "9" });
  const out = await fetchAccountVideos(acc, { count: 2, key: "K", apiGet });
  assert.equal(out.length, 2);
});

test("fetchAccountVideos Douyin: đọc data.aweme_list + link douyin", async () => {
  const acc: Account = { platform: "douyin", secId: "DSEC", handle: "dy", nickname: "DY", avatar: "" };
  const apiGet: ApiGet = async (host, path, params) => {
    assert.equal(host, "douyin-api6.p.rapidapi.com");
    assert.equal(path, "/api/v1/douyin/web/fetch_user_post_videos");
    assert.equal(params.sec_user_id, "DSEC");
    return { data: { aweme_list: [AW("11", 5, 5)], has_more: 0, max_cursor: "0" } };
  };
  const out = await fetchAccountVideos(acc, { count: 100, key: "K", apiGet });
  assert.equal(out[0].link, "https://www.douyin.com/video/11");
  assert.equal(out[0].stats.source, "Douyin");
});

test("fetchAccountVideos: dedup theo aweme_id", async () => {
  const acc: Account = { platform: "tiktok", secId: "S", handle: "n", nickname: "N", avatar: "" };
  let call = 0;
  const apiGet: ApiGet = async () => (call++ === 0
    ? { aweme_list: [AW("1", 1, 1)], has_more: 1, max_cursor: "7" }
    : { aweme_list: [AW("1", 1, 1), AW("2", 1, 1)], has_more: 0, max_cursor: "0" });
  const out = await fetchAccountVideos(acc, { count: 100, key: "K", apiGet });
  assert.deepEqual(out.map((v) => v.awemeId), ["1", "2"]);
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd /Users/kevin/video && npx tsx --test server/account.test.ts 2>&1 | tail -5`
Expected: FAIL — `fetchAccountVideos` chưa export.

- [ ] **Step 3: Viết implementation**

Thêm vào `server/account.ts`:
```ts
function toAccountVideo(aw: any, account: Account): AccountVideo {
  const id = String(aw?.aweme_id || "");
  const stats: EngagementStats = { ...computeEngagement(aw?.statistics, id), source: account.platform === "douyin" ? "Douyin" : "TikTok" };
  const link = account.platform === "douyin"
    ? `https://www.douyin.com/video/${id}`
    : `https://www.tiktok.com/@${account.handle}/video/${id}`;
  return { awemeId: id, desc: String(aw?.desc || ""), author: account.handle, nickname: account.nickname, link, createTime: Number(aw?.create_time) || 0, stats };
}

/** Lấy ≤count video gần nhất của tài khoản, phân trang qua max_cursor. */
export async function fetchAccountVideos(
  account: Account,
  opts: { count?: number; key: string; apiGet?: ApiGet; shouldStop?: () => boolean }
): Promise<AccountVideo[]> {
  const apiGet = opts.apiGet || defaultApiGet;
  const want = Math.min(Math.max(1, opts.count || 100), 100);
  const out: AccountVideo[] = [];
  const seen = new Set<string>();
  let cursor = "0";
  const MAX_PAGES = 20;
  for (let p = 0; p < MAX_PAGES && out.length < want; p++) {
    if (opts.shouldStop?.()) break;
    const raw = account.platform === "tiktok"
      ? await apiGet(TIKTOK_HOST, `/v1/post/user/${account.secId}/posts`, { count: "20", max_cursor: cursor }, opts.key)
      : await apiGet(DOUYIN_HOST, "/api/v1/douyin/web/fetch_user_post_videos", { sec_user_id: account.secId, count: "20", max_cursor: cursor }, opts.key);
    const data = account.platform === "douyin" ? (raw?.data || raw) : raw;
    const list: any[] = data?.aweme_list || [];
    for (const aw of list) {
      const id = String(aw?.aweme_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(toAccountVideo(aw, account));
      if (out.length >= want) break;
    }
    const hasMore = Number(data?.has_more) === 1 || data?.has_more === true;
    const next = String(data?.max_cursor ?? "");
    if (!list.length || !hasMore || !next || next === cursor) break;
    cursor = next;
  }
  return out;
}
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run: `cd /Users/kevin/video && npx tsx --test server/account.test.ts 2>&1 | tail -5`
Expected: PASS (toàn bộ ~18 test account).

- [ ] **Step 5: Deploy account.ts lên server (chưa wiring — chỉ đưa module lên)**

```bash
cd /Users/kevin/video
export SSHPASS='Dinh2510@'
rsync -az -e "sshpass -e ssh -o StrictHostKeyChecking=no" server/account.ts root@150.95.104.255:/var/www/videoana/server/account.ts
```

- [ ] **Step 6: Commit (local + server)**

```bash
cd /Users/kevin/video
git add server/account.ts server/account.test.ts
git commit -m "feat(account): fetchAccountVideos phân trang TikTok/Douyin (TDD)"
export SSHPASS='Dinh2510@'
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && git add server/account.ts && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q -m "feat(account): module account.ts (resolve+fetch+filter)"'
```

---

## Task 5: Migration DB (search_jobs + ads_cohorts)

**Files:**
- Modify: `server/db.ts` (trong `connectDB`, sau khối tạo `search_jobs` ~dòng 227, và sau `ads_cohorts` ~dòng 166)

**Interfaces:**
- Produces: cột mới `search_jobs.kind|account_url|account_meta|min_er|since_days`, `ads_cohorts.synthesis`.

- [ ] **Step 1: Thêm migration search_jobs**

Trong `server/db.ts`, ngay SAU dòng `await addColumnIfMissing("search_jobs", "region TEXT");` thêm:
```ts
  // Cột cho tính năng Phân tích tài khoản (job kind='account').
  await addColumnIfMissing("search_jobs", "kind TEXT DEFAULT 'keyword'");
  await addColumnIfMissing("search_jobs", "account_url TEXT");
  await addColumnIfMissing("search_jobs", "account_meta TEXT"); // JSON Account
  await addColumnIfMissing("search_jobs", "min_er REAL DEFAULT 0");
  await addColumnIfMissing("search_jobs", "since_days INTEGER DEFAULT 0");
```

- [ ] **Step 2: Thêm migration ads_cohorts**

Trong `server/db.ts`, ngay SAU dòng `await addColumnIfMissing("ads_cohorts", "owner TEXT");` thêm:
```ts
  await addColumnIfMissing("ads_cohorts", "synthesis TEXT"); // báo cáo tổng hợp "vì sao tài khoản thành công"
```

- [ ] **Step 3: Deploy + restart + xác minh cột tồn tại**

```bash
cd /Users/kevin/video
export SSHPASS='Dinh2510@'
rsync -az -e "sshpass -e ssh -o StrictHostKeyChecking=no" server/db.ts root@150.95.104.255:/var/www/videoana/server/db.ts
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && docker compose up -d --build 2>&1 | tail -3'
```
Sau khi container `Up`, kiểm tra cột:
```bash
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'docker exec videoana-app node -e "const s=require(\"sqlite3\");const d=new s.Database(\"/app/data/db.sqlite\");d.all(\"PRAGMA table_info(search_jobs)\",(e,r)=>{console.log(r.map(x=>x.name).join(\",\"))});d.all(\"PRAGMA table_info(ads_cohorts)\",(e,r)=>{console.log(r.map(x=>x.name).join(\",\"))})"'
```
Expected: dòng 1 chứa `kind,account_url,account_meta,min_er,since_days`; dòng 2 chứa `synthesis`.

- [ ] **Step 4: Commit (local + server)**

```bash
cd /Users/kevin/video
git add server/db.ts
git commit -m "feat(account): migration search_jobs + ads_cohorts.synthesis"
export SSHPASS='Dinh2510@'
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && git add server/db.ts && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q -m "feat(account): migration cột account"'
```

---

## Task 6: Backend — `runAccountJob` + route search/job/create

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `resolveAccount`, `normalizeAccountInput`, `fetchAccountVideos`, `filterAccountVideos`, `Account`, `AccountFilter` từ `./account.js`; `rankEngagement` (đã import); `cancelSearch`, `runQuery`, `ownerEmail`, `isAdminReq`, `resolveTokapiKey`, `resolveDouyinKey`, `resolveKey`, `productSlug`, `humanizeError`, `DEFAULT_MODEL` (đã có).
- Produces: routes `POST /api/account/search`, `GET /api/account/job/:id`, `POST /api/account/create`. (Stop/discard tái dùng `/api/campaign/job/:id/stop|discard` — kind-agnostic.)

- [ ] **Step 1: Thêm import account vào đầu index.ts**

Sau dòng `import { searchVideos, rankEngagement, parseKeywords } from "./tiktokSearch.js";` thêm:
```ts
import { resolveAccount, normalizeAccountInput, fetchAccountVideos, filterAccountVideos, type Account, type AccountFilter } from "./account.js";
```

- [ ] **Step 2: Thêm `runAccountJob` (đặt ngay dưới `runSearchJob`, trước route campaign)**

```ts
// Chạy NỀN job lấy video theo tài khoản: lấy ≤count → lọc → xếp hạng tương tác →
// lưu vào search_jobs. Cùng khuôn với runSearchJob (dừng được, sống sót restart).
async function runAccountJob(jobId: string, account: Account, key: string, filter: AccountFilter, count: number) {
  try {
    const all = await fetchAccountVideos(account, { count, key, shouldStop: () => cancelSearch.has(jobId) });
    const matched = filterAccountVideos(all, filter, Math.floor(Date.now() / 1000));
    const engs = rankEngagement(matched as any); // cùng thứ tự với matched
    const videos = matched.map((v, i) => ({ ...v, eng: engs[i] }));
    const wasStopped = cancelSearch.has(jobId);
    cancelSearch.delete(jobId);
    const nowIso = new Date().toISOString();
    if (!videos.length) {
      await runQuery("UPDATE search_jobs SET status='failed', found=0, scanned=?, message=?, updated=? WHERE id=?",
        [all.length, all.length ? `Lấy được ${all.length} video nhưng không video nào đạt bộ lọc.` : "Không lấy được video nào (tài khoản riêng tư/không có video?).", nowIso, jobId]);
      return;
    }
    await runQuery("UPDATE search_jobs SET status='ready', found=?, scanned=?, videos=?, message=?, updated=? WHERE id=?",
      [videos.length, all.length, JSON.stringify(videos), wasStopped ? "Đã dừng — giữ lại phần đã lấy." : "", nowIso, jobId]);
  } catch (err: any) {
    console.error("Lỗi runAccountJob:", err);
    cancelSearch.delete(jobId);
    await runQuery("UPDATE search_jobs SET status='failed', message=?, updated=? WHERE id=?", [humanizeError(err), new Date().toISOString(), jobId]).catch(() => {});
  }
}
```

- [ ] **Step 3: Thêm route `POST /api/account/search` (đặt ngay sau route `/api/campaign/search`)**

```ts
// Phân tích tài khoản — BƯỚC 1: resolve tài khoản + tạo job nền lấy+lọc video.
app.post("/api/account/search", requireEditor, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ ok: false, message: "Vui lòng nhập link tài khoản." });
    const norm = normalizeAccountInput(url);
    if (!norm) return res.status(400).json({ ok: false, message: "Link tài khoản không hợp lệ (TikTok tiktok.com/@ten hoặc Douyin douyin.com/user/...)." });
    const key = norm.platform === "douyin" ? resolveDouyinKey(req.body?.tokapiKey) : resolveTokapiKey(req.body?.tokapiKey);
    if (!key) return res.status(400).json({ ok: false, error: "no-tokapi-key", message: "Chưa cấu hình RapidAPI key (TOKAPI_RAPIDAPI_KEY)." });
    let account: Account;
    try { account = await resolveAccount(url, key); }
    catch (e: any) { return res.status(400).json({ ok: false, message: e?.message || "Không resolve được tài khoản." }); }
    const filter: AccountFilter = {
      minLikes: Math.max(0, Number(req.body?.minLikes) || 0),
      minViews: Math.max(0, Number(req.body?.minViews) || 0),
      minER: Math.max(0, Number(req.body?.minER) || 0),
      sinceDays: Math.max(0, Number(req.body?.sinceDays) || 0),
    };
    const count = Math.min(Math.max(1, Number(req.body?.count) || 100), 100);
    const owner = ownerEmail(req);
    const jobId = "a" + Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();
    await runQuery(
      "INSERT INTO search_jobs (id, owner, kind, account_url, account_meta, keywords, min_likes, min_views, min_er, since_days, target, status, created, updated) VALUES (?,?,'account',?,?,?,?,?,?,?,?,'searching',?,?)",
      [jobId, owner, url, JSON.stringify(account), JSON.stringify([account.nickname]), filter.minLikes, filter.minViews, filter.minER, filter.sinceDays, count, now, now]
    );
    runAccountJob(jobId, account, key, filter, count); // không await
    res.json({ ok: true, jobId, account });
  } catch (err: any) {
    console.error("Lỗi account search:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi khởi tạo phân tích tài khoản." });
  }
});

// Poll job tài khoản — trả account_meta + videos khi ready.
app.get("/api/account/job/:id", requireEditor, async (req, res) => {
  try {
    const j = await getQuery<any>("SELECT * FROM search_jobs WHERE id = ?", [req.params.id]);
    if (!j) return res.status(404).json({ ok: false, message: "Không tìm thấy job." });
    if (!isAdminReq(req) && String(j.owner || "").toLowerCase().trim() !== ownerEmail(req)) return res.status(404).json({ ok: false });
    let account: any = null; try { account = JSON.parse(j.account_meta || "null"); } catch {}
    res.json({
      ok: true, jobId: j.id, status: j.status, account,
      found: j.found || 0, scanned: j.scanned || 0, message: j.message || "",
      videos: j.status === "ready" && j.videos ? JSON.parse(j.videos) : undefined,
    });
  } catch (e: any) { res.status(500).json({ ok: false }); }
});
```

- [ ] **Step 4: Thêm route `POST /api/account/create` (đặt sau `/api/campaign/create`)**

```ts
// Phân tích tài khoản — BƯỚC 2: nhận video đã chọn (top-cap) → tạo cohort kind='account' + xếp hàng Gemini.
app.post("/api/account/create", requireEditor, async (req, res) => {
  try {
    const account = req.body?.account;
    if (!account || !account.platform) return res.status(400).json({ ok: false, message: "Thiếu thông tin tài khoản." });
    const apiKey = resolveKey(req.body?.apiKey);
    if (!apiKey) return res.status(400).json({ ok: false, error: "no-key", message: "Chưa kết nối Gemini API." });
    const tokapiKey = resolveTokapiKey(req.body?.tokapiKey);
    const douyinKey = resolveDouyinKey(req.body?.tokapiKey);
    const model = req.body?.model || DEFAULT_MODEL;
    const email = req.user?.email;
    const cap = Math.min(Math.max(1, Number(req.body?.cap) || 100), 100);
    const label = String(account.nickname || account.handle || "Tài khoản").slice(0, 80);
    const platLabel = account.platform === "douyin" ? "Douyin" : "TikTok";

    const incoming: any[] = Array.isArray(req.body?.videos) ? req.body.videos : [];
    const videos = incoming
      .filter((v) => v && v.link && v.stats)
      .map((v) => ({ awemeId: String(v.awemeId || ""), desc: String(v.desc || ""), author: String(v.author || ""), nickname: String(v.nickname || ""), link: String(v.link), stats: v.stats }))
      .slice(0, cap);
    if (!videos.length) return res.status(400).json({ ok: false, message: "Chưa có video nào để phân tích." });

    const engs = rankEngagement(videos as any);
    const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 0; };
    const summary = {
      count: videos.length, keyword: label, account, platform: account.platform,
      summary: { tot: engs.filter((e) => e.tier === "tốt").length, kha: engs.filter((e) => e.tier === "khá").length, thap: engs.filter((e) => e.tier === "thấp").length, medianLikes: med(engs.map((e) => e.likes)), medianRate: med(engs.map((e) => e.engagementRate)) },
    };
    const cohortId = "c" + Math.random().toString(36).slice(2, 10);
    const owner = String(email || "").toLowerCase().trim();
    await runQuery(
      "INSERT INTO ads_cohorts (id, product, product_slug, created, count, summary, insight, kind, owner) VALUES (?, ?, ?, ?, ?, ?, NULL, 'account', ?)",
      [cohortId, label, productSlug(label), new Date().toISOString(), videos.length, JSON.stringify(summary), owner]
    );
    const av = ["linear-gradient(150deg,#3c7a5e,#2a5a44)", "linear-gradient(150deg,#b06a16,#7a4a10)", "linear-gradient(150deg,#9e3a3a,#6a2424)", "linear-gradient(150deg,#3a2a16,#5a4326)", "linear-gradient(150deg,#2f6b8a,#1e4a60)"];
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const id = "e" + Math.random().toString(36).slice(2, 8);
      const meta = { apiKey, model, form: { product: label, platform: platLabel }, tiktokUrl: v.link, tokapiKey, douyinKey, email, eng: engs[i], cohortId };
      await runQuery(
        "INSERT INTO history (id, title, platform, product, date, score, analysis, thumb, status, queue_meta, cohort_id, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, (v.desc || ("Video " + platLabel)).slice(0, 80), platLabel, label, "Hôm nay", engs[i].score, "{}", av[i % av.length], "pending", JSON.stringify(meta), cohortId, owner]
      );
    }
    res.json({ ok: true, cohortId, count: videos.length });
  } catch (err: any) {
    console.error("Lỗi account create:", err);
    res.status(500).json({ ok: false, message: "Lỗi hệ thống khi tạo phân tích tài khoản." });
  }
});
```

- [ ] **Step 5: Deploy + rebuild**

```bash
cd /Users/kevin/video
export SSHPASS='Dinh2510@'
rsync -az -e "sshpass -e ssh -o StrictHostKeyChecking=no" server/index.ts root@150.95.104.255:/var/www/videoana/server/index.ts
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && docker compose up -d --build 2>&1 | tail -3'
```

- [ ] **Step 6: Smoke test route search (tài khoản TikTok thật)**

```bash
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && docker logs videoana-app --tail 5'
```
Kiểm tra token: đăng nhập lấy JWT rồi gọi (thay TOKEN):
```bash
# Lấy token admin
TOKEN=$(sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'curl -s -X POST http://127.0.0.1:8787/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"k@nerman.asia\",\"password\":\"'"$ADMIN_PW"'\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"token\",\"\"))"')
# (Nếu không có mật khẩu admin, bỏ qua smoke test HTTP — sẽ test qua UI ở Task 10.)
```
Expected: nếu có token → `POST /api/account/search {url:"https://www.tiktok.com/@tiktok"}` trả `{ok:true, jobId, account:{platform:"tiktok",...}}`, và `GET /api/account/job/:id` sau ~5s trả `status:"ready"` + `videos[]`. Nếu không lấy được token, đánh dấu step này "verify qua UI ở Task 10" và tiếp tục.

- [ ] **Step 7: Commit (local + server)**

```bash
cd /Users/kevin/video
git add server/index.ts
git commit -m "feat(account): runAccountJob + route search/job/create"
export SSHPASS='Dinh2510@'
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && git add server/index.ts && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q -m "feat(account): route search/job/create + runAccountJob"'
```

---

## Task 7: Backend — finalize account + route synthesize + trả synthesis

**Files:**
- Modify: `server/cohort.ts`, `server/index.ts`

**Interfaces:**
- Consumes: `buildCampaignInsight` (đã import trong cohort.ts), `buildSynthesisPrompt`, `generateJSON`, `SourceVideo` (đã import trong index.ts).
- Produces: cohort `kind='account'` sinh `insight` (đối chiếu chỉ số) + route `POST /api/account/cohort/:id/synthesize` ghi `ads_cohorts.synthesis`; `GET /api/ads/cohort/:id` trả thêm `synthesis`.

- [ ] **Step 1: Sửa finalize cho account (cohort.ts)**

Trong `server/cohort.ts`, thay dòng `const isCampaign = cohort.kind === "campaign";` bằng:
```ts
  // Account dùng cùng đường "eng" như campaign (đối chiếu nội dung↔tương tác).
  const useEng = cohort.kind === "campaign" || cohort.kind === "account";
  const isAccount = cohort.kind === "account";
```
Thay mọi `isCampaign` còn lại trong hàm bằng `useEng`: cụ thể
- `if (isCampaign && a.eng)` → `if (useEng && a.eng)`
- `else if (!isCampaign && a.ads)` → `else if (!useEng && a.ads)`
- `const insight = isCampaign ? buildCampaignInsight(videos) : buildCohortInsight(videos);` → `const insight = useEng ? buildCampaignInsight(videos) : buildCohortInsight(videos);`

Sau `await runQuery("UPDATE ads_cohorts SET insight = ? ...")`, bọc phần `buildKnowledgeDoc`+`saveProductKnowledge` để BỎ QUA khi account (kho kiến thức theo sản phẩm không hợp với tài khoản):
```ts
  if (!isAccount) {
    // (giữ nguyên khối buildKnowledgeDoc + saveProductKnowledge hiện có)
    ...
  }
  return true;
```

- [ ] **Step 2: Thêm route synthesize (index.ts, đặt sau `/api/ads/cohort/:id/finalize`)**

```ts
// Tổng hợp "vì sao tài khoản này thành công" — gom phiếu đã xong của cohort → Gemini.
app.post("/api/account/cohort/:id/synthesize", requireEditor, async (req, res) => {
  try {
    const c = await getQuery<any>("SELECT owner FROM ads_cohorts WHERE id = ?", [req.params.id]);
    if (!c) return res.status(404).json({ ok: false, message: "Không tìm thấy cụm." });
    if (!isAdminReq(req) && String(c.owner || "").toLowerCase().trim() !== ownerEmail(req)) return res.status(404).json({ ok: false });
    const apiKey = resolveKey(req.body?.apiKey);
    if (!apiKey) return res.status(400).json({ ok: false, error: "no-key", message: "Chưa kết nối Gemini API." });
    const rows = await allQuery<any>("SELECT id, title, score, analysis FROM history WHERE cohort_id = ? AND status = 'completed'", [req.params.id]);
    const videos: SourceVideo[] = [];
    for (const r of rows) { try { const a = JSON.parse(r.analysis); if (a && a.checklist) videos.push({ id: r.id, title: r.title, score: r.score, analysis: a }); } catch {} }
    if (videos.length < 2) return res.status(400).json({ ok: false, message: "Cần ít nhất 2 phiếu hoàn tất để tổng hợp (đang có " + videos.length + ")." });
    const report = await generateJSON(apiKey, req.body?.model, buildSynthesisPrompt(videos));
    if (!report || !Array.isArray(report.reasons)) throw new Error("Báo cáo tổng hợp không đúng định dạng.");
    await runQuery("UPDATE ads_cohorts SET synthesis = ? WHERE id = ?", [JSON.stringify(report), req.params.id]);
    res.json({ ok: true, report });
  } catch (err: any) {
    console.error("Lỗi synthesize account:", err);
    res.status(502).json({ ok: false, message: humanizeError(err) });
  }
});
```

- [ ] **Step 3: Trả `synthesis` trong GET /api/ads/cohort/:id**

Trong route `app.get("/api/ads/cohort/:id", ...)`, ở object `cohort:` trả về, thêm field `synthesis`:
```ts
      cohort: { id: c.id, product: c.product, created: c.created, count: c.count, kind: c.kind || "ads", summary: JSON.parse(c.summary || "{}"), insight: c.insight ? JSON.parse(c.insight) : null, synthesis: c.synthesis ? JSON.parse(c.synthesis) : null },
```

- [ ] **Step 4: Deploy + rebuild**

```bash
cd /Users/kevin/video
export SSHPASS='Dinh2510@'
rsync -az -e "sshpass -e ssh -o StrictHostKeyChecking=no" server/cohort.ts server/index.ts root@150.95.104.255:/var/www/videoana/server/
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && docker compose up -d --build 2>&1 | tail -3 && docker logs videoana-app --tail 5'
```
Expected: container `Up`, log có "Kết nối SQLite thành công" và không có lỗi cú pháp TS.

- [ ] **Step 5: Commit (local + server)**

```bash
cd /Users/kevin/video
git add server/cohort.ts server/index.ts
git commit -m "feat(account): finalize đối chiếu chỉ số + route synthesize + trả synthesis"
export SSHPASS='Dinh2510@'
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && git add server/cohort.ts server/index.ts && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q -m "feat(account): finalize + synthesize"'
```

---

## Task 8: Backend — resumeSearchJobs xử lý job account

**Files:**
- Modify: `server/index.ts` (`resumeSearchJobs`, ~dòng 1133)

- [ ] **Step 1: Sửa `resumeSearchJobs` để branch theo kind**

Thay câu SELECT và vòng lặp trong `resumeSearchJobs`:
```ts
async function resumeSearchJobs() {
  try {
    const jobs = await allQuery<any>("SELECT id, kind, keywords, account_meta, min_likes, min_views, min_er, since_days, target, region FROM search_jobs WHERE status='searching'");
    if (!jobs.length) return;
    for (const j of jobs) {
      if (j.kind === "account") {
        let account: any = null; try { account = JSON.parse(j.account_meta || "null"); } catch {}
        const key = account?.platform === "douyin" ? resolveDouyinKey(undefined) : resolveTokapiKey(undefined);
        if (!account || !key) {
          await runQuery("UPDATE search_jobs SET status='failed', message='Không tự chạy lại được sau khởi động — vui lòng phân tích lại.', updated=? WHERE id=?", [new Date().toISOString(), j.id]).catch(() => {});
          continue;
        }
        await runQuery("UPDATE search_jobs SET found=0, scanned=0, updated=? WHERE id=?", [new Date().toISOString(), j.id]).catch(() => {});
        console.log(`[nonelab] Tự chạy lại job tài khoản sau khởi động: ${j.id} (${account.nickname})`);
        runAccountJob(j.id, account, key, { minLikes: j.min_likes || 0, minViews: j.min_views || 0, minER: j.min_er || 0, sinceDays: j.since_days || 0 }, j.target || 100);
        continue;
      }
      // ── job keyword (giữ nguyên logic cũ) ──
      let keywords: string[] = [];
      try { keywords = JSON.parse(j.keywords || "[]"); } catch {}
      const tokapiKey = resolveTokapiKey(undefined);
      if (!keywords.length || !tokapiKey) {
        await runQuery("UPDATE search_jobs SET status='failed', message='Không tự chạy lại được sau khi máy chủ khởi động — vui lòng tìm lại.', updated=? WHERE id=?", [new Date().toISOString(), j.id]).catch(() => {});
        continue;
      }
      await runQuery("UPDATE search_jobs SET found=0, scanned=0, pages=0, updated=? WHERE id=?", [new Date().toISOString(), j.id]).catch(() => {});
      console.log(`[nonelab] Tự chạy lại job tìm video sau khởi động: ${j.id} (${keywords.join(", ")})`);
      runSearchJob(j.id, keywords, tokapiKey, j.min_likes || 0, j.min_views || 0, j.target || 50, j.region || "");
    }
  } catch (err) {
    console.error("[nonelab] Lỗi tự chạy lại job tìm video:", err);
  }
}
```

- [ ] **Step 2: Deploy + rebuild + xác minh không lỗi khởi động**

```bash
cd /Users/kevin/video
export SSHPASS='Dinh2510@'
rsync -az -e "sshpass -e ssh -o StrictHostKeyChecking=no" server/index.ts root@150.95.104.255:/var/www/videoana/server/index.ts
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && docker compose up -d --build 2>&1 | tail -3 && sleep 3 && docker logs videoana-app --tail 8'
```
Expected: log khởi động bình thường, không lỗi.

- [ ] **Step 3: Commit (local + server)**

```bash
cd /Users/kevin/video
git add server/index.ts
git commit -m "feat(account): resumeSearchJobs chạy lại job account sau restart"
export SSHPASS='Dinh2510@'
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && git add server/index.ts && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q -m "feat(account): resume job account"'
```

---

## Task 9: Frontend — types + client API

**Files:**
- Modify: `src/types.ts`, `src/lib/api.ts`

**Interfaces:**
- Produces (api.ts): `startAccountAnalysis`, `getAccountJob`, `createAccountAnalysis`, `synthesizeAccountCohort`. Tái dùng `stopCampaignSearch`/`discardCampaignJob` cho job account (kind-agnostic).

- [ ] **Step 1: Thêm type frontend (src/types.ts, cuối file)**

```ts
export interface Account {
  platform: "tiktok" | "douyin";
  secId: string;
  handle: string;
  nickname: string;
  avatar: string;
}

export interface AccountVideo {
  awemeId: string;
  desc: string;
  author: string;
  nickname: string;
  link: string;
  createTime: number;
  stats: { source: string; views: number; likes: number; comments: number; shares: number; saves: number };
  eng?: { score: number; tier: string; likes: number; views: number; engagementRate: number };
}
```

- [ ] **Step 2: Thêm client functions (src/lib/api.ts, sau `createCampaign`)**

```ts
// ── Phân tích tài khoản ──────────────────────────────────────────────────────
// Bước 1: resolve tài khoản + job nền lấy/lọc video. Trả { jobId, account }.
export async function startAccountAnalysis(opts: { url: string; count?: number; minLikes?: number; minViews?: number; minER?: number; sinceDays?: number }): Promise<any> {
  try {
    const res = await fetch("/api/account/search", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(opts) });
    return await res.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ." }));
  } catch { return { ok: false, message: "Không gọi được backend." }; }
}

// Poll job tài khoản (searching/ready/failed). Khi ready có .videos + .account.
export async function getAccountJob(jobId: string): Promise<any> {
  try {
    const res = await fetch(`/api/account/job/${jobId}`, { headers: authHeaders() });
    return await res.json().catch(() => ({ ok: false }));
  } catch { return { ok: false }; }
}

// Bước 2: gửi video đã chọn (top-cap) → tạo cohort kind='account'. Trả { cohortId }.
export async function createAccountAnalysis(opts: { account: any; videos: any[]; cap?: number; apiKey?: string; model?: string }): Promise<any> {
  try {
    const res = await fetch("/api/account/create", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(opts) });
    return await res.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ." }));
  } catch { return { ok: false, message: "Không gọi được backend." }; }
}

// Tổng hợp "vì sao tài khoản thành công" cho cohort đã phân tích xong.
export async function synthesizeAccountCohort(cohortId: string, opts?: { apiKey?: string; model?: string }): Promise<any> {
  try {
    const res = await fetch(`/api/account/cohort/${cohortId}/synthesize`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(opts || {}) });
    return await res.json().catch(() => ({ ok: false, message: "Phản hồi không hợp lệ." }));
  } catch { return { ok: false, message: "Không gọi được backend." }; }
}
```

- [ ] **Step 3: Kiểm tra build frontend (local)**

Run: `cd /Users/kevin/video && npx tsc -b 2>&1 | tail -15`
Expected: không lỗi type mới ở `src/lib/api.ts`/`src/types.ts`. (Bỏ qua lỗi type có sẵn không liên quan nếu có.)

- [ ] **Step 4: Commit**

```bash
cd /Users/kevin/video
git add src/types.ts src/lib/api.ts
git commit -m "feat(account): types + client API (frontend)"
```

---

## Task 10: Frontend — Tab "Phân tích tài khoản" (App.tsx)

**Files:**
- Modify: `src/App.tsx`

**Bối cảnh:** `src/App.tsx` (3300 dòng) chứa toàn bộ màn hình + state. Tab "Campaign" (tìm video theo từ khóa → chọn → tạo cohort → xem cohort) là khuôn gần nhất. Task này **clone khuôn Campaign** cho tài khoản, đổi lời gọi API và thêm ô lọc. KHÔNG viết lại từ đầu — mở App.tsx, tìm phần Campaign làm mẫu.

**Interfaces:**
- Consumes: `startAccountAnalysis`, `getAccountJob`, `createAccountAnalysis`, `synthesizeAccountCohort`, `stopCampaignSearch`, `discardCampaignJob`, `listCohorts`, `getCohort` (đã có), `getGeminiKey`/model từ state Quản trị (theo cách Campaign lấy).

- [ ] **Step 1: Định vị khuôn Campaign trong App.tsx**

Run: `cd /Users/kevin/video && grep -nE "startCampaignSearch|getCampaignJob|createCampaign|Campaign|chiến dịch|từ khóa" src/App.tsx | head -40`
Ghi lại: tên biến tab hiện tại (state điều hướng), component/hàm render tab Campaign, cách nó poll job, cách render danh sách video + nút "Phân tích".

- [ ] **Step 2: Thêm mục điều hướng "Phân tích tài khoản"**

Thêm một tab/nav item mới cạnh Campaign (cùng cơ chế state điều hướng đang dùng). Nhãn: "Phân tích tài khoản". Chỉ hiện với vai trò Biên tập/Quản trị (theo cách Campaign gate — dùng cùng điều kiện quyền).

- [ ] **Step 3: Thêm state + form cho tab account**

Thêm state (useState) trong component chính:
```tsx
const [accUrl, setAccUrl] = useState("");
const [accCount, setAccCount] = useState(100);
const [accMinLikes, setAccMinLikes] = useState(0);
const [accMinViews, setAccMinViews] = useState(0);
const [accMinER, setAccMinER] = useState(0);
const [accSinceDays, setAccSinceDays] = useState(0);
const [accCap, setAccCap] = useState(100);
const [accJobId, setAccJobId] = useState<string | null>(null);
const [accJob, setAccJob] = useState<any>(null); // {status, account, videos, found, scanned, message}
const [accBusy, setAccBusy] = useState(false);
```

- [ ] **Step 4: Handler "Lấy video" + poll**

```tsx
async function onAccountSearch() {
  setAccBusy(true); setAccJob(null);
  const r = await startAccountAnalysis({ url: accUrl.trim(), count: accCount, minLikes: accMinLikes, minViews: accMinViews, minER: accMinER, sinceDays: accSinceDays });
  setAccBusy(false);
  if (!r.ok) { alert(r.message || "Lỗi khởi tạo."); return; }
  setAccJobId(r.jobId); setAccJob({ status: "searching", account: r.account });
}
// Poll khi có accJobId và chưa ready/failed
useEffect(() => {
  if (!accJobId) return;
  if (accJob && (accJob.status === "ready" || accJob.status === "failed")) return;
  const t = setInterval(async () => {
    const j = await getAccountJob(accJobId);
    if (j.ok) setAccJob(j);
    if (j.ok && (j.status === "ready" || j.status === "failed")) clearInterval(t);
  }, 2500);
  return () => clearInterval(t);
}, [accJobId, accJob?.status]);
```

- [ ] **Step 5: Render danh sách video đạt lọc + client-side re-filter + nút phân tích**

Khi `accJob.status === "ready"`: hiển thị `accJob.videos` (đã lọc + xếp hạng ở server). Cho phép lọc lại client-side theo cùng 4 tiêu chí (dùng cùng state ô lọc) để người dùng siết thêm không cần gọi lại API:
```tsx
const accMatched = (accJob?.videos || []).filter((v: any) =>
  v.stats.likes >= accMinLikes && v.stats.views >= accMinViews &&
  (accMinER <= 0 || (v.stats.views > 0 && ((v.stats.likes + v.stats.comments + v.stats.shares + v.stats.saves) / v.stats.views) * 100 >= accMinER)) &&
  (accSinceDays <= 0 || v.createTime <= 0 || v.createTime >= Math.floor(Date.now() / 1000) - accSinceDays * 86400)
);
const accToAnalyze = [...accMatched].sort((a, b) => (b.eng?.score || 0) - (a.eng?.score || 0)).slice(0, accCap);
```
Hiển thị dòng tóm tắt: `"{accMatched.length} video đạt lọc — sẽ phân tích {accToAnalyze.length} (trần {accCap})"` + ô nhập `accCap` (mặc định 100) + nút "Phân tích {accToAnalyze.length} video".

- [ ] **Step 6: Handler "Phân tích" → tạo cohort → điều hướng sang xem cohort**

```tsx
async function onAccountCreate() {
  setAccBusy(true);
  const r = await createAccountAnalysis({ account: accJob.account, videos: accToAnalyze, cap: accCap /*, apiKey/model theo cách Campaign truyền*/ });
  setAccBusy(false);
  if (!r.ok) { alert(r.message || "Lỗi tạo phân tích."); return; }
  if (accJobId) discardCampaignJob(accJobId); // dọn job
  // Điều hướng tới màn xem cohort (dùng đúng cơ chế Campaign mở cohort theo r.cohortId)
  openCohort(r.cohortId); // <- thay bằng hàm mở cohort thực tế trong App.tsx
}
```

- [ ] **Step 7: Màn xem cohort — hiển thị synthesis + nút tổng hợp**

Tái dùng màn xem cohort hiện có (Campaign đã có). Bổ sung: khi `cohort.kind === "account"` và mọi video đã xong (`done === total`), hiện nút "Tổng hợp vì sao tài khoản thành công" gọi `synthesizeAccountCohort(cohortId, {apiKey, model})`; khi có `cohort.synthesis` thì render (overview, reasons[], hookPattern, formula, differences, actionChecklist) — dùng đúng cách màn "Báo cáo tổng hợp" (synthesis) hiện có render report. Khối `cohort.insight` (đối chiếu chỉ số) đã được màn cohort render sẵn cho campaign — account dùng chung.

- [ ] **Step 8: Build frontend (local)**

Run: `cd /Users/kevin/video && npx vite build 2>&1 | tail -15`
Expected: build thành công ra `dist/`.

- [ ] **Step 9: Deploy + rebuild container (build frontend nằm trong Dockerfile)**

```bash
cd /Users/kevin/video
export SSHPASS='Dinh2510@'
rsync -az -e "sshpass -e ssh -o StrictHostKeyChecking=no" src/App.tsx src/types.ts src/lib/api.ts root@150.95.104.255:/var/www/videoana/src/
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && docker compose up -d --build 2>&1 | tail -3'
```

- [ ] **Step 10: Verify end-to-end qua UI**

Mở https://video.nonelab.net, đăng nhập (Biên tập/Quản trị) → tab "Phân tích tài khoản" → dán 1 link TikTok thật (vd `https://www.tiktok.com/@tiktok`) + đặt lọc → "Lấy video" → thấy danh sách + số đạt lọc → đặt trần nhỏ (vd 2 để test rẻ) → "Phân tích" → chờ hàng đợi chạy → mở cohort → thấy bảng xếp hạng + (khi đủ ≥3 video) đối chiếu chỉ số → bấm "Tổng hợp" → thấy báo cáo "vì sao thành công". Lặp lại 1 link Douyin.
Expected: luồng chạy trơn; lỗi (nếu có) hiển thị thông báo tiếng Việt rõ ràng.

- [ ] **Step 11: Commit (local + server)**

```bash
cd /Users/kevin/video
git add src/App.tsx
git commit -m "feat(account): tab Phân tích tài khoản (UI)"
export SSHPASS='Dinh2510@'
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && git add src/App.tsx src/types.ts src/lib/api.ts && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q -m "feat(account): frontend tab + client API"'
```

---

## Task 11: Kiểm thử hồi quy + đẩy GitHub (tuỳ chọn)

- [ ] **Step 1: Chạy toàn bộ unit test**

Run: `cd /Users/kevin/video && npx tsx --test server/*.test.ts 2>&1 | tail -8`
Expected: tất cả PASS.

- [ ] **Step 2: Kiểm tra luồng CŨ không hỏng (Campaign)**

Qua UI: tab Campaign tìm 1 từ khóa → vẫn tạo được cohort như trước (không regression do sửa `search_jobs`/`resumeSearchJobs`/`finalize`).

- [ ] **Step 3: (Tuỳ chọn) đẩy server repo lên GitHub**

```bash
export SSHPASS='Dinh2510@'
sshpass -e ssh -o StrictHostKeyChecking=no root@150.95.104.255 'cd /var/www/videoana && git push origin main 2>&1 | tail -3'
```
(Chỉ chạy nếu người dùng muốn đồng bộ GitHub; cần credential trên server.)

---

## Self-Review

**Spec coverage:**
- Nền tảng TikTok+Douyin → Task 3/4 (resolve+fetch cả 2). ✓
- 4 bộ lọc (like/view/ER/ngày) → Task 1 (filter), Task 6 (route nhận filter), Task 10 (UI). ✓
- Count 100 / trần cap 100 + xác nhận → Task 6 (count clamp 100), Task 10 (ô cap + nút xác nhận). ✓
- Đầu ra cả hai (synthesis + đối chiếu chỉ số) → Task 7 (finalize buildCampaignInsight + route synthesize), Task 10 (render). ✓
- Kiến trúc C (job nền search_jobs kind='account' + polling) → Task 5/6/8. ✓
- ER Douyin không save → Task 1 (computeEngagement Douyin saves=0). ✓
- Nickname Douyin qua handler_user_profile → Task 3. ✓
- requireEditor → mọi route Task 6/7. ✓
- Resume sau restart → Task 8. ✓
- Kiểm thử node:test → Task 0/1-4/11. ✓

**Placeholder scan:** Task 10 có vài chỗ "thay bằng hàm mở cohort thực tế"/"theo cách Campaign truyền apiKey" — đây là ĐIỂM NEO vào code hiện có mà executor phải đọc App.tsx để khớp tên thật (App.tsx quá lớn để chép nguyên); Step 1 của Task 10 bắt buộc định vị trước. Không phải placeholder logic — là chỉ dẫn tích hợp vào file lớn có sẵn.

**Type consistency:** `Account`/`AccountVideo`/`AccountFilter`/`ApiGet` khớp giữa account.ts (server) và khai báo dùng ở index.ts; type frontend `Account`/`AccountVideo` (types.ts) là bản mirror cho UI. `rankEngagement` nhận `.stats` — AccountVideo tương thích cấu trúc (ép `as any` khi gọi, giống campaign). `eng` gắn vào video khớp `EngReport` của tiktokSearch.ts. ✓
