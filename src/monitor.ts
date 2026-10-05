import path from "node:path";
import type { Competitor, Evidence, PageType } from "./types.js";
import { fetchPage } from "./fetch.js";
import { extractContent } from "./extract.js";
import { semanticDiff } from "./diff.js";
import { readText, slug, writeText } from "./utils.js";

export interface MonitorResult { evidence: Evidence[]; errors: string[]; checked: string[] }
export async function monitorCompetitor(competitor: Competitor, root = process.cwd(), fetcher = fetchPage): Promise<MonitorResult> {
  const result: MonitorResult = { evidence: [], errors: [], checked: [] };
  for (const [type, url] of Object.entries(competitor.pages) as [PageType, string][]) {
    const file = path.join(root, "snapshots", slug(competitor.name), `${type}.md`);
    try {
      const response = await fetcher(url); const content = extractContent(response.html);
      if (!content) throw new Error("no useful text could be extracted");
      result.checked.push(type);
      const previous = await readText(file);
      if (previous === null) { await writeText(file, `${content}\n`); continue; }
      if (previous.trim() !== content.trim()) {
        const diff = semanticDiff(previous, content);
        const details = [...diff.changed, ...diff.added.map((line) => `Added: ${line}`), ...diff.removed.map((line) => `Removed: ${line}`)].join("\n");
        if (details) result.evidence.push({ kind: "page_change", title: `${type} content changed`, url, details: details.slice(0, 12_000) });
        await writeText(file, `${content}\n`);
      }
    } catch (error) { result.errors.push(`${competitor.name} ${type} (${url}): ${(error as Error).message}`); }
  }
  return result;
}
