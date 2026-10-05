export interface ContentDiff { added: string[]; removed: string[]; changed: string[] }
export function semanticDiff(before: string, after: string): ContentDiff {
  const oldLines = new Set(before.split(/\n+/).map((x) => x.trim()).filter(Boolean)); const newLines = new Set(after.split(/\n+/).map((x) => x.trim()).filter(Boolean));
  const removed = [...oldLines].filter((x) => !newLines.has(x)); const added = [...newLines].filter((x) => !oldLines.has(x)); const used = new Set<string>(); const changed: string[] = [];
  for (const oldLine of removed) { const match = added.find((line) => !used.has(line) && similarity(oldLine, line) >= 0.42); if (match) { used.add(match); changed.push(`Before: ${oldLine}\nAfter: ${match}`); } }
  // A short replacement such as “Contact sales” → “$49/month” has no shared
  // words, but is still a meaningful change. Pair remaining replacements when
  // the old and new content have the same number of lines.
  const remainingOld = removed.filter((line) => !changed.some((item) => item.startsWith(`Before: ${line}\n`)));
  const remainingNew = added.filter((line) => !used.has(line));
  if (remainingOld.length === remainingNew.length) remainingOld.forEach((oldLine, index) => {
    const newLine = remainingNew[index]; used.add(newLine); changed.push(`Before: ${oldLine}\nAfter: ${newLine}`);
  });
  return { added: added.filter((line) => !used.has(line)), removed: removed.filter((line) => !changed.some((item) => item.startsWith(`Before: ${line}\n`))), changed };
}
function similarity(a: string, b: string) {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}$€£.]+/gu, " ").split(/\s+/).filter((x) => x.length > 2));
  const left = words(a), right = words(b); if (!left.size || !right.size) return 0;
  return [...left].filter((word) => right.has(word)).length / Math.max(left.size, right.size);
}
