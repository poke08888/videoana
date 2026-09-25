#!/usr/bin/env bash
# Deploy Nonelab Studio lên 163.44.193.87 bằng rsync (thư mục server KHÔNG phải git).
# Giữ nguyên trên server: .env, data/ (DB SQLite), node_modules (image tự npm install), uploads.
set -euo pipefail
HOST=${DEPLOY_HOST:-root@163.44.193.87}
DIR=${DEPLOY_DIR:-/var/www/videoana}
cd "$(dirname "$0")/.."
git diff --quiet && git diff --cached --quiet || { echo "Còn thay đổi chưa commit — commit trước rồi deploy."; exit 1; }
echo "== Chuẩn bị thư mục /data + backup DB trên server"
ssh "$HOST" "mkdir -p /data/videoana-studio /data/videoana-style-tmp && cd $DIR && cp data/db.sqlite data/db.sqlite.bak-\$(date +%Y%m%d-%H%M%S) && ls -1 data | grep -c bak"
echo "== rsync mã nguồn"
rsync -az --delete \
  --exclude .git --exclude .superpowers --exclude node_modules --exclude dist --exclude data --exclude .env \
  --exclude 'server/uploads/*' --exclude 'server/db.sqlite*' --exclude chats --exclude project --exclude tsconfig.tsbuildinfo \
  ./ "$HOST:$DIR/"
echo "== docker compose up --build"
ssh "$HOST" "cd $DIR && docker compose up -d --build 2>&1 | tail -3 && sleep 10 && curl -sf localhost:8787/api/health && echo && docker logs --tail 40 videoana-app 2>&1 | grep -E '\[style\]|\[xuong\]|backend chạy|Error' | tail -6"
echo "== Kiểm tên miền"
curl -sf https://video.nonelab.net/api/health && echo
js=$(curl -s https://video.nonelab.net/ | grep -oE '/assets/[^"]+\.js' | head -1)
echo "bundle $js — 'Style kênh' xuất hiện: $(curl -s "https://video.nonelab.net$js" | grep -c 'Style kênh') lần (0 = Cloudflare còn cache bản cũ)"
