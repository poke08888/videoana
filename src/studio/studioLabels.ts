/** src/studio/studioLabels.ts — bảng tra enum tiếng Anh (DB) → nhãn tiếng Việt (UI). Nơi DUY NHẤT dịch. */
export const PURPOSE_LABEL: Record<string, string> = { hook: "Hook", packaging: "Bao bì", product: "Sản phẩm", label: "Nhãn", interaction: "Tương tác", cta: "Kêu gọi mua" };
export const CAMERA_LABEL: Record<string, string> = { wide: "Góc xa", medium: "Góc trung", close: "Góc cận" };
export const MOTION_LABEL: Record<string, string> = { low: "Biên độ thấp", medium: "Vừa", high: "Mạnh" };
export const STAGE_LABEL: Record<string, string> = { script: "Kịch bản", keyframe: "Đang dựng ảnh", review: "Chờ duyệt ảnh", clip: "Đang render clip", assemble: "Đang ghép", done: "Hoàn tất", failed: "Lỗi" };
export const STATUS_LABEL: Record<string, string> = { idle: "—", pending: "Chờ", processing: "Đang chạy", done: "Xong", failed: "Lỗi" };
export const TRANSITION_LABEL: Record<string, string> = { none: "Cắt thẳng", fade: "Fade", dissolve: "Dissolve", wipeleft: "Wipe trái", slideleft: "Slide trái", zoomin: "Zoom" };
export const INDUSTRIES = [["food", "Đồ ăn vặt / F&B"], ["beauty", "Mỹ phẩm"], ["home", "Gia dụng"], ["fashion", "Thời trang"], ["mom_baby", "Mẹ & bé"], ["other", "Khác"]] as const;
export const TIER_LABEL: Record<string, string> = { draft: "Nháp (rẻ)", final: "Chốt (đẹp)" };
export const vnd = (usd: number) => `${Math.round((usd * 26000) / 1000) * 1000}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " đ";
