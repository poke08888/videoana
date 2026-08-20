// Chia việc giữa nhiều máy render.
//
// Nhiều máy cùng đọc một kho Mongo sẽ thấy CÙNG danh sách tập còn thiếu, rồi cùng tải, cùng
// dịch, cùng upload đè lên nhau — tốn gấp đôi thời gian và quota mà chẳng thêm được tập nào.
// Trước khi làm một tập, máy phải "nhận phần" tập đó: ghi một bản ghi có _id là khoá tập.
// Mongo bảo đảm chỉ một máy ghi được, máy còn lại nhận lỗi trùng khoá và bỏ qua tập đó.
//
// Phần nhận có HẠN: máy nào tắt ngang (mất điện, sập nguồn) thì tập nó đang giữ tự hết hạn
// và máy khác nhận lại, không cần ai dọn tay.
const DUP_KEY = 11000;
const LEASE_MS = 20 * 60 * 1000; // dài hơn hẳn giới hạn 8 phút/tập của render

function claimKey(provider, sourceId, index) {
  return `${provider}:${sourceId}:${index}`;
}

/**
 * @returns {Promise<boolean>} true = mình được làm tập này
 */
async function claimEpisode(col, { provider, sourceId, index, worker, now = Date.now(), leaseMs = LEASE_MS }) {
  const _id = claimKey(provider, sourceId, index);
  const at = new Date(now);
  try {
    await col.insertOne({ _id, worker, at });
    return true;
  } catch (e) {
    if (e && e.code !== DUP_KEY) throw e;
  }
  // Đã có người giữ: chỉ giành lại khi phần nhận của họ quá hạn.
  const res = await col.findOneAndUpdate(
    { _id, at: { $lt: new Date(now - leaseMs) } },
    { $set: { worker, at } }
  );
  const taken = res && (res.value !== undefined ? res.value : res);
  return !!taken;
}

async function releaseEpisode(col, { provider, sourceId, index }) {
  await col.deleteOne({ _id: claimKey(provider, sourceId, index) });
}

// Dọn phần nhận quá hạn (máy chết) — gọi mỗi vòng quét cho gọn kho.
async function sweepExpired(col, { now = Date.now(), leaseMs = LEASE_MS } = {}) {
  const r = await col.deleteMany({ at: { $lt: new Date(now - leaseMs) } });
  return (r && r.deletedCount) || 0;
}

module.exports = { claimEpisode, releaseEpisode, sweepExpired, claimKey, LEASE_MS };
