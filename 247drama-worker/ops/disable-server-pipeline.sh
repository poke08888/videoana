#!/usr/bin/env bash
# Tắt hẳn pipeline tải/OCR trên server 247drama để Mac làm worker duy nhất.
#
# LƯU Ý: KHÔNG dùng importConcurrency=0 để tắt — getImportConcurrency() làm
# `Math.max(1, Math.min(5, n || 1))`, nên n=0 (falsy) -> vẫn = 1 luồng. Cách
# thật sự tắt (không sửa code, không đụng setting dùng chung với Mac): chặn
# DNS tới 52api NGAY TRÊN SERVER qua /etc/hosts -> mọi request detail/video
# của server fail nhanh -> process52apiEpisodes bỏ qua, không OCR. Máy Mac ở
# mạng khác nên vẫn gọi 52api bình thường.
#
# ĐẢO NGƯỢC (bật lại server): xoá 2 dòng 52api khỏi /etc/hosts trên server.
set -e
SRV=root@103.179.185.196
export SSHPASS='Ngaymainha@1'
RUN="sshpass -e ssh -o StrictHostKeyChecking=accept-new $SRV"

# 1) Chặn 52api trên server (reversible) — chặn nguồn tải/OCR của server.
$RUN 'grep -q "www.52api.cn" /etc/hosts || printf "127.0.0.1 www.52api.cn\n127.0.0.1 52api.cn\n" >> /etc/hosts; grep 52api /etc/hosts'

# 2) Kill mọi tiến trình import/OCR đang chạy để dừng ngay.
$RUN 'pkill -f reimport_all_hm.js || true; pkill -f ocr_subs.py || true; pkill -f "whisper" || true; pkill -f "ffmpeg .*as_src" || true; echo "killed bg jobs"'

# 3) (tuỳ chọn) đánh dấu ý định trong setting — KHÔNG đủ để tắt nhưng để rõ ràng.
$RUN 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; cd /var/www/247drama/backend && node -e "
require(\"dotenv\").config(); const m=require(\"mongoose\");
(async()=>{ await m.connect(process.env.MongoDb_Connection_String);
  const S=require(\"./models/setting.model\");
  await S.updateOne({},{\$set:{\"chineseDramaApi.importConcurrency\":0}});
  console.log(\"importConcurrency=0 (đánh dấu; DNS block mới là cái tắt thật)\");
  await m.disconnect();
})();
"'

echo "== Đã tắt pipeline server (52api bị chặn trên server; app vẫn stream bình thường) =="
