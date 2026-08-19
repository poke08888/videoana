/**
 * server/studio/errors.ts — phân loại lỗi để quyết định thử lại hay dừng.
 * Phân loại "blocked" nhầm thành "network" = đốt tiền chắc chắn vô ích (spec mục 7).
 */
export type StudioErrorKind = "quota" | "blocked" | "network" | "billing" | "other";

export class StudioError extends Error {
  kind: StudioErrorKind;
  constructor(kind: StudioErrorKind, message: string) {
    super(message);
    this.name = "StudioError";
    this.kind = kind;
  }
}

export function classifyError(err: unknown): StudioErrorKind {
  if (err instanceof StudioError) return err.kind;
  const m = String((err as any)?.message || err || "");
  if (/billing|payment|insufficient (funds|credit)|API key not valid|PERMISSION_DENIED|\b401\b|\b403\b|suspended/i.test(m)) return "billing";
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate limit|too many requests|\b503\b|UNAVAILABLE|overloaded|high demand/i.test(m)) return "quota";
  if (/SAFETY|blocked|\bRAI\b|filtered|prohibited|content policy|violat|celebrit/i.test(m)) return "blocked";
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|socket hang up|\b50[0-9]\b|\b5[1-9][0-9]\b/i.test(m)) return "network";
  return "other";
}

/** Độ trễ (ms) trước lần thử lại thứ `attempt` (0-based); null = không thử lại. */
export function retryDelayMs(kind: StudioErrorKind, attempt: number): number | null {
  const table: Record<StudioErrorKind, number[]> = {
    quota: [5000, 15000, 40000, 90000],
    network: [2000, 6000],
    other: [3000],
    blocked: [],
    billing: [],
  };
  return table[kind][attempt] ?? null;
}

export function humanKind(kind: StudioErrorKind): string {
  return {
    quota: "Vượt hạn mức/nhịp gọi — hệ thống sẽ tự thử lại.",
    blocked: "Nội dung bị model từ chối — sửa lại prompt rồi sinh lại.",
    network: "Lỗi mạng hoặc máy chủ model — sẽ thử lại tối đa 2 lần.",
    billing: "Hết tiền hoặc key bị khoá — hàng đợi tạm dừng, cần quản trị xử lý.",
    other: "Lỗi không xác định.",
  }[kind];
}
