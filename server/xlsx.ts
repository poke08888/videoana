/**
 * server/xlsx.ts — đọc file .xlsx tối giản, KHÔNG cần thư viện ngoài.
 *
 * .xlsx là một file ZIP chứa XML. Ta tự đọc ZIP (central directory) rồi giải nén
 * (zlib.inflateRaw) các entry cần dùng: xl/sharedStrings.xml + xl/worksheets/sheet1.xml,
 * cuối cùng bóc các ô thành lưới [hàng][cột] dạng chuỗi.
 *
 * Đủ dùng cho file export 1 sheet như phantichcontent.xlsx; không hỗ trợ mọi
 * biến thể OOXML (formula caching phức tạp, nhiều sheet liên kết tên...).
 */
import zlib from "node:zlib";

/** Bóc các entry trong ZIP buffer → map tên file → nội dung (Buffer). */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  // Tìm End Of Central Directory (EOCD): chữ ký 0x06054b50, quét ngược từ cuối.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("File không phải ZIP/xlsx hợp lệ (thiếu EOCD).");
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset bắt đầu central directory

  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // chữ ký central directory header
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // Đọc local file header để biết phần dữ liệu bắt đầu ở đâu.
    if (buf.readUInt32LE(localOff) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      try {
        out[name] = method === 0 ? Buffer.from(comp) : zlib.inflateRawSync(comp);
      } catch {
        /* bỏ qua entry giải nén lỗi */
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Lấy text trong một phần tử <si> hoặc <c><is> (gộp mọi <t>). */
function joinText(xml: string): string {
  const parts = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
  return parts.map((t) => t.replace(/<t[^>]*>([\s\S]*?)<\/t>/, "$1")).join("");
}

/** Giải mã thực thể XML cơ bản. */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Chuyển nhãn cột (A, B, ..., AA) → số thứ tự 1-based. */
function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * Đọc sheet đầu tiên của một file .xlsx → mảng hàng, mỗi hàng là mảng ô (chuỗi).
 * Hàng/cột thưa được lấp bằng chuỗi rỗng. Cột Thumbnail (ảnh) sẽ rỗng.
 */
export function readXlsxGrid(buf: Buffer): string[][] {
  const files = unzip(buf);
  const sheetName =
    Object.keys(files).find((k) => /xl\/worksheets\/sheet1\.xml$/i.test(k)) ||
    Object.keys(files).find((k) => /xl\/worksheets\/.*\.xml$/i.test(k));
  if (!sheetName) throw new Error("Không tìm thấy worksheet trong file xlsx.");
  const sheetXml = files[sheetName].toString("utf8");

  // Bảng chuỗi dùng chung (shared strings).
  const shared: string[] = [];
  const ssBuf = files["xl/sharedStrings.xml"];
  if (ssBuf) {
    const ssXml = ssBuf.toString("utf8");
    for (const si of ssXml.match(/<si>([\s\S]*?)<\/si>/g) || []) {
      shared.push(decode(joinText(si)));
    }
  }

  const grid: Record<number, Record<number, string>> = {};
  let maxRow = 0;
  let maxCol = 0;

  for (const rowM of sheetXml.match(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g) || []) {
    const rAttr = /r="(\d+)"/.exec(rowM);
    const rowNum = rAttr ? Number(rAttr[1]) : 0;
    if (!rowNum) continue;
    maxRow = Math.max(maxRow, rowNum);

    // Mỗi ô: <c r="A1" t="s"><v>..</v></c> hoặc inline <is><t>..</t></is>.
    const cellRe = /<c\s+r="([A-Z]+)\d+"(?:[^>]*?\st="([^"]+)")?[^>]*?>([\s\S]*?)<\/c>|<c\s+r="([A-Z]+)\d+"[^>]*?\/>/g;
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(rowM))) {
      const colLetters = m[1] || m[4];
      if (!colLetters) continue;
      const col = colNum(colLetters);
      const type = m[2];
      const inner = m[3] || "";
      let val = "";
      if (type === "inlineStr") {
        val = decode(joinText(inner));
      } else {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const raw = vM ? vM[1] : "";
        if (type === "s") val = shared[Number(raw)] ?? "";
        else val = decode(raw);
      }
      if (val !== "") {
        (grid[rowNum] ||= {})[col] = val;
        maxCol = Math.max(maxCol, col);
      }
    }
  }

  const out: string[][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const row: string[] = [];
    for (let c = 1; c <= maxCol; c++) row.push(grid[r]?.[c] ?? "");
    out.push(row);
  }
  return out;
}
