import path from "node:path";
import type { Competitor, Evidence, SearchResult } from "./types.js";
import { fetchPage } from "./fetch.js";
import { extractContent } from "./extract.js";
import { searchWeb } from "./search.js";
import { canonicalUrl, readText, slug, today, writeText } from "./utils.js";

const queryTemplates = (competitor: Competitor) => [
  `"${competitor.name}" new product OR launch OR feature`,
  `"${competitor.name}" pricing OR plan`,
  `"${competitor.name}" integration OR partnership`,
  `"${competitor.name}" enterprise OR customer segment`,
  `"${competitor.name}" announcement company`,
  `site:${competitor.domain} pricing OR plans`,
  `site:${competitor.domain} changelog OR release OR launch`,
];
interface DiscoveryState { seen: { url: string; title: string; first_seen: string }[] }
export async function discoverCompetitor(competitor: Competitor, options: { provider?: string; limit?: number } = {}): Promise<{ evidence: Evidence[]; errors: string[]; searches: number }> {
  const file = path.join("data/discovery", `${slug(competitor.name)}.json`); const errors: string[] = []; const state = parseState(await readText(file));
  const known = new Set(state.seen.map((item) => safeCanonical(item.url)));
  for (const pageUrl of Object.values(competitor.pages)) if (pageUrl) known.add(safeCanonical(pageUrl));
  const found = new Map<string, SearchResult>(); let searches = 0;
  for (const query of queryTemplates(competitor)) {
    try { searches++; for (const item of await searchWeb(query, options.limit ?? 5, options.provider ?? "ceramic")) { const url = safeCanonical(item.url); if (!known.has(url)) found.set(url, { ...item, url }); } }
    catch (error) { errors.push(`${competitor.name} search "${query}": ${(error as Error).message}`); }
  }
  const evidence: Evidence[] = [];
  for (const item of found.values()) {
    let details = item.description || "New page discovered in web search.";
    try { const page = await fetchPage(item.url); const extracted = extractContent(page.html); if (extracted.length > 80) details = extracted.slice(0, 6000); }
    catch (error) { errors.push(`${competitor.name} discovered URL ${item.url}: ${(error as Error).message}`); }
    evidence.push({ kind: "web_discovery", title: item.title, url: item.url, details });
    state.seen.push({ url: item.url, title: item.title, first_seen: today() });
  }
  await writeText(file, `${JSON.stringify(state, null, 2)}\n`);
  return { evidence, errors, searches };
}
function parseState(text: string | null): DiscoveryState { if (!text) return { seen: [] }; try { const value = JSON.parse(text); return { seen: Array.isArray(value.seen) ? value.seen : [] }; } catch { return { seen: [] }; } }
function safeCanonical(url: string) { try { return canonicalUrl(url); } catch { return url; } }
