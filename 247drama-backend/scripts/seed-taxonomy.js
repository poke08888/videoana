// Dựng bộ thể loại mới và xếp lại toàn bộ kho phim.
//
// Chạy một lần: node scripts/seed-taxonomy.js [--dry]
//   --dry: chỉ in ra sẽ xếp phim nào vào đâu, KHÔNG ghi gì vào kho.
//
// Thể loại cũ không bị xoá, chỉ tắt hiển thị — sai thì bật lại được.
require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("../models/category.model");
const MovieSeries = require("../models/movieSeries.model");
const Setting = require("../models/setting.model");
const { CATEGORIES, TAGS } = require("../util/taxonomy");
const { classifySeries } = require("../util/classifySeries");
const { generateCategoryUniqueId } = require("../util/generateCategoryUniqueId");

const DRY = process.argv.includes("--dry");
const CONCURRENCY = 3;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

(async () => {
  const uri = process.env.MongoDb_Connection_String;
  if (!uri) throw new Error("thiếu MongoDb_Connection_String");
  await mongoose.connect(uri);

  const s = await Setting.findOne({}).select("subtitle").lean();
  const sub = (s && s.subtitle) || {};
  if (!sub.geminiApiKey) throw new Error("thiếu geminiApiKey trong Setting");

  // 1) Tạo/cập nhật thể loại mới
  const wanted = [];
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    let doc = await Category.findOne({ name: c.name });
    if (!doc && !DRY) {
      doc = await Category.create({ name: c.name, hint: c.hint, sortOrder: i, isActive: true, uniqueId: await generateCategoryUniqueId() });
      console.log(`+ tạo thể loại: ${c.name}`);
    } else if (doc && !DRY) {
      await Category.updateOne({ _id: doc._id }, { $set: { hint: c.hint, sortOrder: i, isActive: true } });
      console.log(`= giữ thể loại có sẵn: ${c.name}`);
    } else {
      console.log(`${doc ? "=" : "+"} ${c.name} (dry)`);
    }
    if (doc) wanted.push({ _id: doc._id, name: c.name, hint: c.hint });
  }

  // 2) Tắt thể loại cũ không nằm trong bộ mới (giữ dữ liệu, chỉ ẩn đi)
  const keepNames = CATEGORIES.map((c) => c.name);
  const olds = await Category.find({ name: { $nin: keepNames } }).select("name").lean();
  if (olds.length && !DRY) {
    await Category.updateMany({ name: { $nin: keepNames } }, { $set: { isActive: false } });
  }
  console.log(`- tắt ${olds.length} thể loại cũ: ${olds.map((o) => o.name).join(", ")}`);

  // 3) Xếp lại toàn bộ phim. Ưu tiên mô tả gốc tiếng Trung (đầy đủ hơn bản dịch rút gọn).
  const films = await MovieSeries.find({}).select("name description nameOriginal descriptionOriginal").lean();
  const cats = wanted.length ? wanted : CATEGORIES;
  let ok = 0, failed = [];
  const results = await mapLimit(films, CONCURRENCY, async (f) => {
    const r = await classifySeries(
      { name: f.nameOriginal || f.name, description: f.descriptionOriginal || f.description },
      { apiKey: sub.geminiApiKey, model: sub.geminiModel || "gemini-2.5-flash", categories: cats, tags: TAGS }
    );
    if (!r.category) { failed.push(`${f.name}: ${r.error}`); return null; }
    ok++;
    const cat = cats.find((c) => c.name === r.category);
    if (!DRY && cat._id) {
      await MovieSeries.updateOne({ _id: f._id }, { $set: { category: cat._id, tags: r.tags } });
    }
    return { name: f.name, category: r.category, tags: r.tags };
  });

  const byCat = {};
  for (const r of results) if (r) (byCat[r.category] ||= []).push(r.name);
  console.log(`\nXếp được ${ok}/${films.length} phim${DRY ? " (dry, chưa ghi)" : ""}`);
  for (const c of CATEGORIES.map((x) => x.name)) {
    const list = byCat[c] || [];
    console.log(`  ${String(list.length).padStart(3)} | ${c}`);
    for (const n of list.slice(0, 3)) console.log(`        · ${n.slice(0, 46)}`);
  }
  if (failed.length) {
    console.log(`\nKHÔNG xếp được ${failed.length} phim:`);
    for (const f of failed) console.log("  " + f);
  }
  const tagCount = {};
  for (const r of results) if (r) for (const t of r.tags) tagCount[t] = (tagCount[t] || 0) + 1;
  const top = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log("\nThẻ dùng nhiều nhất: " + top.map(([t, n]) => `${t} (${n})`).join(", "));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
