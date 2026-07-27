#!/usr/bin/env bash
# Mở SOCKS5 127.0.0.1:1080 tới HK VPS để tải video hm (CDN cbread.cn chặn từ VN).
# Chạy nền; nếu đã có tunnel trên 1080 thì bỏ qua.
# Mật khẩu + host đọc từ .env (gitignored) — KHÔNG hardcode trong file được commit.
set -e
if lsof -iTCP:1080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "SOCKS 1080 đã chạy"; exit 0
fi
set -a; . "$(dirname "$0")/../.env"; set +a
: "${HK_PASSWORD:?HK_PASSWORD chưa có trong .env}"
: "${HK_HOST:?HK_HOST chưa có trong .env}"
export SSHPASS="$HK_PASSWORD"
sshpass -e ssh -fN -D 127.0.0.1:1080 \
  -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  "root@${HK_HOST}"
echo "SOCKS 1080 -> HK VPS đã mở"
