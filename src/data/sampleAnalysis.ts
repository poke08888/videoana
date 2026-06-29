import type { Analysis, FormState } from "../types";

/** Dữ liệu mẫu CIMEE — dùng làm fallback khi chưa kết nối AI và để seed lịch sử. */
export function buildRaw(f: Partial<FormState>): Analysis {
  const prod = f.product || "Phấn phủ nén chống nắng CIMEE";
  const M = (
    cam: [string, string, string],
    action: string,
    setting: string,
    sound: string,
    wardrobe: string,
    cast: string
  ) => ({ size: cam[0], angle: cam[1], move: cam[2], action, setting, sound, wardrobe, cast });
  return {
    subtitle: prod + " — " + (f.title || "Thử thách dội nước & lau bông tẩy trang"),
    meta: {
      platform: f.platform || "TikTok / Douyin",
      duration: "46 giây · dọc 9:16",
      genre: f.genre || "Reviewer độc thoại (Vlog + Test)",
      product: prod,
      face: "Nữ creator trẻ trung",
      cta: "Quất liền một em · Trải nghiệm thực tế",
    },
    verdict: [
      { label: "Mở đầu bùng nổ", big: "Cực mạnh", note: "Dội nước xối xả vào mặt ngay giây 1, ném cushion giật gân giây 3." },
      { label: "Điểm bán có hình", big: "Xuất sắc", note: "Thử thách nước và lau bông tẩy trang chứng minh độ bám 100% trực quan." },
      { label: "Động cơ ra đơn", big: "Trải nghiệm", note: 'Cam kết "nguyện cả đời seeding" cực kỳ uy tín và chân thực.' },
      { label: "Đối chuẩn", big: "① & ⑤", note: "Sản phẩm cạnh tranh trực tiếp + khung dội nước chéo ngành." },
    ],
    hook: {
      quote: "Phấn phủ mà chống nắng? Để xem nó trôi hay không nhé.",
      type: "mâu thuẫn",
      viewerFirst: true,
      score: 9,
      note: "Dội cốc nước đỏ thẳng lên mặt mộc ngay giây 1 — pattern interrupt + mâu thuẫn điểm bán.",
    },
    acts: [
      {
        range: "0:00–0:08",
        title: "Hook dội nước gây sốc",
        summary: "Mở bằng cú dội cốc nước trực tiếp lên mặt để giữ chân người xem, tiếp tục tạo chú ý bằng cushion bay bất ngờ.",
        beats: [
          { ts: "0:01", vi: "Creator dội cốc nước đỏ trực tiếp lên mặt mộc", note: "Hook dội nước thu hút tò mò cực lớn về khả năng chống trôi ngay giây đầu.", ...M(["Cận rộng (MCU)", "Ngang tầm mắt", "Tripod tĩnh"], "Dội cốc nước lên mặt, nhắm mắt đón nước", "Góc phòng trang điểm, ánh sáng mịn", "Tiếng dội nước thật ào ào (foley)", "Áo thun xám sọc, mặt mộc", "1 nữ creator da căng khỏe") },
          { ts: "0:03", vi: 'Cushion bay ngang mặt, Creator hét "Á!"', note: "Pattern interrupt tạo kịch tính, kết thúc màn hook dồn dập.", ...M(["Cận (CU)", "Ngang tầm mắt", "Cắt cảnh nhanh"], "Hét bất ngờ, ôm má tỏ vẻ hoảng hốt", "Phòng ngủ, điều hòa phía sau", 'Tiếng hét "Á!" + tiếng gió', "Áo thun xám, tóc xốc xếch", "Nữ creator biểu cảm sinh động") },
        ],
      },
      {
        range: "0:08–0:21",
        title: "Giới thiệu & trực quan hạt phấn",
        summary: "Giới thiệu sản phẩm, trực quan hoá khả năng dặm phấn mịn màng không mốc nền như cài filter.",
        beats: [
          { ts: "0:10", vi: "Giơ hộp phấn nén sát camera, chỉ vào nhãn", note: "Cận cảnh vỏ hộp nhám mờ tối giản, mở nắp khoe khay phấn mịn.", ...M(["Cận (CU) sản phẩm", "Ngang / hơi cúi", "Tĩnh, xoá phông nhẹ"], "Cầm hộp phấn giơ sát camera", "Góc bàn trang điểm", "VO hào hứng giới thiệu", "Áo thun xám, móng đỏ", "Nữ creator cầm sản phẩm") },
          { ts: "0:16", vi: "Da mặt mịn như được cài filter", note: "Nghiêng mặt sát camera khoe làn da mịn, lỗ chân lông biến mất.", ...M(["Cực cận (ECU) má", "Hơi cao chếch xuống", "Tĩnh, bắt nét sâu"], "Mỉm cười, xoay má đón sáng", "Background phòng mờ dịu", "VO cảm thán hiệu ứng mịn", "Tóc buông xõa", "Nữ creator mặt phủ phấn mịn") },
        ],
      },
      {
        range: "0:21–0:33",
        title: "Thử thách dội nước & lau bông",
        summary: "Chứng minh khả năng bám nền chống nước, kiềm dầu cực hạn bằng dội nước ào ạt và lau bông tẩy trang không lem.",
        beats: [
          { ts: "0:24", vi: "Đứng dưới vòi sen phun nước xối xả", note: "Chứng minh độ bám bền bằng cảnh tắm dưới vòi sen cực kỳ chân thực.", ...M(["Trung cảnh (MS)", "Ngang tầm mắt", "Tĩnh, máy chống nước"], "Đứng dưới tia nước phun trực diện", "Phòng tắm gạch trắng", "Tiếng xối nước ào ạt", "Tóc ướt, không trôi eyeliner", "Nữ creator dưới vòi sen") },
          { ts: "0:32", vi: "Giơ bông tẩy trang trắng tinh sạch sẽ", note: "Đưa bông trắng sạch sát camera chứng minh lớp phấn không trôi rụng.", ...M(["Cực cận (ECU) bông", "Ngang tầm mắt", "Tĩnh, auto-focus"], "Nâng bông tẩy trang giơ sát ống kính", "Góc phòng trang điểm", "VO khẳng định độ bám màu", "Khuyên tai nhỏ lấp lánh", "Bàn tay model giơ bông") },
        ],
      },
      {
        range: "0:33–0:46",
        title: "Review da mịn & CTA chốt deal",
        summary: "Khoe layout make-up bóng khoẻ, bóc seal hộp phấn tráng gương và kêu gọi mua hàng quyết liệt.",
        beats: [
          { ts: "0:45", vi: "Bóc lớp màng nilon trên nắp tráng gương", note: 'Hành động bóc seal cực "satisfying" tạo động lực sở hữu sản phẩm mới.', ...M(["Cận (CU) sản phẩm", "Ngang / hơi cúi", "Tĩnh, lấy nét cực nét"], "Bóc nhẹ màng bọc nắp gương", "Bàn trang điểm đèn LED", 'SFX "xoẹt" giòn + lời CTA', "Móng đỏ trên nền gương bạc", "Đôi tay người mẫu bóc seal") },
        ],
      },
    ],
    checklist: [
      { crit: "① 3s đầu giữ người", level: "ok", note: "Dội cốc nước lên mặt ngay giây đầu, cushion bay giật mình tạo tò mò lớn." },
      { crit: "② Pain point cụ thể", level: "ok", note: "Giải quyết nỗi lo mốc nền, trôi nền khi nắng nóng, đổ mồ hôi hay dính nước." },
      { crit: "③ Kết quả nhìn thấy", level: "ok", note: "Chứng minh trực tiếp bằng bông tẩy trang lau mạnh vẫn trắng sạch hoàn toàn." },
      { crit: "④ Có so sánh", level: "mid", note: "Không so sánh rõ trước/sau cùng khung, chỉ so sánh ngầm qua hiệu ứng mịn da." },
      { crit: "⑤ Quá trình sử dụng", level: "ok", note: "Từ dặm phấn → đi chơi → dội nước vòi sen → dội cốc → lau bông kiểm chứng." },
      { crit: "⑥ Cảnh chuyển đổi mạnh", level: "ok", note: "Cảnh bông tẩy trang sạch tinh sau lau mặt ướt cực kỳ đắt giá." },
      { crit: "⑦ CTA rõ ràng", level: "ok", note: 'Bóc seal gương bóng bẩy kèm câu "Quất liền một em, đảm bảo không thất vọng".' },
    ],
    formulaVisual:
      "[Mở đầu] Hành động sốc với nước/đạo cụ bay → [Nội dung] Dặm thử + cận cảnh da căng mịn → [Test cực hạn] Tắm/dội nước lần 2 + táp má → [Chứng minh] Lau bông tẩy trang và giơ bông sạch tinh → [Chốt] Khoe layout makeup + bóc seal gương.",
    formulaScript:
      'Đặt câu hỏi mâu thuẫn ("Phấn phủ mà chống nắng?") → Giới thiệu điểm bán chống nước/mỏng nhẹ → Kể chuyện bám bền thực tế ("đi chơi 7 tiếng nền không xi nhê") → Cam kết uy tín ("nguyện cả đời seeding") → CTA quyết liệt ("quất liền một em").',
    verdictText:
      'Video đạt điểm tối đa về Trực quan hoá Điểm bán (waterproof / kiềm dầu) bằng cách đưa cơ thể vào chịu thử thách khắc nghiệt. Cách kể chuyện tự nhiên và câu khẳng định "nguyện cả đời seeding" giúp kéo gần khoảng cách, nâng cao độ tin cậy.',
    quotes: [
      '"Để có lớp nền bền đẹp như vậy tôi đã dùng phấn phủ của nhà [Thương hiệu]."',
      '"Đã mỏng nhẹ tự nhiên mà lại còn chống nắng… chỉ có phấn nén nhà [Thương hiệu]."',
      '"Tôi đi chơi cỡ 7 tiếng mới về mà lớp nền này không hề xi nhê một tí nào."',
      '"Có táp như thế nào đi chăng nữa thì lớp nền này nó không hề xi nhê."',
      '"Video này tôi không hề seeding, nhưng nếu có thì nguyện cả đời seeding em nó."',
      '"Bà nào đang phân vân không biết nên mua không thì quất liền một em đi."',
    ],
    visuals: [
      "Cảnh dội cốc nước đỏ lên mặt tạo sốc thu hút.",
      "Cú ném cushion giật mình tạo ngắt quãng chú ý.",
      "Thao tác dặm phấn mịn màng lên da mặt.",
      "Cảnh tắm vòi sen nước phun xối xả lên mặt.",
      "Lau bông tẩy trang và giơ miếng bông sạch tinh sát camera.",
      "Bóc màng nilon bảo vệ nắp gương bóng loáng của hộp phấn.",
    ],
    objchuan: {
      type: "① cùng loại + ⑤ chéo ngành",
      note: "Cạnh tranh trực tiếp dòng phấn phủ chống nắng, đồng thời mượn khung 'thử thách dội nước' vốn viral chéo ngành.",
    },
    newAngles: [
      "Thử thách chạy bộ 30 phút mồ hôi đầm đìa → thấm khăn giấy khô không dính phấn.",
      "Test nửa mặt dưới mưa nhân tạo (bình xịt) → nửa dùng phấn nước đọng thành giọt lăn đi.",
      "Cận cảnh hạt phấn thả trên cốc nước → phấn nổi & khô ráo khi múc ra.",
      "Khảo sát đường phố 8 tiếng, selfie đo độ bám theo từng mốc giờ.",
      "Dân văn phòng máy lạnh 9h sáng → 6h chiều, lớp nền vẫn căng mịn.",
    ],
    steals: [
      { thuphap: "Hook phản trực giác bằng nước", at: "0:01 — dội cốc nước lên mặt", why: "Phá vỡ kỳ vọng (mỹ phẩm + nước = hỏng) nên người xem buộc dừng để xem kết quả.", how: "Mở đầu bằng một hành động 'phá' sản phẩm để chứng minh độ bền." },
      { thuphap: "Bằng chứng bông trắng", at: "0:32 — giơ bông tẩy trang sạch tinh", why: "Vật chứng trắng/sạch là bằng chứng đanh thép, không thể cãi.", how: "Luôn có một 'vật chứng' cận cảnh sau cảnh test cực hạn." },
      { thuphap: 'Cam kết "nguyện cả đời seeding"', at: "0:40 — lời cam kết cá nhân", why: "Tự hạ thấp động cơ bán hàng → tăng độ tin.", how: "Chèn một câu cam kết cá nhân chân thật trước CTA." },
    ],
  };
}

export const seedForms: FormState[] = [
  { title: "Thử thách dội nước & lau bông tẩy trang", platform: "TikTok / Douyin", product: "Phấn phủ nén chống nắng CIMEE", genre: "Reviewer độc thoại (Vlog + Test)", notes: "", file: "" },
  { title: "Test kiềm dầu phấn nén nam sau 90 phút bóng đá", platform: "TikTok", product: "Phấn kiềm dầu nam Nerman", genre: "Trải nghiệm sản phẩm", notes: "", file: "" },
  { title: "Một ngày 12 tiếng — lớp nền có trụ nổi?", platform: "Reels (Instagram)", product: "Cushion che khuyết điểm", genre: "Storytelling", notes: "", file: "" },
];

export const seedDates = ["Hôm nay", "3 ngày trước", "Tuần trước"];
