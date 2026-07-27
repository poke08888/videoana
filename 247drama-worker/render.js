const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const duanju = require("./util/duanjuProvider");
const { subtitleVideoBuffer } = require("./util/autosub");
const { env, buildFilename, buildVideoUrl, buildSubtitleConfig } = require("./config");
const { ShortVideo } = require("./db");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 400)));
      resolve(stdout);
    });
  });
}

// duration (giây) từ file đã render bằng ffprobe.
async function probeDuration(file) {
  try {
    const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]);
    const d = parseFloat(String(out).trim());
    return Number.isFinite(d) ? Math.round(d) : 0;
  } catch (e) {
    return 0;
  }
}

// rsync 1 file lên /uploads server (đúng thứ tự: up xong mới ghi Mongo).
async function rsyncToServer(localFile, filename) {
  const { host, user, password, uploadsPath } = env.server;
  const rsh = `sshpass -p ${JSON.stringify(password)} ssh -o StrictHostKeyChecking=accept-new`;
  // --chmod=F644: ép file world-readable (rsync -a giữ mode 700 của Mac -> nginx www-data không đọc được -> 403).
  await run("rsync", ["-a", "--chmod=F644", "-e", rsh, localFile, `${user}@${host}:${uploadsPath}/${filename}`], {
    timeout: 5 * 60 * 1000,
  });
}

async function renderEpisode({ series, provider, sourceId, ep }) {
  const tag = `${provider}:${sourceId} ep${ep.index + 1}`;
  const filename = buildFilename(provider, sourceId, ep.index);
  const outPath = path.join(env.outputDir, filename);
  const rawPath = path.join(env.downloadDir, filename);

  // freeLimit đọc TẠI THỜI ĐIỂM CHẠY (sau db.loadSettings, khi global.settingJSON đã có).
  // Tính ở module-load sẽ =1 vì settingJSON chưa nạp -> khoá nhầm tập 1-5.
  const freeLimit = ((global.settingJSON && global.settingJSON.freeEpisodesForNonVip) || 0) + 1; // =6

  try {
    // 1) resolve + tải mp4 gốc (hm qua proxy)
    const resolved = await duanju.resolveVideo(provider, sourceId, ep.videoId);
    if (!resolved.mp4Url) return { ok: false, reason: "không có link" };
    let buf = await duanju.downloadToBuffer(resolved.mp4Url, { useProxy: provider === "hm" });

    if (env.keepOriginal) {
      try { fs.writeFileSync(rawPath, buf); } catch (e) {}
    }

    // 2) OCR sub Trung -> dịch Việt -> burn (file tạm ghi vào TMPDIR=BINGNET/tmp)
    const subCfg = buildSubtitleConfig(global.settingJSON);
    const r = await subtitleVideoBuffer(buf, subCfg);
    buf = r.buffer;
    // Transcode hỏng hoàn toàn (cả burn LẪN fallback H.264 fail) -> bỏ, không lưu tập đen.
    // Áp dụng cho MỌI provider: nếu chỉ chặn hg thì tập hm hỏng sẽ bị upsert thành record
    // vĩnh viễn không phát được (idempotency coi như "đã xong", không bao giờ thử lại).
    if (!r.subbed && r.codec !== "h264" && !r.transcoded) {
      return { ok: false, reason: `codec không phát được (${r.codec || "bvc2"})` };
    }
    const subLang = r.subbed ? (subCfg.targetLang || "vi") : "";

    // 3) ghi output ra BINGNET
    fs.writeFileSync(outPath, buf);

    // 4) rsync lên server TRƯỚC
    await rsyncToServer(outPath, filename);

    // 5) duration + 6) upsert Mongo (khớp process52apiEpisodes)
    const duration = await probeDuration(outPath);
    const videoUrl = buildVideoUrl(provider, sourceId, ep.index);
    await ShortVideo.updateOne(
      { movieSeries: series._id, episodeNumber: ep.index },
      {
        $set: {
          videoImage: series.thumbnail || "",
          videoUrl,
          duration,
          coin: ep.index < freeLimit ? 0 : 10,
          isLocked: ep.index >= freeLimit,
          sourceProvider: `52api-${provider}`,
          sourceVideoId: ep.videoId,
          subLang,
        },
      },
      { upsert: true },
    );

    // Output đã nằm trên server -> xoá bản trên BINGNET để không tích 2 bản mọi tập.
    // Raw download giữ lại làm backup nếu keepOriginal (mặc định), ngược lại xoá luôn.
    try { fs.unlinkSync(outPath); } catch (e) {}
    if (!env.keepOriginal) { try { fs.unlinkSync(rawPath); } catch (e) {} }
    console.log(`[render] ✓ ${tag} sub=${subLang || "none"} ${r.segments || 0} câu, ${duration}s`);
    return { ok: true };
  } catch (e) {
    console.error(`[render] ✗ ${tag}:`, e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { renderEpisode, probeDuration };
