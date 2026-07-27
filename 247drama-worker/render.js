const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const duanju = require("./util/duanjuProvider");
const { subtitleVideoBuffer } = require("./util/autosub");
const { uploadToR2 } = require("./util/r2");
const { env, buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig } = require("./config");
const { ShortVideo } = require("./db");
const status = require("./status");

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

// Timeout cứng mỗi tập: 1 tập bình thường ~90-140s. Nếu quá EP_TIMEOUT_MIN (mặc định 8 phút)
// thì coi như treo (tải hg stall...) -> bỏ, giải phóng slot, tránh Promise.all treo cả run.
const EP_TIMEOUT_MS = Math.max(1, parseInt(process.env.EP_TIMEOUT_MIN) || 8) * 60 * 1000;

async function renderEpisode(args) {
  const tag = `${args.provider}:${args.sourceId} ep${args.ep.index + 1}`;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`quá ${EP_TIMEOUT_MS / 60000} phút (treo, có thể tải stall)`)), EP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([renderEpisodeInner(args), timeout]);
  } catch (e) {
    status.fail(tag);
    console.error(`[render] ✗ ${tag}:`, e.message);
    return { ok: false, reason: e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function renderEpisodeInner({ series, provider, sourceId, ep }) {
  const tag = `${provider}:${sourceId} ep${ep.index + 1}`;
  const movieKey = `${provider}:${sourceId}`;
  const t0 = Date.now();
  const filename = buildFilename(provider, sourceId, ep.index);
  const outPath = path.join(env.outputDir, filename);
  const rawPath = path.join(env.downloadDir, filename);

  // freeLimit đọc TẠI THỜI ĐIỂM CHẠY (sau db.loadSettings, khi global.settingJSON đã có).
  // Tính ở module-load sẽ =1 vì settingJSON chưa nạp -> khoá nhầm tập 1-5.
  const freeLimit = ((global.settingJSON && global.settingJSON.freeEpisodesForNonVip) || 0) + 1; // =6

  try {
    // 1) resolve + tải mp4 gốc (hm qua proxy)
    status.setPhase(tag, "tải");
    const resolved = await duanju.resolveVideo(provider, sourceId, ep.videoId);
    if (!resolved.mp4Url) { status.fail(tag); return { ok: false, reason: "không có link" }; }
    // hg thường tải trực tiếp OK, nhưng MỘT SỐ tập trả URL douyinvod bị chặn/reset từ VN
    // ("socket hang up") -> tải trực tiếp fail thì retry QUA PROXY HK (như hm). Timeout ngắn
    // ở lần trực tiếp để fail nhanh sang proxy.
    let buf;
    try {
      buf = await duanju.downloadToBuffer(resolved.mp4Url, { useProxy: provider === "hm", timeout: 60000, retries: 2 });
    } catch (e1) {
      buf = await duanju.downloadToBuffer(resolved.mp4Url, { useProxy: true, timeout: 120000, retries: 3 });
    }

    if (env.keepOriginal) {
      try { fs.writeFileSync(rawPath, buf); } catch (e) {}
    }

    // 2) OCR sub Trung -> dịch Việt -> burn (file tạm ghi vào TMPDIR=BINGNET/tmp)
    status.setPhase(tag, "sub");
    const subCfg = buildSubtitleConfig(global.settingJSON);
    const r = await subtitleVideoBuffer(buf, subCfg);
    buf = r.buffer;
    // Transcode hỏng hoàn toàn (cả burn LẪN fallback H.264 fail) -> bỏ, không lưu tập đen.
    // Áp dụng cho MỌI provider: nếu chỉ chặn hg thì tập hm hỏng sẽ bị upsert thành record
    // vĩnh viễn không phát được (idempotency coi như "đã xong", không bao giờ thử lại).
    if (!r.subbed && r.codec !== "h264" && !r.transcoded) {
      status.fail(tag);
      return { ok: false, reason: `codec không phát được (${r.codec || "bvc2"})` };
    }
    const subLang = r.subbed ? (subCfg.targetLang || "vi") : "";

    // 3) ghi output ra BINGNET
    fs.writeFileSync(outPath, buf);

    // 4) upload thẳng R2 (bỏ rsync server)
    status.setPhase(tag, "upload");
    await uploadToR2(buf, buildR2Key(provider, sourceId, ep.index), "video/mp4");

    // 4b) Lưu sidecar segment tiếng Việt của SUB (text+timing) để lồng tiếng tái dùng
    // -> dub đi từ SUB VIỆT (không dịch lại từ Trung). 1 bản dịch cho cả sub lẫn dub.
    if (r.viSegs && r.viSegs.length) {
      try {
        const subKey = buildR2Key(provider, sourceId, ep.index).replace(/\.mp4$/, ".vi.json");
        await uploadToR2(Buffer.from(JSON.stringify(r.viSegs)), subKey, "application/json");
      } catch (e) {}
    }

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
    status.done(tag, movieKey, { sub: subLang || "none", segs: r.segments || 0, sec: Math.round((Date.now() - t0) / 1000) });
    console.log(`[render] ✓ ${tag} sub=${subLang || "none"} ${r.segments || 0} câu, ${duration}s`);
    return { ok: true };
  } catch (e) {
    status.fail(tag);
    console.error(`[render] ✗ ${tag}:`, e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { renderEpisode, probeDuration };
