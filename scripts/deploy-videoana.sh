#!/usr/bin/env bash
# Deploy Nonelab Studio lên 163.44.193.87 bằng rsync (thư mục server KHÔNG phải git).
# Giữ nguyên trên server: .env, data/ (DB SQLite), node_modules (image tự npm install), uploads.
# Luôn xem trước (rsync -n) danh sách file sẽ bị XOÁ và phải gõ "yes" (hoặc DEPLOY_YES=1 khi chạy không tương tác).
set -euo pipefail
HOST=${DEPLOY_HOST:-root@163.44.193.87}
DIR=${DEPLOY_DIR:-/var/www/videoana}
BACKUP_DIR=/data/backups/videoana
cd "$(dirname "$0")/.."
git diff --quiet && git diff --cached --quiet || { echo "Còn thay đổi chưa commit — commit trước rồi deploy."; exit 1; }
# File chưa track trong server/ hoặc src/ sẽ bị rsync đẩy lên dù chưa test/commit → chặn.
untracked=$(git status --porcelain --untracked-files=all -- server src | grep '^??' || true)
if [ -n "$untracked" ]; then echo "Có file chưa track trong server/ hoặc src/ (sẽ bị deploy mà chưa test):"; echo "$untracked"; exit 1; fi

# Mọi exclude neo gốc (/...) để không lỡ loại file trùng tên ở thư mục con (vd. src/data/*).
# .env.example phải --include TRƯỚC --exclude='.env*' (rsync lấy luật khớp đầu tiên).
RSYNC_OPTS=(-az --delete
  --include='.env.example' --exclude='.env*'
  --exclude=/data --exclude=/project --exclude=/chats --exclude=/dist --exclude=/node_modules
  --exclude=/.git --exclude=/.superpowers --exclude=/tsconfig.tsbuildinfo
  --exclude='/server/uploads/*' --exclude='/server/db.sqlite*')

echo "== Xem trước rsync (dry-run)"
preview=$(rsync -n -i "${RSYNC_OPTS[@]}" ./ "$HOST:$DIR/")
deleting=$(printf '%s\n' "$preview" | grep '^\*deleting' || true)
echo "$(printf '%s\n' "$preview" | grep -vc '^\*deleting' || true) mục sẽ gửi/cập nhật."
if [ -n "$deleting" ]; then echo "!! Các file sẽ bị XOÁ trên server:"; echo "$deleting"; else echo "Không có file nào bị xoá."; fi
if [ "${DEPLOY_YES:-}" != "1" ]; then
  read -r -p "Tiếp tục deploy? Gõ 'yes' để xác nhận: " ans
  [ "$ans" = "yes" ] || { echo "Huỷ deploy."; exit 1; }
fi

echo "== Chuẩn bị thư mục /data + backup DB trên server ($BACKUP_DIR, giữ 5 bản mới nhất)"
ssh "$HOST" "set -e; mkdir -p /data/videoana-studio /data/videoana-style-tmp $BACKUP_DIR && cp $DIR/data/db.sqlite $BACKUP_DIR/db.sqlite.bak-\$(date +%Y%m%d-%H%M%S) && ls -1t $BACKUP_DIR/db.sqlite.bak-* | tail -n +6 | xargs -r rm -f && ls -1 $BACKUP_DIR | wc -l"
echo "== rsync mã nguồn"
rsync "${RSYNC_OPTS[@]}" ./ "$HOST:$DIR/"
echo "== docker compose up --build"
ssh "$HOST" "cd $DIR && docker compose up -d --build 2>&1 | tail -3 && sleep 10 && curl -sf localhost:8787/api/health && echo && docker logs --tail 40 videoana-app 2>&1 | grep -E '\[style\]|\[xuong\]|backend chạy|Error' | tail -6"
echo "== Kiểm tên miền"
curl -sf https://video.nonelab.net/api/health && echo
js=$(curl -s https://video.nonelab.net/ | grep -oE '/assets/[^"]+\.js' | head -1)
echo "bundle $js — 'Style kênh' xuất hiện: $(curl -s "https://video.nonelab.net$js" | grep -c 'Style kênh') lần (0 = Cloudflare còn cache bản cũ)"
