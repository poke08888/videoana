// Bộ thể loại + thẻ của kho phim ngắn.
//
// Thể loại đặt theo MÓC CÂU khán giả nhận ra ngay ("Cao nhân xuống núi") chứ không theo
// cách phân loại hàn lâm ("Chính kịch"), vì đây là chữ hiện trên màn hình để người ta bấm
// vào. Mỗi thể loại phải đủ phim để lấp một hàng trong app — thà 8 hàng đầy còn hơn 14 hàng
// lèo tèo. hint là định nghĩa dùng cho máy phân loại: viết càng rành mạch, xếp càng ít sai.
//
// Một phim chỉ có MỘT thể loại chính (để biết nó nằm hàng nào), nhưng có NHIỀU thẻ — thẻ mới
// là thứ khán giả lọc theo sở thích ("nữ cường", "ngọt sủng", "trùng sinh").

const CATEGORIES = [
  {
    name: "Cao nhân xuống núi",
    hint: "Nhân vật chính là cao thủ ẩn thế, chiến thần, thần y hoặc ông trùm giấu thân phận, trở về đời thường (xuống núi, ra tù, giải ngũ) và bị coi thường, sau đó lộ dần thực lực để bảo vệ người thân và trừng trị kẻ khinh mình.",
  },
  {
    name: "Trùng sinh báo thù",
    hint: "Nhân vật chính chết hoặc bị phản bội rồi được sống lại, quay về thời điểm trước bi kịch để làm lại và trả thù kẻ đã hại mình. Trọng tâm là báo thù và lật ngược thế cờ, thường là nữ chính.",
  },
  {
    name: "Đổi đời làm giàu",
    hint: "Nhân vật chính từ tay trắng hoặc quay về quá khứ (thập niên 80, 90, 2000) để chớp thời cơ, khởi nghiệp, buôn bán, gây dựng cơ đồ và đổi đời cho gia đình. Trọng tâm là làm ăn và tiền bạc, không phải báo thù.",
  },
  {
    name: "Tu tiên huyền huyễn",
    hint: "Bối cảnh kỳ ảo có tu luyện, tiên ma, yêu quái, pháp thuật, luân hồi chuyển kiếp. Sức mạnh đến từ tu vi và pháp bảo chứ không từ công nghệ.",
  },
  {
    name: "Hệ thống & siêu năng",
    hint: "Nhân vật chính bỗng có một 'hệ thống' giao nhiệm vụ, hoặc năng lực đặc biệt như đọc được suy nghĩ, thấy trước tương lai, quay ngược thời gian, cùng các câu chuyện robot, AI, cơ giáp, khoa học viễn tưởng.",
  },
  {
    name: "Gia đình & luân lý",
    hint: "Xoay quanh mâu thuẫn trong nhà: cha mẹ con cái, dâu rể, anh em tranh gia sản, di chúc, bí mật gia tộc, cha mẹ hy sinh vì con. Kết thúc thường mang bài học đạo lý.",
  },
  {
    name: "Tổng tài ngôn tình",
    hint: "Chuyện tình yêu là trục chính: tổng tài, thiên kim, hôn nhân hợp đồng, cưới trước yêu sau, ngọt sủng hoặc ngược tâm. Yếu tố báo thù và làm giàu chỉ là nền.",
  },
  {
    name: "Xuyên không & cổ trang",
    hint: "Bối cảnh cổ đại là chính, dù có xuyên không hay không: người hiện đại xuyên về cổ đại hoặc xuyên vào sách, đích nữ trong phủ, cung đấu, vương gia - vương phi, nữ cường cổ trang, tiểu thư bỏ nhà khuynh đảo kinh thành. Nếu trục chính là tu luyện phép thuật thì thuộc Tu tiên huyền huyễn, không thuộc nhóm này.",
  },
  {
    name: "Tây Du & thần thoại",
    hint: "Lấy nhân vật và tích truyện từ Tây Du Ký, Phong Thần, Na Tra hoặc thần thoại Trung Hoa, kể lại hoặc dựng mới.",
  },
];

// Thẻ: chọn nhiều cho mỗi phim, dùng để lọc và gợi ý phim tương tự. Danh sách đóng — máy chỉ
// được chọn trong đây, không được tự nghĩ thẻ mới, nếu không vài chục phim là sinh ra một rừng
// thẻ na ná nhau không lọc được gì.
const TAGS = [
  "Trùng sinh", "Xuyên không", "Du hành thời gian", "Báo thù", "Vả mặt kẻ khinh thường",
  "Giấu thân phận", "Chiến thần", "Thần y", "Cao thủ ẩn thế", "Tổng tài", "Ngọt sủng",
  "Ngược tâm", "Hôn nhân", "Ly hôn", "Nữ cường", "Mẹ đơn thân", "Tình cha con",
  "Mẹ chồng nàng dâu", "Tranh gia sản", "Khởi nghiệp làm giàu", "Niên đại 80-90", "Nông thôn",
  "Đô thị", "Cổ trang", "Tu tiên", "Yêu ma quỷ quái", "Thần thoại", "Tây Du Ký", "Hệ thống",
  "Siêu năng lực", "Robot & AI", "Giới giải trí", "Hành động", "Hài hước", "Cẩu huyết",
];

const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

module.exports = { CATEGORIES, TAGS, CATEGORY_NAMES };
