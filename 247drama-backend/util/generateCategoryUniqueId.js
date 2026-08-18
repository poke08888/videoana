const Category = require("../models/category.model");

async function generateCategoryUniqueId() {
  let uniqueId;
  let exists = true;

  while (exists) {
    uniqueId = `#CAT${Math.floor(100000 + Math.random() * 900000)}`;

    const existingCategory = await Category.findOne({ uniqueId });
    exists = !!existingCategory; //If it exists, generate a new ID
  }

  return uniqueId;
}

module.exports = { generateCategoryUniqueId };
