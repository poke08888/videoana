const fs = require("fs");
const os = require("os");
const path = require("path");
const { transcribeAudio } = require("./asr");
const { ocrSubtitles } = require("./asrOcr");
const { translateSegments } = require("./translate");
const { probeDimensions, buildAss } = require("./subtitle");
const { transcodeToH264, transcodeBurnSub, transcodeCleanBox } = require("./transcode");

// Lọc rác OCR: bỏ đoạn không có ký tự Hán hoặc chỉ 1 ký tự lẻ (đọc nhầm hiệu ứng/logo).
function cleanOcrSegs(segs) {
  return (segs || []).filter(
    (s) => s && s.text && /[一-鿿]/.test(s.text) && s.text.replace(/\s/g, "").length >= 2,
  );
}

/**
 * Dịch zhSegs sang ngôn ngữ chính (targetLang) và ngôn ngữ phụ (secondLang) SONG SONG,
 * cả hai đều đi từ TIẾNG TRUNG GỐC (không dịch chuyền vi->en để khỏi tam sao thất bản).
 * Nhánh phụ lỗi thì bỏ qua (tập vẫn lên, chỉ thiếu track en); nhánh chính lỗi thì ném ra
 * cho subtitleVideoBuffer fallback.
 */
async function translateBoth(zhSegs, opts = {}) {
  const {
    apiKey,
    model = "gemini-2.5-flash",
    sourceLang = "zh",
    targetLang = "vi",
    secondLang = "en",
    batchSize = 40,
    translateFn = translateSegments,
  } = opts;
  const base = { apiKey, model, sourceLang, batchSize };
  const [viSegs, enSegs] = await Promise.all([
    translateFn(zhSegs, { ...base, targetLang }),
    secondLang
      ? translateFn(zhSegs, { ...base, targetLang: secondLang }).catch((e) => {
          console.error(`[autosub] dịch ${secondLang} lỗi, bỏ track phụ:`, e.message);
          return [];
        })
      : Promise.resolve([]),
  ]);
  return { viSegs, enSegs };
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
    secondLang = "en",
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

    const { viSegs, enSegs } = await translateBoth(zhSegs, {
      apiKey,
      model: geminiModel,
      sourceLang,
      targetLang,
      secondLang: mode === "soft" ? secondLang : "",
      batchSize: translateBatchSize,
    });

    const boxCfg = {
      yRatio: coverBoxYRatio,
      heightRatio: coverBoxHeightRatio,
      color: coverBoxColor,
      enabled: coverEnabled,
    };

    // soft: video SẠCH (chỉ che sub Trung), phụ đề đi kèm file .vtt rời.
    if (mode === "soft") {
      const clean = await transcodeCleanBox(srcF, boxCfg);
      return { buffer: clean, subbed: true, segments: viSegs.length, viSegs, enSegs, burned: false, reason: "", codec: "h264", transcoded: true };
    }

    buildAss(viSegs, { width: dims.width, height: dims.height, assPath: assF, chineseBottomRatio });
    const out = await transcodeBurnSub(srcF, assF, boxCfg);
    return { buffer: out, subbed: true, segments: viSegs.length, viSegs, enSegs: [], burned: true, reason: "", codec: "h264", transcoded: true };
  } catch (e) {
    // Fallback: vẫn đảm bảo video H.264 xem được (chỉ không có sub Việt).
    // Trả thêm codec/transcoded để caller biết buffer cuối có phát được không (chặn bvc2).
    try {
      const r = await transcodeToH264(buffer);
      return { buffer: r.buffer, subbed: false, segments: 0, enSegs: [], burned: false, reason: e.message, codec: r.codec, transcoded: r.transcoded };
    } catch (e2) {
      return { buffer, subbed: false, segments: 0, enSegs: [], burned: false, reason: `${e.message}; transcode fail: ${e2.message}`, codec: "", transcoded: false };
    }
  } finally {
    cleanup();
  }
}

module.exports = { subtitleVideoBuffer, translateBoth };
