// Dịch bổ sung tên + mô tả cho phim chưa có bản dịch nào.
//   node scripts/backfill-meta.js [--dry]
// Phim cũ nhập trước khi có tính năng dịch: tên đã là tiếng Việt nên chưa từng đi qua bước
// dịch, người xem Thái/Indo/Anh vẫn thấy tên tiếng Việt.
require("dotenv").config();
const mongoose = require("mongoose");
const MovieSeries = require("../models/movieSeries.model");
const Setting = require("../models/setting.model");
const { translateSeriesMeta } = require("../util/translateMeta");

const DRY = process.argv.includes("--dry");
const CONCURRENCY = 3;

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

(async () => {
  await mongoose.connect(process.env.MongoDb_Connection_String);
  const sub = ((await Setting.findOne({}).select("subtitle").lean()) || {}).subtitle || {};
  const langs = Array.isArray(sub.langs) && sub.langs.length ? sub.langs : ["vi", "en"];
  const cfg = { apiKey: sub.geminiApiKey, model: sub.geminiModel || "gemini-2.5-flash", langs };

  const all = await MovieSeries.find({}).select("name description nameOriginal descriptionOriginal i18n").lean();
  const todo = all.filter((m) => langs.some((l) => !((m.i18n || {})[l] || {}).name));
  console.log(`${todo.length}/${all.length} phim cần dịch bổ sung (${langs.join(", ")})${DRY ? " — chế độ thử" : ""}\n`);

  let ok = 0, fail = 0;
  await mapLimit(todo, CONCURRENCY, async (m) => {
    const src = { name: m.nameOriginal || m.name, description: m.descriptionOriginal || m.description || "" };
    const meta = await translateSeriesMeta(src, cfg);
    const got = Object.keys(meta.i18n || {});
    if (!got.length) { fail++; console.log(`  ✗ ${m.name.slice(0, 34)} — ${meta.error}`); return; }
    ok++;
    if (!DRY) {
      const set = { i18n: { ...(m.i18n || {}), ...meta.i18n }, metaMissingLangs: meta.missing || [], metaTranslatedAt: new Date() };
      const en = meta.i18n.en;
      if (en && en.name) { set.nameEn = en.name; set.descriptionEn = en.description || ""; }
      // KHÔNG đụng name/description: phim cũ đang có tên tiếng Việt do người đặt, giữ nguyên.
      await MovieSeries.updateOne({ _id: m._id }, { $set: set });
    }
    console.log(`  ✓ ${m.name.slice(0, 30).padEnd(31)} ${got.map((l) => `${l}: ${meta.i18n[l].name.slice(0, 18)}`).join(" | ")}`);
  });

  console.log(`\nXong: ${ok} phim dịch được, ${fail} phim hụt`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
