const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    image: { type: String, trim: true, default: "" },
    uniqueId: { type: String, trim: true, unique: true, default: "" },
    // Định nghĩa thể loại, dùng làm chỉ dẫn cho máy xếp phim theo mô tả. Sửa ở đây là đổi
    // cách xếp, không cần deploy lại.
    hint: { type: String, trim: true, default: "" },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = mongoose.model("Category", categorySchema);
