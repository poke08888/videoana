#!/usr/bin/env bash
# Bảo đảm SOCKS5 127.0.0.1:1080 (tải video hm — CDN cbread.cn chặn từ VN) đang sống.
# Worker gọi script này mỗi vòng quét khi thấy cổng 1080 đóng.
#
# Tunnel do launchd giữ (com.nonelab.hk-tunnel, xem ops/hk-tunnel-daemon.sh). Ở đây chỉ đá
# cho nó chạy lại, KHÔNG tự mở ssh song song — hai tiến trình cùng giành cổng 1080 thì cái
# thứ hai chết ngay và log đầy lỗi khó hiểu.
set -e
LABEL="com.nonelab.hk-tunnel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if lsof -iTCP:1080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "SOCKS 1080 đã chạy"; exit 0
fi

if [ -f "$PLIST" ]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || true
  for i in $(seq 1 10); do
    lsof -iTCP:1080 -sTCP:LISTEN >/dev/null 2>&1 && { echo "SOCKS 1080 -> launchd đã bật lại"; exit 0; }
    sleep 1
  done
  echo "launchd chưa dựng được tunnel, xem ops/hk-tunnel.log" >&2
  exit 1
fi

# Không có LaunchAgent (máy khác): mở tay bằng khoá riêng, hết đường mới dùng mật khẩu.
set -a; . "$(dirname "$0")/../.env"; set +a
: "${HK_HOST:?HK_HOST chưa có trong .env}"
if [ -f "$HOME/.ssh/id_hk_tunnel" ]; then
  ssh -fN -D 127.0.0.1:1080 -i "$HOME/.ssh/id_hk_tunnel" -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes "root@${HK_HOST}"
else
  : "${HK_PASSWORD:?HK_PASSWORD chưa có trong .env}"
  export SSHPASS="$HK_PASSWORD"
  sshpass -e ssh -fN -D 127.0.0.1:1080 \
    -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes "root@${HK_HOST}"
fi
echo "SOCKS 1080 -> HK VPS đã mở"
