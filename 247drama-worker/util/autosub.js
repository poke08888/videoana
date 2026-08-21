const fs = require("fs");
const os = require("os");
const path = require("path");
const { transcribeAudio } = require("./asr");
const { ocrSubtitles } = require("./asrOcr");
const { translateSegments } = require("./translate");
const { checkTrack, langName } = require("./langRules");
const { probeDimensions, buildAss } = require("./subtitle");
const { transcodeToH264, transcodeBurnSub, transcodeCleanBox } = require("./transcode");
const { coverBoxFor } = require("./coverBox");

// Lọc rác OCR: bỏ đoạn không có ký tự Hán hoặc chỉ 1 ký tự lẻ (đọc nhầm hiệu ứng/logo).
function cleanOcrSegs(segs) {
  return (segs || []).filter(
    (s) => s && s.text && /[一-鿿]/.test(s.text) && s.text.replace(/\s/g, "").length >= 2,
  );
}

// Tỉ lệ dòng CÒN chữ Hán trong kết quả "đã dịch". translateSegments giữ nguyên text gốc
// khi một lô dịch hụt, nên key Gemini chết/hết quota sẽ cho ra bản "dịch" y hệt tiếng Trung
// mà không ném lỗi — tập vẫn lên như thành công. Đo lại để chặn.
function hanRatio(segs) {
  const lines = (segs || []).filter((s) => s && s.text && String(s.text).trim());
  if (!lines.length) return 1;
  const han = lines.filter((s) => /[\u4e00-\u9fff]/.test(s.text)).length;
  return han / lines.length;
}

/**
 * Nghi thức nghiệm thu trước khi publish một tập: mỗi track phải ĐỦ dòng và THẬT SỰ đã dịch
 * đúng ngôn ngữ của nó (translateSegments giữ nguyên text gốc cho lô nào hụt, nên chỉ đếm
 * "có kết quả" là không đủ).
 *
 * Ngôn ngữ chính hụt -> cả tập không đạt (thà chậm còn hơn đẩy tập không ai đọc được).
 * Ngôn ngữ phụ hụt -> chỉ bỏ track đó, tập vẫn lên với các ngôn ngữ còn lại.
 */
function acceptTracks({ zhCount, tracks, primary = "vi" }) {
  const all = tracks || {};
  const main = checkTrack(primary, all[primary], zhCount);
  if (!main.ok) return { ok: false, reason: main.reason, accepted: {}, dropped: [] };

  const accepted = { [primary]: all[primary] };
  const dropped = [];
  for (const lang of Object.keys(all)) {
    if (lang === primary) continue;
    const v = checkTrack(lang, all[lang], zhCount);
    if (v.ok) accepted[lang] = all[lang];
    else dropped.push({ lang, reason: v.reason });
  }
  return { ok: true, reason: "", accepted, dropped };
}

/**
 * Dịch zhSegs sang TẤT CẢ ngôn ngữ đích SONG SONG, mỗi ngôn ngữ đều đi từ TIẾNG TRUNG GỐC
 * (không dịch chuyền vi->th để khỏi tam sao thất bản).
 * Ngôn ngữ phụ lỗi -> trả mảng rỗng, để nghiệm thu quyết định. Ngôn ngữ chính lỗi -> ném ra
 * cho subtitleVideoBuffer fallback.
 */
async function translateAll(zhSegs, opts = {}) {
  const {
    apiKey,
    model = "gemini-2.5-flash",
    sourceLang = "zh",
    langs = ["vi"],
    primary = langs[0] || "vi",
    batchSize = 40,
    translateFn = translateSegments,
  } = opts;
  const base = { apiKey, model, sourceLang, batchSize };
  const pairs = await Promise.all(
    langs.map(async (lang) => {
      if (lang === primary) return [lang, await translateFn(zhSegs, { ...base, targetLang: lang })];
      try {
        return [lang, await translateFn(zhSegs, { ...base, targetLang: lang })];
      } catch (e) {
        console.error(`[autosub] dịch ${lang} lỗi:`, e.message);
        return [lang, []];
      }
    })
  );
  return Object.fromEntries(pairs);
}

/**
 * Dịch + nghiệm thu, và dịch LẠI MỘT LẦN cho ngôn ngữ nào hụt. Dịch lại ở đây rẻ vì video đã
 * tải và OCR xong rồi — rẻ hơn nhiều so với bỏ cả tập rồi làm lại từ đầu ở vòng sau.
 */
async function translateTracks(zhSegs, opts = {}) {
  const { langs = ["vi"], primary = langs[0] || "vi", translateFn = translateSegments } = opts;
  const tracks = await translateAll(zhSegs, opts);
  const verdict = acceptTracks({ zhCount: zhSegs.length, tracks, primary });
  if (!verdict.ok) return verdict;

  const accepted = verdict.accepted;
  const stillDropped = [];
  for (const d of verdict.dropped) {
    console.warn(`[autosub] ${d.reason} -> dịch lại ${langName(d.lang)} một lần`);
    let segs = [];
    try {
      segs = await translateFn(zhSegs, {
        apiKey: opts.apiKey,
        model: opts.model,
        sourceLang: opts.sourceLang || "zh",
        batchSize: opts.batchSize,
        targetLang: d.lang,
      });
    } catch (e) {
      console.error(`[autosub] dịch lại ${d.lang} lỗi:`, e.message);
    }
    const v = checkTrack(d.lang, segs, zhSegs.length);
    if (v.ok) accepted[d.lang] = segs;
    else stillDropped.push({ lang: d.lang, reason: v.reason });
  }
  return { ok: true, reason: "", accepted, dropped: stillDropped };
}

/**
 * Nhận buffer video (tiếng Trung, sub Trung cháy đáy) -> trả buffer video H.264
 * đã che sub Trung + phụ đề tiếng Việt burn cứng.
 * Bất kỳ bước nào lỗi -> fallback transcodeToH264 (video vẫn xem được, chỉ còn sub Trung).
 * Trả về { buffer, subbed, segments, reason }.
 */
async function subtitleVideoBuffer(buffer, cfg = {}) {
  const {
    apiKey,
    geminiModel = "gemini-2.5-flash",
    whisperModel = "medium",
    whisperCpuThreads = 4,
    sourceLang = "zh",
    targetLang = "vi",
    translateBatchSize = 40,
    coverBoxYRatio = 0.66,
    coverBoxHeightRatio = 0.17,
    coverBoxColor = "white@1",
    coverEnabled = true,
    mode = "burn",
    // Danh sách ngôn ngữ phụ đề rời. Phần tử đầu là ngôn ngữ chính (cũng là ngôn ngữ đem burn
    // ở chế độ burn). Chế độ burn chỉ cần ngôn ngữ chính.
    langs = ["vi", "en"],
  } = cfg;

  const id = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const srcF = path.join(os.tmpdir(), `as_src_${id}.mp4`);
  const assF = path.join(os.tmpdir(), `as_sub_${id}.ass`);
  const cleanup = () => {
    for (const f of [srcF, assF]) {
      try { fs.unlinkSync(f); } catch (x) {}
    }
  };

  try {
    fs.writeFileSync(srcF, buffer);

    if (!apiKey) throw new Error("chưa cấu hình Gemini key -> bỏ dịch");

    const dims = await probeDimensions(srcF);

    // Nguồn phụ đề: "ocr" (mặc định) đọc CHỮ TRUNG cháy sẵn -> timing + nội dung chuẩn theo sub gốc;
    // "whisper" nghe audio (cũ). Đổi qua settingJSON.subtitle.subtitleSource.
    const source = ((global.settingJSON && global.settingJSON.subtitle) || {}).subtitleSource || "ocr";
    let zhSegs, chineseBottomRatio;
    if (source === "whisper") {
      zhSegs = await transcribeAudio(srcF, { model: whisperModel, lang: sourceLang, cpuThreads: whisperCpuThreads });
      if (!zhSegs.length) throw new Error("ASR không ra thoại nào");
    } else {
      const ocr = await ocrSubtitles(srcF);
      zhSegs = cleanOcrSegs(ocr.segments);
      chineseBottomRatio = ocr.chineseBottomRatio; // vị trí đáy sub Trung -> canh tiếng Việt ngay dưới
      if (!zhSegs.length) throw new Error("OCR không đọc được phụ đề nào");
    }

    const wantLangs = mode === "soft" ? langs : [targetLang];
    const verdict = await translateTracks(zhSegs, {
      apiKey,
      model: geminiModel,
      sourceLang,
      langs: wantLangs,
      primary: targetLang,
      batchSize: translateBatchSize,
    });
    if (!verdict.ok) throw new Error(verdict.reason);
    const tracks = verdict.accepted;
    const viSegs = tracks[targetLang];
    if (verdict.dropped.length) {
      console.warn(`[autosub] bỏ track: ${verdict.dropped.map((d) => d.lang).join(", ")}`);
    }

    // Ô che chữ Hán bám theo đáy chữ vừa đo được. Ô cố định 0,66-0,83 chỉ đúng với phim đặt
    // chữ ở ~0,72; phim đặt thấp hơn thì ô trượt bên trên, chữ Trung còn nguyên dưới phụ đề mới.
    const boxCfg = coverBoxFor({
      bottomRatio: chineseBottomRatio,
      base: {
        yRatio: coverBoxYRatio,
        heightRatio: coverBoxHeightRatio,
        color: coverBoxColor,
        enabled: coverEnabled,
      },
    });

    // soft: video SẠCH (chỉ che sub Trung), phụ đề đi kèm file .vtt rời.
    if (mode === "soft") {
      const clean = await transcodeCleanBox(srcF, boxCfg);
      // chineseBottomRatio đi kèm để render.js canh track .vtt ngay dưới chữ Trung,
      // đúng quy tắc mà buildAss dùng cho đường burn.
      return { buffer: clean, subbed: true, segments: viSegs.length, viSegs, tracks, chineseBottomRatio, burned: false, reason: "", codec: "h264", transcoded: true };
    }

    buildAss(viSegs, { width: dims.width, height: dims.height, assPath: assF, chineseBottomRatio });
    const out = await transcodeBurnSub(srcF, assF, boxCfg);
    return { buffer: out, subbed: true, segments: viSegs.length, viSegs, tracks: { [targetLang]: viSegs }, burned: true, reason: "", codec: "h264", transcoded: true };
  } catch (e) {
    // Fallback: vẫn đảm bảo video H.264 xem được (chỉ không có sub Việt).
    // Trả thêm codec/transcoded để caller biết buffer cuối có phát được không (chặn bvc2).
    try {
      const r = await transcodeToH264(buffer);
      return { buffer: r.buffer, subbed: false, segments: 0, tracks: {}, burned: false, reason: e.message, codec: r.codec, transcoded: r.transcoded };
    } catch (e2) {
      return { buffer, subbed: false, segments: 0, tracks: {}, burned: false, reason: `${e.message}; transcode fail: ${e2.message}`, codec: "", transcoded: false };
    }
  } finally {
    cleanup();
  }
}

module.exports = { subtitleVideoBuffer, translateAll, translateTracks, hanRatio, acceptTracks };
