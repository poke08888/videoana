import type { CSSProperties } from "react";

/**
 * css("a:b;c:d") -> React style object. Cho phép port nguyên các chuỗi style
 * inline từ design HTML sang React mà không phải dịch tay từng thuộc tính.
 */
export function css(str: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of str.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const rawProp = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!rawProp || !val) continue;
    out[toCamel(rawProp)] = val;
  }
  return out as CSSProperties;
}

function toCamel(prop: string): string {
  if (prop.startsWith("--")) return prop; // CSS variable, để nguyên
  if (prop.startsWith("-ms-")) return "ms" + cap(camel(prop.slice(4)));
  if (prop.startsWith("-")) return cap(camel(prop.slice(1)));
  return camel(prop);
}
const camel = (s: string) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
