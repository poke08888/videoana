/** server/style/zip.ts — đóng gói skill thành zip trong bộ nhớ bằng fflate (thuần JS, không native — build alpine an toàn). */
import { zipSync, strToU8 } from "fflate";
import { buildTimelinesMd, buildFormulasMd, slugOf } from "./skill.js";
import type { StyleProfile } from "./types.js";

const dataUrlToBytes = (u: string): Uint8Array | null => { const m = String(u || "").match(/^data:image\/\w+;base64,(.+)$/); return m ? new Uint8Array(Buffer.from(m[1], "base64")) : null; };

export function buildSkillZip(p: StyleProfile, skillMd: string): { name: string; buffer: Buffer } {
  const root = `style-${slugOf(p.channel.handle)}`;
  const { evidence, ...slim } = p;
  const files: Record<string, Uint8Array> = {
    [`${root}/SKILL.md`]: strToU8(skillMd),
    [`${root}/references/profile.json`]: strToU8(JSON.stringify(slim, null, 1)),
    [`${root}/references/timelines.md`]: strToU8(buildTimelinesMd(p)),
    [`${root}/references/formulas.md`]: strToU8(buildFormulasMd(p)),
  };
  for (const [key, urls] of Object.entries(evidence || {})) urls.forEach((u, i) => { const b = dataUrlToBytes(u); if (b) files[`${root}/references/evidence/${key.replace(/[^a-zA-Z0-9]+/g, "-")}-${i + 1}.jpg`] = b; });
  const out = zipSync(files, { level: 6 });
  return { name: `${root}.zip`, buffer: Buffer.from(out) };
}
