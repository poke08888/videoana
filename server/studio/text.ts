/** server/studio/text.ts — tiện ích tiếng Việt: đơn âm tiết nên đếm âm tiết = đếm token có chữ/số. */
export function countSyllables(text: string): number {
  return String(text || "").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}
/** Số âm tiết tối đa cho một cảnh: nhịp (âm tiết/giây) × độ dài clip, làm tròn xuống. */
export function maxSyllablesFor(syllablesPerSec: number, clipLen: number): number {
  return Math.floor(syllablesPerSec * clipLen);
}
