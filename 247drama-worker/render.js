// Lỗi thật của ffmpeg nằm ở CUỐI stderr; đầu stderr là banner phiên bản dài cả trăm ký tự.
// Cắt từ đầu thì log chỉ còn "ffmpeg version ..." và không ai biết vì sao hỏng.
function tailErr(s, n = 600) {
  const t = String(s || "").trim();
  return t.length > n ? "…" + t.slice(-n) : t;
}

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const duanju = require("./util/duanjuProvider");
const { subtitleVideoBuffer } = require("./util/autosub");
const { uploadToR2, uploadAndVerify } = require("./util/r2");
const { segsToVtt } = require("./util/vtt");
const { resolveSubPosition } = require("./util/subPosition");
const { env, buildFilename, buildR2Key, buildVideoUrl, buildSubtitleConfig, buildSubKey, buildSubUrl } = require("./config");
const { ShortVideo, MovieSeries } = require("./db");
const status = require("./status");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(tailErr(stderr || err.message)));
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

// Timeout cứng mỗi tập: 1 tập bình thường ~90-140s khi máy rảnh. Quá EP_TIMEOUT_MIN thì bỏ,
// giải phóng slot, tránh Promise.all treo cả run.
//
// CẢNH BÁO khi chỉnh: mốc này tính CẢ THỜI GIAN CHỜ, không chỉ lúc đang làm. Chạy nhiều luồng
// thì OCR tranh CPU và mỗi tập chậm đi gấp mấy lần — đã đo: 6 luồng khiến 16/23 tập vượt mốc
// 8 phút trong khi tunnel vẫn tải 4 MB/s, tức là "treo" ở CPU chứ không phải ở mạng. Đặt mốc
// rộng tay hơn số luồng đang chạy, hoặc giảm luồng.
const EP_TIMEOUT_MS = Math.max(1, parseInt(process.env.EP_TIMEOUT_MIN) || 15) * 60 * 1000;

async function renderEpisode(args) {
  const tag = `${args.provider}:${args.sourceId} ep${args.ep.index + 1}`;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`quá ${EP_TIMEOUT_MS / 60000} phút (máy quá tải, hoặc tải/OCR treo)`)),
      EP_TIMEOUT_MS,
    );
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

async function renderEpisodeInner({ series, provider, sourceId, ep, fromUrl }) {
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
    // fromUrl = bản đã nằm sẵn trên R2 của mình. Dùng khi SỬA tập hỏng: nguồn có thể đã chết
    // (hg hết quota, hg đổi sang codec không giải mã được) nhưng bản mirror vẫn còn nguyên
    // chữ Trung để OCR lại. Đi thẳng CDN của mình, không qua 52api, không tốn quota.
    const resolved = fromUrl ? { mp4Url: fromUrl } : await duanju.resolveVideo(provider, sourceId, ep.videoId);
    if (!resolved.mp4Url) { status.fail(tag); return { ok: false, reason: "không có link" }; }
    // hg thường tải trực tiếp OK, nhưng MỘT SỐ tập trả URL douyinvod bị chặn/reset từ VN
    // ("socket hang up") -> tải trực tiếp fail thì retry QUA PROXY HK (như hm). Timeout ngắn
    // ở lần trực tiếp để fail nhanh sang proxy.
    let buf;
    try {
      buf = await duanju.downloadToBuffer(resolved.mp4Url, { useProxy: !fromUrl && provider === "hm", timeout: 60000, retries: 2 });
    } catch (e1) {
      if (fromUrl) throw e1; // CDN của mình mà tải không được thì đi qua tunnel cũng vậy
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

    // Chế độ soft: dựng sẵn nội dung WebVTT TRƯỚC khi upload bất cứ thứ gì. Video soft đã bị
    // drawbox xoá chữ Trung, nên thiếu track = tập không còn một chữ nào; mà work.js coi
    // "đã có bản ghi" là xong và KHÔNG BAO GIỜ render lại -> phải bỏ tập ngay từ đây để lần
    // chạy sau làm lại, thay vì upsert một tập vĩnh viễn không xem được.
    const softBodies = [];
    if (!r.burned) {
      // subStartOffsetMs do admin sửa tay trong JSON setting: không phải số thì coi như 0,
      // nếu không segsToVtt sinh timestamp NaN mà vẫn ra chuỗi khác rỗng -> file phụ đề hỏng.
      const rawOffset = ((global.settingJSON && global.settingJSON.subtitle) || {}).subStartOffsetMs;
      const offsetSec = (typeof rawOffset === "number" && isFinite(rawOffset) ? rawOffset : 0) / 1000;
      // Vị trí dòng: ngay dưới đáy chữ Trung do OCR đo được, cách một khoảng subGapRatio
      // (~0,3cm). Mỗi phim đặt chữ Hán một độ cao khác nhau nên KHÔNG có hằng số chung:
      // tập đầu đo được sẽ chốt mức cho cả phim, tập sau bám mức đó. Không có số nào ->
      // bỏ tập để lần sau làm lại, thay vì đoán bừa rồi đè chữ Việt lên chữ Hán.
      const S = (global.settingJSON && global.settingJSON.subtitle) || {};
      const num = (v, d) => (typeof v === "number" && !isNaN(v) ? v : d);
      const gapRatio = num(S.subGapRatio, 0.012);
      // Mức chữ Hán của phim có thể VỪA được tập khác chốt sau khi object series này được
      // dựng (một pass kéo dài hàng giờ, redo hàng loạt cũng vậy). Đọc lại từ Mongo khi trong
      // tay chưa có số — nếu không, tập nào OCR không tự đo được vẫn bị bỏ dù phim đã chốt
      // mức từ mấy phút trước, và cứ thế rơi mãi.
      let seriesRatio = series.zhBottomRatio;
      let seriesSource = series.zhBottomSource;
      if (!(typeof seriesRatio === "number" && seriesRatio > 0)) {
        const fresh = await MovieSeries.findOne({ _id: series._id })
          .select("zhBottomRatio zhBottomSource")
          .lean()
          .catch(() => null);
        if (fresh) {
          seriesRatio = fresh.zhBottomRatio;
          seriesSource = fresh.zhBottomSource;
        }
      }
      const pos = resolveSubPosition({
        episodeRatio: r.chineseBottomRatio,
        seriesRatio,
        seriesSource,
        gapRatio,
      });
      if (!pos) {
        status.fail(tag);
        const why = "chưa xác định được vị trí chữ Hán (OCR không đo được, phim chưa chốt mức)";
        console.error(`[render] ✗ ${tag}: ${why} -> bỏ tập, lần chạy sau làm lại`);
        return { ok: false, reason: why };
      }
      if (pos.warn) console.warn(`[render] ⚠ ${tag}: ${pos.warn}`);
      const topRatio = pos.topRatio;
      // Chốt mức cho phim ngay khi tập đầu đo được. Điều kiện lọc zhBottomRatio còn trống để
      // 4 tập chạy song song không ghi đè nhau: tập nào xong trước thì tập đó chốt.
      if (pos.pin) {
        await MovieSeries.updateOne(
          { _id: series._id, $or: [{ zhBottomRatio: null }, { zhBottomRatio: { $exists: false } }] },
          { $set: { zhBottomRatio: r.chineseBottomRatio, zhBottomSource: "auto" } }
        ).catch(() => {});
      }
      // Track nào qua được nghi thức nghiệm thu thì có mặt trong r.tracks. Ngôn ngữ chính
      // luôn phải có (autosub ném lỗi nếu hụt); ngôn ngữ phụ hụt thì tập vẫn lên, thiếu track đó.
      const primary = subCfg.targetLang || "vi";
      const entries = Object.entries(r.tracks || {});
      if (!entries.some(([lang]) => lang === primary)) {
        status.fail(tag);
        // Nói luôn vì sao hụt: autosub đã biết lý do (dịch hỏng, track bị nghiệm thu đánh
        // rớt vì còn quá nhiều chữ Hán...) nhưng trước đây bị nuốt mất, log chỉ còn "thiếu
        // bản dịch vi" — nhìn vào không biết phải sửa gì.
        const why = `soft-sub thiếu bản dịch ${primary}${r.reason ? ` (${r.reason})` : ""}`;
        console.error(`[render] ✗ ${tag}: ${why} -> bỏ tập, lần chạy sau render lại`);
        return { ok: false, reason: why };
      }
      for (const [lang, segs] of entries) {
        const body = segsToVtt(segs, { offsetSec, topRatio });
        if (!body) {
          if (lang === primary) {
            status.fail(tag);
            const why = `soft-sub thiếu bản dịch ${lang}`;
            console.error(`[render] ✗ ${tag}: ${why} -> bỏ tập, lần chạy sau render lại`);
            return { ok: false, reason: why };
          }
          console.warn(`[render] ⚠ ${tag}: bỏ track ${lang} (không dựng được .vtt)`);
          continue;
        }
        softBodies.push([lang, body]);
      }
    }

    // 3) ghi output ra BINGNET
    fs.writeFileSync(outPath, buf);

    // 4) upload thẳng R2 (bỏ rsync server)
    status.setPhase(tag, "upload");
    // Xác nhận lại sau khi ghi: upload im lặng không lên (hoặc lên bản cũ) từng làm tập
    // hỏng nằm vĩnh viễn vì Mongo vẫn được upsert như thành công.
    await uploadAndVerify(buf, buildR2Key(provider, sourceId, ep.index), "video/mp4");

    // 4b) Sidecar .vi.json giữ nguyên cho nhánh lồng tiếng (dub đi từ SUB VIỆT).
    if (r.viSegs && r.viSegs.length) {
      try {
        const subKey = buildR2Key(provider, sourceId, ep.index).replace(/\.mp4$/, ".vi.json");
        await uploadToR2(Buffer.from(JSON.stringify(r.viSegs)), subKey, "application/json");
      } catch (e) {}
    }

    // Phiên bản bộ .vtt: lấy số hiện có + 1 để không ghi đè bộ cũ khi render lại.
    const prevDoc = await ShortVideo.findOne({ movieSeries: series._id, episodeNumber: ep.index })
      .select("subVersion")
      .lean();
    const subVersion = ((prevDoc && prevDoc.subVersion) || 0) + 1;

    // 4c) Chế độ soft: up track WebVTT rời (đã dựng và kiểm ở bước trên).
    const subTracks = [];
    for (const [lang, body] of softBodies) {
      try {
        await uploadAndVerify(Buffer.from(body, "utf8"), buildSubKey(provider, sourceId, ep.index, lang, subVersion), "text/vtt; charset=utf-8", {
          // Phụ đề còn sửa nhiều lần (chất lượng dịch, timing). Cache dài + immutable như
          // video sẽ khiến bản hỏng kẹt ở edge Cloudflare và ở máy người xem cả năm.
          cacheControl: "public, max-age=300, must-revalidate",
        });
        subTracks.push({ lang, url: buildSubUrl(provider, sourceId, ep.index, lang, subVersion) });
      } catch (e) {
        status.fail(tag);
        console.error(`[render] ✗ ${tag}: up track ${lang} lỗi:`, e.message);
        return { ok: false, reason: `up track ${lang} lỗi: ${e.message}` };
      }
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
          sourceVideoId: ep.videoId || (prevDoc && prevDoc.sourceVideoId) || "",
          subLang,
          subTracks,
          subVersion: subTracks.length ? subVersion : ((prevDoc && prevDoc.subVersion) || 0),
          burnedLang: r.burned ? subLang : "",
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
