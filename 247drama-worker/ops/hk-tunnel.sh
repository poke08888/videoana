#!/usr/bin/env bash
# Mở SOCKS5 127.0.0.1:1080 tới HK VPS để tải video hm (CDN cbread.cn chặn từ VN).
# Chạy nền; nếu đã có tunnel trên 1080 thì bỏ qua.
set -e
if lsof -iTCP:1080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "SOCKS 1080 đã chạy"; exit 0
fi
export SSHPASS='Dinh2510@'
sshpass -e ssh -fN -D 127.0.0.1:1080 \
  -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  root@47.76.79.169
echo "SOCKS 1080 -> HK VPS đã mở"
