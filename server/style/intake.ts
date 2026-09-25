/**
 * server/style/intake.ts — một nút "Phân tích kênh" (Task 15): tạo vỏ profile 'picking' trả về ngay,
 * nền: resolve kênh → lấy 100 video → pickStyleVideos → đổ video → 'running' (hàng đợi tự nhận).
 * Lỗi bước này → profile 'failed' + message tiếng Việt; UI có nút "Chạy lại" gọi lại /start cùng URL.
 */
import { normalizeAccountInput, type Account, type AccountVideo } from "../account.js";
import { STYLE } from "./config.js";
import { pickStyleVideos } from "./pick.js";
import { createProfileShell, fillProfileVideos, updateProfile } from "./store.js";

export interface PickDeps {
  resolveAccount: (input: string, key: string) => Promise<Account>;
  fetchAccountVideos: (account: Account, opts: { count: number; key: string }) => Promise<AccountVideo[]>;
  rapidKey: (platform: "tiktok" | "douyin") => string | null;
}

export const INVALID_URL_MSG = "Link kênh không hợp lệ (tiktok.com/@ten hoặc douyin.com/user/...).";

/** Handle tạm cho vỏ profile: TikTok = @ten; Douyin = đoạn cuối URL (được thay bằng handle thật khi resolve xong). */
function shellHandle(norm: { platform: "tiktok" | "douyin"; ref: string }): string {
  if (norm.platform === "tiktok") return norm.ref;
  try { return new URL(norm.ref).pathname.split("/").filter(Boolean).pop()?.slice(0, 40) || "douyin"; } catch { return "douyin"; }
}

/** Kiểm URL, tạo vỏ 'picking', trả ngay; phần lấy video chạy nền. URL sai → ném Error (route trả 400). */
export async function startProfileFromUrl(a: { owner: string; url: string; deps: PickDeps }): Promise<{ profileId: string; handle: string }> {
  const url = String(a.url || "").trim();
  const norm = normalizeAccountInput(url);
  if (!norm) throw new Error(INVALID_URL_MSG);
  const handle = shellHandle(norm);
  const p = await createProfileShell({ owner: a.owner, platform: norm.platform, handle, sourceUrl: url });
  void runIntake(p.id, { url, platform: norm.platform, deps: a.deps });
  return { profileId: p.id, handle };
}

/** Việc nền (export để test await trực tiếp). Không bao giờ ném — mọi lỗi ghi vào profile. */
export async function runIntake(profileId: string, a: { url: string; platform: "tiktok" | "douyin"; deps: PickDeps }): Promise<void> {
  try {
    const key = a.deps.rapidKey(a.platform);
    if (!key) throw new Error("Chưa cấu hình RapidAPI key (TOKAPI_RAPIDAPI_KEY).");
    let account: Account;
    try { account = await a.deps.resolveAccount(a.url, key); } catch (e: any) { throw new Error(`Không resolve được kênh: ${e?.message || e}`); }
    const all = await a.deps.fetchAccountVideos(account, { count: 100, key });
    if (!all.length) throw new Error("Kênh không có video công khai (riêng tư hoặc bị chặn).");
    const picked = pickStyleVideos(all, Math.floor(Date.now() / 1000));
    if (picked.videos.length < STYLE.minVideos) throw new Error(`Kênh chỉ có ${picked.videos.length} video đủ điều kiện (cần ≥ ${STYLE.minVideos}).`);
    await fillProfileVideos(profileId, { nickname: String(account.nickname || account.handle || ""), avatar: String(account.avatar || ""), handle: String(account.handle || ""), videos: picked.videos, exemplarIds: picked.exemplarIds });
  } catch (e: any) {
    console.error(`[style] intake lỗi ${profileId}:`, e?.message || e);
    try { await updateProfile(profileId, { status: "failed", message: String(e?.message || "Lỗi khi lấy video kênh.") }); } catch (e2) { console.error("[style] intake ghi lỗi:", e2); }
  }
}
