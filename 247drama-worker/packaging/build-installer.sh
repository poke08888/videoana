#!/bin/bash
# Gói mã nguồn worker + phần đầu cài đặt thành MỘT file chạy được.
#
#   bash packaging/build-installer.sh
#   -> dist/247drama-render-installer.sh
#
# File kết quả không chứa mật khẩu: .env bị loại, người cài tự đưa vào.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$PWD"
OUT_DIR="$SRC/dist"
OUT="$OUT_DIR/247drama-render-installer.sh"
mkdir -p "$OUT_DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Loại mọi thứ nặng hoặc bí mật: thư viện cài lại được, ổ làm việc và log là của riêng máy.
tar czf "$TMP/payload.tgz" \
  --exclude="node_modules" \
  --exclude="ocr-venv" \
  --exclude=".env" \
  --exclude=".env.*" \
  --exclude="dist" \
  --exclude="logs" \
  --exclude="*.log" \
  --exclude=".DS_Store" \
  -C "$SRC" .

cat packaging/install-header.sh > "$OUT"
base64 < "$TMP/payload.tgz" >> "$OUT"
chmod +x "$OUT"

# Tự kiểm: bung lại đúng cái vừa gói và soi vài file sống còn.
CHECK="$(mktemp -d)"
LINE=$(awk '/^__PAYLOAD__$/ {print NR + 1; exit 0; }' "$OUT")
tail -n "+$LINE" "$OUT" | base64 --decode | tar xzf - -C "$CHECK"
for f in worker.js render.js work.js config.js package.json util/claims.js util/cover.js scripts/ocr_subs.py ops/hk-tunnel-daemon.sh; do
  [ -f "$CHECK/$f" ] || { echo "THIẾU $f trong gói"; rm -rf "$CHECK"; exit 1; }
done
grep -q "MongoDb_Connection_String=" "$CHECK/.env" 2>/dev/null && { echo "GÓI CÓ LỌT .env — dừng"; rm -rf "$CHECK"; exit 1; }
node --check "$CHECK/worker.js"
N=$(find "$CHECK" -type f | wc -l | tr -d ' ')
rm -rf "$CHECK"

echo "Đã tạo: $OUT"
echo "  $N file, $(du -h "$OUT" | cut -f1)"
echo "  cài trên máy khác: bash 247drama-render-installer.sh --env <file .env>"
