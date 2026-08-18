#!/usr/bin/env python3
"""OCR các ảnh khung hình (dải phụ đề) -> phân loại ngôn ngữ sub. In JSON ra stdout.
Dùng: ocr_frames.py <img1.png> <img2.png> ...
Kết quả: {"cn":n, "vi":n, "empty":n, "texts":[...]} — cn=khung có chữ Hán, vi=khung có chữ Latinh."""
import sys, json, os

def has_cn(s):
    return any("一" <= ch <= "鿿" for ch in s)

def latin_count(s):
    return sum(1 for ch in s if ("a" <= ch.lower() <= "z"))

def main():
    imgs = sys.argv[1:]
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    import cv2
    try:
        cv2.setNumThreads(2)
    except Exception:
        pass
    from rapidocr_onnxruntime import RapidOCR
    try:
        engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)
    except TypeError:
        engine = RapidOCR()
    cn = vi = empty = 0
    texts = []
    for p in imgs:
        if not os.path.exists(p):
            continue
        img = cv2.imread(p)
        if img is None:
            continue
        res, _ = engine(img)
        items = [r for r in (res or []) if float(r[2]) >= 0.5]
        text = "".join(r[1] for r in items).strip()
        if not text:
            empty += 1
        elif has_cn(text):
            cn += 1
        elif latin_count(text) >= 3:
            vi += 1
        else:
            empty += 1
        texts.append(text[:60])
    print(json.dumps({"cn": cn, "vi": vi, "empty": empty, "texts": texts}, ensure_ascii=False))

if __name__ == "__main__":
    main()
