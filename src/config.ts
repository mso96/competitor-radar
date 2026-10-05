import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { Competitor, PageType, RadarConfig } from "./types.js";

const pageTypes: PageType[] = ["homepage", "pricing", "changelog"];
export async function loadConfig(file = "competitors.yaml"): Promise<RadarConfig> {
  let raw: unknown;
  try { raw = YAML.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`Could not read valid YAML from ${file}: ${(error as Error).message}`); }
  if (!raw || typeof raw !== "object") throw new Error("Configuration must be a YAML object");
  const value = raw as Record<string, unknown>;
  if (typeof value.company !== "string" || !Array.isArray(value.competitors)) throw new Error("Configuration needs a company name and competitors list");
  const settings = (value.settings ?? {}) as Record<string, unknown>;
  const competitors: Competitor[] = value.competitors.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Competitor ${index + 1} must be an object`);
    const item = entry as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.domain !== "string") throw new Error(`Competitor ${index + 1} needs name and domain`);
    const rawPages = (item.pages ?? {}) as Record<string, unknown>;
    const pages: Competitor["pages"] = {};
    for (const type of pageTypes) if (rawPages[type] !== undefined) {
      if (typeof rawPages[type] !== "string" || !/^https?:\/\//.test(rawPages[type] as string)) throw new Error(`${item.name} ${type} must be an http(s) URL`);
      pages[type] = rawPages[type] as string;
    }
    return { name: item.name, domain: item.domain, pages };
  });
  return { company: value.company, settings: { search_provider: String(settings.search_provider ?? process.env.CLOUDFLARE_SEARCH_PROVIDER ?? "ceramic"), search_results_per_query: Math.min(10, Math.max(1, Number(settings.search_results_per_query ?? 5))) }, competitors };
}
