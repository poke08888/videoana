#!/usr/bin/env python3
"""OCR nhiều nhóm khung hình theo manifest -> phân loại sub từng base. In JSON ra stdout.
Manifest (argv[1]) = JSON {"<base>": ["f0.png","f1.png",...], ...}
Ra: {"<base>": {"cn":n,"vi":n,"empty":n,"texts":[...]}, ...}. Load model 1 lần cho cả mẻ."""
import sys, json, os

def has_cn(s):
    return any("一" <= ch <= "鿿" for ch in s)

def latin_count(s):
    return sum(1 for ch in s if ("a" <= ch.lower() <= "z"))

def main():
    manifest = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    os.environ.setdefault("OMP_NUM_THREADS", "3")
    import cv2
    try:
        cv2.setNumThreads(3)
    except Exception:
        pass
    from rapidocr_onnxruntime import RapidOCR
    try:
        engine = RapidOCR(intra_op_num_threads=3, inter_op_num_threads=3)
    except TypeError:
        engine = RapidOCR()

    out = {}
    total = len(manifest)
    for gi, (base, files) in enumerate(manifest.items()):
        cn = vi = empty = 0
        texts = []
        for p in files:
            if not os.path.exists(p):
                continue
            img = cv2.imread(p)
            if img is None:
                continue
            res, _ = engine(img)
            items = [r for r in (res or []) if float(r[2]) >= 0.5]
            text = "".join(r[1] for r in items).strip()
            # ĐẾM ĐỘC LẬP: 1 dòng "中文Việt" vừa có Hán vừa có Latinh -> tính CẢ vi. has_cn
            # KHÔNG được che vi (lỗi cũ: ưu tiên cn -> vietsub dính chữ Trung bị bỏ sót).
            has_lat = latin_count(text) >= 3
            has_cjk = has_cn(text)
            if not text:
                empty += 1
            else:
                if has_lat:
                    vi += 1        # có chữ Việt (kể cả lẫn chữ Trung)
                elif has_cjk:
                    cn += 1        # chỉ có chữ Trung, không có Việt
                else:
                    empty += 1
            texts.append(text[:50])
        out[base] = {"cn": cn, "vi": vi, "empty": empty, "texts": texts}
        sys.stderr.write("OCR %d/%d %s cn=%d vi=%d\n" % (gi + 1, total, base, cn, vi))
        sys.stderr.flush()
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
