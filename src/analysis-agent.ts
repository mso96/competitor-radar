import type { Competitor, CompetitorAnalysis, Evidence } from "./types.js";

export async function analyzeCompetitor(competitor: Competitor, evidence: Evidence[]): Promise<CompetitorAnalysis> {
  if (!evidence.length) return { competitor: competitor.name, summary: "No new competitor activity detected.", signals: [] };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to analyse evidence");
  const schema = {
    type: "object", additionalProperties: false, required: ["competitor", "summary", "signals"], properties: {
      competitor: { type: "string" }, summary: { type: "string" }, signals: { type: "array", items: { type: "object", additionalProperties: false, required: ["category", "headline", "verified", "analysis", "source_urls"], properties: {
        category: { type: "string", enum: ["pricing", "positioning", "product", "product launch", "feature", "packaging", "ICP", "enterprise", "integration", "partnership", "acquisition", "distribution", "messaging", "company", "other"] },
        headline: { type: "string" }, verified: { type: "string" }, analysis: { type: "string" }, source_urls: { type: "array", items: { type: "string" } },
      } } },
    },
  };
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", instructions: SYSTEM_PROMPT, input: JSON.stringify({ competitor: competitor.name, evidence }), text: { format: { type: "json_schema", name: "competitor_analysis", strict: true, schema } } }), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`OpenAI Responses API returned HTTP ${response.status}`);
  const body = await response.json() as Record<string, unknown>; const output = extractOutputText(body);
  let parsed: CompetitorAnalysis;
  try { parsed = JSON.parse(output) as CompetitorAnalysis; } catch { throw new Error("OpenAI returned malformed analysis JSON"); }
  if (!Array.isArray(parsed.signals) || typeof parsed.summary !== "string") throw new Error("OpenAI response did not match the analysis format");
  return { ...parsed, competitor: competitor.name, signals: mergeSignals(parsed.signals) };
}
export function extractOutputText(body: Record<string, unknown>): string {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output as Record<string, unknown>[] : [];
  for (const item of output) for (const content of (Array.isArray(item.content) ? item.content as Record<string, unknown>[] : [])) if (typeof content.text === "string") return content.text;
  throw new Error("OpenAI response had no text output");
}
function mergeSignals(signals: CompetitorAnalysis["signals"]) {
  const merged = new Map<string, CompetitorAnalysis["signals"][number]>();
  for (const signal of signals) {
    const key = signal.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); const prior = merged.get(key);
    if (!prior) merged.set(key, signal);
    else { prior.source_urls = [...new Set([...prior.source_urls, ...signal.source_urls])]; prior.verified = [...new Set([prior.verified, signal.verified])].join(" "); if (prior.analysis !== signal.analysis) prior.analysis += ` ${signal.analysis}`; }
  }
  return [...merged.values()];
}
const SYSTEM_PROMPT = `You are competitor-analysis-agent, a single evidence-grounded analyst. Identify genuine competitor product, marketing, pricing, company, or go-to-market changes in the supplied evidence. Report every substantive signal, including small legitimate changes. Ignore technical noise such as markup artifacts, IDs, boilerplate, tracking, cookie changes, and duplicate announcements. Merge the same event across sources. Return one signal per distinct event. In verified, state only facts explicitly supported by evidence. In analysis, label interpretations as analysis and use cautious language. Never invent facts, dates, or pricing. Include only source URLs supplied in the evidence. If evidence is ambiguous or merely a search snippet, say what the evidence does and does not verify. Categories are labels; do not score or rank anything.`;
