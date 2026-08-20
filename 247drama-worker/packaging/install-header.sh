#!/bin/bash
# ============================================================================
#  Bộ cài máy render 247drama (macOS)
#
#  File này TỰ CHỨA mã nguồn: chép sang máy Mac nào cũng cài được.
#
#      bash 247drama-render-installer.sh --env <file .env lấy từ máy chính>
#
#  Không có sẵn .env thì chạy không tham số, bộ cài sẽ hỏi từng giá trị.
#  Cài xong worker chạy nền bằng launchd: bật cùng máy, chết thì tự bật lại.
# ============================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/247drama-worker}"
LABEL="com.nonelab.247drama-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ENV_SRC=""
WORKER_NAME_ARG=""
DRY=0   # --dry: cài đủ mã nguồn + thư viện nhưng KHÔNG bật dịch vụ (để thử máy)

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_SRC="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --name) WORKER_NAME_ARG="${2:-}"; shift 2 ;;
    --dry) DRY=1; shift ;;
    --uninstall)
      launchctl unload "$PLIST" 2>/dev/null || true
      rm -f "$PLIST"
      echo "Đã gỡ dịch vụ. Mã nguồn vẫn ở $INSTALL_DIR (xoá tay nếu muốn)."
      exit 0 ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Tham số lạ: $1"; exit 1 ;;
  esac
done

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { printf "  ✓ %s\n" "$*"; }
die() { printf "\n  ✗ %s\n" "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "Bộ cài này chỉ dành cho macOS."

# ---------------------------------------------------------------- 1. công cụ
say "1/6  Kiểm tra công cụ"
if ! command -v brew >/dev/null 2>&1; then
  die "Chưa có Homebrew. Cài trước bằng lệnh trên trang https://brew.sh rồi chạy lại."
fi
for pkg in ffmpeg node python@3.12; do
  if brew list --versions "$pkg" >/dev/null 2>&1; then
    ok "$pkg đã có"
  else
    echo "  … đang cài $pkg (vài phút)"
    brew install "$pkg" >/dev/null
    ok "$pkg đã cài"
  fi
done
command -v ffmpeg >/dev/null || die "ffmpeg cài xong nhưng không gọi được — kiểm tra PATH."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Cần Node từ 18 trở lên, máy đang dùng $(node -v)."
ok "node $(node -v), ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"

# ------------------------------------------------------------- 2. mã nguồn
say "2/6  Bung mã nguồn vào $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
ARCHIVE_LINE=$(awk '/^__PAYLOAD__$/ {print NR + 1; exit 0; }' "$0")
tail -n "+$ARCHIVE_LINE" "$0" | base64 --decode | tar xzf - -C "$INSTALL_DIR"
ok "đã bung $(find "$INSTALL_DIR" -name '*.js' | wc -l | tr -d ' ') file mã nguồn"

# ------------------------------------------------------------------ 3. .env
say "3/6  Cấu hình"
ENV_FILE="$INSTALL_DIR/.env"
if [ -n "$ENV_SRC" ]; then
  [ -f "$ENV_SRC" ] || die "Không thấy file cấu hình: $ENV_SRC"
  cp "$ENV_SRC" "$ENV_FILE"
  ok "đã chép cấu hình từ $ENV_SRC"
elif [ -f "$ENV_FILE" ]; then
  ok "giữ nguyên cấu hình sẵn có"
else
  echo "  Chưa có cấu hình. Nhập các giá trị lấy từ máy chính (bỏ trống là dừng):"
  read -r -p "  Chuỗi kết nối Mongo: " V_MONGO; [ -n "$V_MONGO" ] || die "thiếu chuỗi Mongo"
  read -r -p "  R2 endpoint: " V_EP
  read -r -p "  R2 access key: " V_AK
  read -r -s -p "  R2 secret: " V_SK; echo
  read -r -p "  R2 bucket [247drama]: " V_BK; V_BK="${V_BK:-247drama}"
  read -r -p "  Tên miền CDN [https://cdn.247tv.app]: " V_CDN; V_CDN="${V_CDN:-https://cdn.247tv.app}"
  read -r -p "  IP máy chủ [103.179.185.196]: " V_SRV; V_SRV="${V_SRV:-103.179.185.196}"
  read -r -s -p "  Mật khẩu máy chủ (để đẩy trạng thái): " V_SRVPW; echo
  read -r -p "  VPS Hong Kong cho nguồn hm (bỏ trống nếu không dùng): " V_HK
  [ -n "$V_HK" ] && { read -r -s -p "  Mật khẩu VPS HK: " V_HKPW; echo; }
  cat > "$ENV_FILE" <<ENVEOF
MongoDb_Connection_String=$V_MONGO
baseURL=http://$V_SRV
R2_ENDPOINT=$V_EP
R2_ACCESS_KEY=$V_AK
R2_SECRET=$V_SK
R2_BUCKET=$V_BK
R2_PUBLIC_BASE=$V_CDN
R2_KEY_PREFIX=videos
SERVER_HOST=$V_SRV
SERVER_USER=root
SERVER_PASSWORD=$V_SRVPW
SERVER_UPLOADS=/var/www/247drama/backend/uploads
HK_HOST=$V_HK
HK_PASSWORD=${V_HKPW:-}
KEEP_ORIGINAL=0
ENVEOF
  chmod 600 "$ENV_FILE"
  ok "đã ghi cấu hình"
fi

# Thư mục làm việc: mặc định trong home, đổi được nếu muốn để trên ổ ngoài.
if ! grep -q '^WORK_DIR=' "$ENV_FILE"; then
  read -r -p "  Thư mục render [$HOME/247drama-render]: " V_WD
  echo "WORK_DIR=${V_WD:-$HOME/247drama-render}" >> "$ENV_FILE"
fi
# Số luồng theo số nhân CPU: mỗi tập ăn khoảng 2 nhân (ffmpeg + OCR).
if ! grep -q '^RENDER_CONCURRENCY=' "$ENV_FILE"; then
  CORES=$(sysctl -n hw.ncpu)
  echo "RENDER_CONCURRENCY=$(( CORES / 2 < 2 ? 2 : CORES / 2 ))" >> "$ENV_FILE"
  echo "OCR_THREADS=2" >> "$ENV_FILE"
fi
# Tên máy hiện trên bảng trạng thái và ghi vào phần nhận việc.
if ! grep -q '^WORKER_NAME=' "$ENV_FILE"; then
  DEF_NAME="${WORKER_NAME_ARG:-$(hostname -s)}"
  echo "WORKER_NAME=$DEF_NAME" >> "$ENV_FILE"
fi
grep -q '^OCR_PYTHON=' "$ENV_FILE" || echo "OCR_PYTHON=$INSTALL_DIR/ocr-venv/bin/python" >> "$ENV_FILE"
ok "máy này tên: $(grep '^WORKER_NAME=' "$ENV_FILE" | cut -d= -f2)"

# ------------------------------------------------------------ 4. thư viện
say "4/6  Cài thư viện"
cd "$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1
ok "thư viện Node"
if [ ! -x "$INSTALL_DIR/ocr-venv/bin/python" ]; then
  "$(brew --prefix python@3.12)/bin/python3.12" -m venv "$INSTALL_DIR/ocr-venv"
  "$INSTALL_DIR/ocr-venv/bin/pip" install --quiet --upgrade pip
  "$INSTALL_DIR/ocr-venv/bin/pip" install --quiet "rapidocr-onnxruntime==1.4.4" "onnxruntime==1.28.0" "opencv-python-headless==5.0.0.93"
fi
ok "bộ OCR tiếng Trung"

# ------------------------------------------------------------ 5. dịch vụ
if [ "$DRY" = "1" ]; then
  say "Đã cài xong phần mã nguồn và thư viện (chế độ thử, chưa bật dịch vụ)"
  echo "  Chạy tay để xem thử : cd $INSTALL_DIR && node worker.js"
  echo "  Bật hẳn dịch vụ     : bash $0 --dir $INSTALL_DIR --env $INSTALL_DIR/.env"
  exit 0
fi

say "5/6  Cài dịch vụ chạy nền"
mkdir -p "$HOME/Library/LaunchAgents" "$INSTALL_DIR/logs"
NODE_BIN="$(command -v node)"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$INSTALL_DIR/worker.js</string></array>
  <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$INSTALL_DIR/logs/worker.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/logs/worker.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict>
</plist>
PLISTEOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
ok "dịch vụ $LABEL đã bật"

# ------------------------------------------------------------ 6. kiểm tra
say "6/6  Kiểm tra"
for i in $(seq 1 20); do
  if grep -q "DAEMON" "$INSTALL_DIR/logs/worker.log" 2>/dev/null; then
    ok "worker đã chạy: $(grep 'DAEMON' "$INSTALL_DIR/logs/worker.log" | tail -1 | cut -c1-90)"
    break
  fi
  [ "$i" = 20 ] && { echo "  ⚠ worker chưa báo cáo sau 20 giây, xem log: $INSTALL_DIR/logs/worker.log"; }
  sleep 1
done

cat <<DONE

Xong. Máy này đã thành một máy render.

  Xem log     : tail -f $INSTALL_DIR/logs/worker.log
  Dừng        : launchctl unload $PLIST
  Chạy lại    : launchctl load $PLIST
  Gỡ dịch vụ  : bash $0 --uninstall

Nhiều máy cùng chạy sẽ tự chia tập cho nhau, không máy nào làm trùng việc của máy khác.
DONE
exit 0
__PAYLOAD__
