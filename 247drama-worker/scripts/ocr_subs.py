#!/usr/bin/env python3
"""OCR phụ đề tiếng Trung cháy sẵn -> JSON [{start,end,text}] ra stdout.
Quét video, OCR dải phụ đề, gom khung liền nhau cùng câu -> timing chính xác theo sub.
Dùng: ocr_subs.py <video> [fps=4] [y0=0.60] [y1=0.80] [min_conf=0.6]
Log/tiến trình -> stderr."""
import sys, json, cv2, difflib
from collections import Counter


def main():
    video = sys.argv[1]
    fps_sample = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
    y0 = float(sys.argv[3]) if len(sys.argv) > 3 else 0.60
    y1 = float(sys.argv[4]) if len(sys.argv) > 4 else 0.80
    min_conf = float(sys.argv[5]) if len(sys.argv) > 5 else 0.6

    import os
    from rapidocr_onnxruntime import RapidOCR
    # Giới hạn luồng/OCR (OCR_THREADS) để chạy song song không tranh CPU. 0 = mặc định (hết nhân).
    _t = 0
    try:
        _t = int(os.environ.get("OCR_THREADS", "0") or 0)
    except ValueError:
        _t = 0
    try:
        engine = RapidOCR(intra_op_num_threads=_t) if _t > 0 else RapidOCR()
    except TypeError:
        engine = RapidOCR()

    cap = cv2.VideoCapture(video)
    vfps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    step = max(1, int(round(vfps / fps_sample)))
    interval = step / vfps

    y0px = int(h * y0)

    def has_cn(s):
        return any("一" <= ch <= "鿿" for ch in s)

    def ocr_text(frame):
        # trả (text, bottom_ratio) — bottom_ratio = đáy thấp nhất của box chữ (tỉ lệ chiều cao full-frame)
        crop = frame[y0px:int(h * y1), 0:w]
        res, _ = engine(crop)
        if not res:
            return "", None
        items = [r for r in res if float(r[2]) >= min_conf]
        if not items:
            return "", None
        def cy(b): return sum(p[1] for p in b) / 4.0
        def cx(b): return sum(p[0] for p in b) / 4.0
        items.sort(key=lambda r: (round(cy(r[0]) / 20), cx(r[0])))
        text = "".join(r[1] for r in items).strip()
        bottom = max((y0px + max(p[1] for p in r[0])) / h for r in items)
        return text, bottom

    def norm(s):
        return "".join(ch for ch in s if not ch.isspace())

    # 1) sample + OCR (đọc tuần tự cho nhanh, chỉ OCR mỗi step khung)
    samples = []
    bottoms = []  # đáy sub Trung để canh vị trí tiếng Việt
    count = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if count % step == 0:
            txt, bottom = ocr_text(frame)
            samples.append((count / vfps, txt))
            if bottom is not None and has_cn(txt):
                bottoms.append(bottom)
        count += 1
    cap.release()
    sys.stderr.write("OCR %d khung mẫu\n" % len(samples))

    # 2) gom khung liền nhau (chữ giống nhau ~) -> segment
    segs = []
    cur = None
    empty_run = 0
    for t, txt in samples:
        n = norm(txt)
        if not n:
            empty_run += 1
            if cur and empty_run >= 2:
                segs.append(cur); cur = None
            continue
        empty_run = 0
        if cur:
            sim = difflib.SequenceMatcher(None, norm(cur["texts"][-1]), n).ratio()
            if sim >= 0.5:
                cur["end"] = t
                cur["texts"].append(txt)
                continue
            segs.append(cur); cur = None
        cur = {"start": t, "end": t, "texts": [txt]}
    if cur:
        segs.append(cur)

    # 3) chốt text (câu xuất hiện nhiều nhất), cộng interval vào end
    out = []
    for s in segs:
        text = Counter(s["texts"]).most_common(1)[0][0]
        start = round(s["start"], 2)
        end = round(s["end"] + interval, 2)
        if end - start < 0.25:
            continue
        out.append({"start": start, "end": end, "text": text})

    # vị trí đáy sub Trung (median cho ổn định) -> canh tiếng Việt ngay dưới
    bottoms.sort()
    chinese_bottom = round(bottoms[len(bottoms) // 2], 4) if bottoms else None
    sys.stdout.write(json.dumps({"segments": out, "chineseBottomRatio": chinese_bottom}, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
