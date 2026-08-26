#!/usr/bin/env python3
"""
Tạo phụ đề tiếng Việt (.vtt) cho một tập short-drama.

Pipeline:
  mp4 URL --(ffmpeg)--> wav 16k mono --(faster-whisper, zh)--> segments có timestamp
          --(Gemini API, zh->vi)--> dịch --> WebVTT

Cách chạy trực tiếp:
  GEMINI_API_KEY=xxx python3 subtitle.py --url "<chapterUrl>.mp4" --out public/subs/xxx.vi.vtt

Env:
  GEMINI_API_KEY   (bắt buộc để dịch; thiếu thì xuất VTT tiếng Trung gốc)
  GEMINI_MODEL     (mặc định: gemini-2.0-flash)
  WHISPER_MODEL    (mặc định: small; có thể: base/small/medium/large-v3)
"""
import argparse, json, os, sys, tempfile, urllib.request, urllib.error

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")


def log(*a):
    print("[subtitle]", *a, file=sys.stderr, flush=True)


def fmt_ts(t: float) -> str:
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def download_video(src_url: str, dst_path: str):
    """Tải mp4 về file tạm (faster-whisper sẽ tự decode bằng PyAV, không cần ffmpeg CLI)."""
    log("tải video…")
    req = urllib.request.Request(src_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dst_path, "wb") as f:
        f.write(r.read())
    log(f"đã tải {os.path.getsize(dst_path)} bytes")


def transcribe(media_path: str):
    """faster-whisper: nhận dạng tiếng Trung, trả list (start, end, text). PyAV decode nội bộ."""
    from faster_whisper import WhisperModel  # import trễ để lỗi rõ ràng nếu chưa cài
    log(f"whisper: nạp model '{WHISPER_MODEL}' (lần đầu sẽ tải model)…")
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    log("whisper: đang nhận dạng…")
    segments, info = model.transcribe(media_path, language="zh", vad_filter=True)
    out = [(seg.start, seg.end, seg.text.strip()) for seg in segments if seg.text.strip()]
    log(f"whisper: {len(out)} câu ({info.duration:.0f}s audio).")
    return out


def gemini_translate(texts, api_key: str):
    """Dịch batch zh->vi bằng Gemini, giữ nguyên thứ tự."""
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{GEMINI_MODEL}:generateContent?key={api_key}")
    results = []
    CHUNK = 40
    for i in range(0, len(texts), CHUNK):
        chunk = texts[i:i + CHUNK]
        numbered = "\n".join(f"{j+1}. {t}" for j, t in enumerate(chunk))
        prompt = (
            "Bạn là dịch giả phụ đề phim. Dịch các câu thoại tiếng Trung sau sang "
            "tiếng Việt tự nhiên, giữ đúng số dòng và thứ tự. "
            "CHỈ trả về JSON array các chuỗi tiếng Việt, không thêm gì khác.\n\n" + numbered
        )
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "response_mime_type": "application/json"},
        }).encode()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            arr = json.loads(text)
            if len(arr) != len(chunk):
                log(f"cảnh báo: Gemini trả {len(arr)} != {len(chunk)} dòng, dùng theo min")
            for k in range(len(chunk)):
                results.append(arr[k] if k < len(arr) else chunk[k])
        except (urllib.error.URLError, KeyError, json.JSONDecodeError, IndexError) as e:
            log(f"lỗi dịch chunk {i}: {e} -> giữ tiếng Trung")
            results.extend(chunk)
        log(f"dịch: {min(i+CHUNK, len(texts))}/{len(texts)}")
    return results


def write_vtt(segments, translations, out_path: str):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for (start, end, _), vi in zip(segments, translations):
            f.write(f"{fmt_ts(start)} --> {fmt_ts(end)}\n{vi}\n\n")
    log(f"đã ghi {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="chapterUrl (mp4)")
    ap.add_argument("--out", required=True, help="đường dẫn .vtt xuất ra")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        media = os.path.join(tmp, "video.mp4")
        download_video(args.url, media)
        segments = transcribe(media)
        if not segments:
            log("không có thoại nào."); write_vtt([], [], args.out); return

        api_key = os.environ.get("GEMINI_API_KEY")
        if api_key:
            translations = gemini_translate([s[2] for s in segments], api_key)
        else:
            log("THIẾU GEMINI_API_KEY -> xuất tiếng Trung gốc")
            translations = [s[2] for s in segments]

        write_vtt(segments, translations, args.out)
    print(json.dumps({"ok": True, "out": args.out, "count": len(segments)}))


if __name__ == "__main__":
    main()
