#!/usr/bin/env bash
# Tunnel SOCKS 127.0.0.1:1080 -> VPS Hong Kong, chạy Ở TIỀN CẢNH để launchd giám sát.
# Không dùng mật khẩu: đăng nhập bằng khoá riêng ~/.ssh/id_hk_tunnel (cài bằng ssh-copy-id).
# launchd (com.nonelab.hk-tunnel) tự chạy lại mỗi khi tiến trình này chết.
set -e
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
: "${HK_HOST:?HK_HOST chưa có trong .env}"

exec /usr/bin/ssh -N -D 127.0.0.1:1080 \
  -i "$HOME/.ssh/id_hk_tunnel" \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  "root@${HK_HOST}"
