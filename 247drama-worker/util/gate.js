// Cổng chặn số việc chạy cùng lúc.
//
// Dùng cho tải qua proxy: hai máy render đều đi ra internet bằng CÙNG một IP của VPS Hong
// Kong, mà CDN Trung Quốc bóp băng thông theo IP. Mở 10 luồng tải cùng lúc thì mỗi luồng chỉ
// còn một phần nhỏ tốc độ, nhiều kết nối treo quá hạn rồi bị tính là lỗi — trong khi tổng
// lượng tải về chẳng nhiều hơn. Xếp hàng ít luồng nhưng chạy thật vẫn nhanh hơn.
function createGate(limit) {
  const max = Math.max(1, parseInt(limit) || 1);
  let running = 0;
  const queue = [];

  const next = () => {
    if (running >= max || !queue.length) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    // Trừ bộ đếm TRƯỚC khi báo kết quả: dùng .finally() thì người gọi tỉnh dậy trước lúc bộ
    // đếm giảm, nên số "đang chạy" đọc ngay sau await sẽ sai.
    const xong = (settle) => (v) => {
      running--;
      next();
      settle(v);
    };
    Promise.resolve().then(fn).then(xong(resolve), xong(reject));
  };

  return {
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    },
    get running() { return running; },
    get waiting() { return queue.length; },
    limit: max,
  };
}

module.exports = { createGate };
