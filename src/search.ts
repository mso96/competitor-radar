import type { SearchResult } from "./types.js";

export async function searchWeb(query: string, limit = 5, configuredProvider = "ceramic"): Promise<SearchResult[]> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID; const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for discovery");
  const provider = process.env.CLOUDFLARE_SEARCH_PROVIDER || configuredProvider; const gateway = process.env.CLOUDFLARE_AI_GATEWAY_ID || "default";
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/websearch/`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, provider, limit: Math.min(10, limit), options: { gateway: { id: gateway } } }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Cloudflare Web Search returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  return parseSearchResults(body);
}
export function parseSearchResults(body: unknown): SearchResult[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>; const rows = Array.isArray(obj.items) ? obj.items : Array.isArray((obj.result as any)?.items) ? (obj.result as any).items : [];
  return rows.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>; if (typeof value.url !== "string" || typeof value.title !== "string") return [];
    return [{ title: value.title, url: value.url, ...(typeof value.description === "string" ? { description: value.description } : {}), ...(typeof value.lastModified === "string" ? { lastModified: value.lastModified } : {}) }];
  });
}
