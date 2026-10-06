import * as cheerio from "cheerio";
import YAML from "yaml";
import configText from "../competitors.yaml";

type PageType = "homepage" | "pricing" | "changelog";
type Competitor = { name: string; domain: string; pages: Partial<Record<PageType, string>> };
type Evidence = { kind: "page_change" | "web_discovery"; title: string; url: string; details: string };
type Signal = { category: string; headline: string; verified: string; analysis: string; source_urls: string[] };
type Analysis = { competitor: string; summary: string; signals: Signal[] };
type SearchResult = { title: string; url: string; description?: string; lastModified?: string };

const pageTypes = ["homepage", "pricing", "changelog"] as const;
const categories = ["pricing", "positioning", "product", "product launch", "feature", "packaging", "ICP", "enterprise", "integration", "partnership", "acquisition", "distribution", "messaging", "company", "other"];

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScan(env).catch((error) => { console.error(JSON.stringify({ event: "scan_failed", message: message(error) })); }));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "ok", service: "competitor-radar" });
    if (request.method === "GET" && url.pathname === "/api/overview") {
      const config = await loadConfig(env);
      const reports = await listReportDates(env);
      return Response.json({ company: config.company, competitors: config.competitors.map((competitor) => ({ id: slug(competitor.domain), name: competitor.name, domain: competitor.domain, pages: Object.keys(competitor.pages || {}) })), latestReportDate: reports[0] || null, reportDates: reports, slackConnected: Boolean(env.SLACK_WEBHOOK_URL?.trim()), schedule: "07:17 UTC" });
    }
    if (request.method === "POST" && url.pathname === "/api/competitors") {
      if (!authorized(request, env.RADAR_RUN_TOKEN)) return Response.json({ error: "unauthorized" }, { status: 401 });
      let input: unknown;
      try { input = await request.json(); } catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
      const competitor = validateCompetitor(input);
      if ("error" in competitor) return Response.json({ error: competitor.error }, { status: 400 });
      const config = await loadConfig(env);
      if (config.competitors.length >= 40) return Response.json({ error: "The watchlist is full (40 competitors maximum)." }, { status: 409 });
      if (config.competitors.some((item) => slug(item.name) === slug(competitor.name) || item.domain.toLowerCase() === competitor.domain.toLowerCase())) return Response.json({ error: "That competitor is already on the watchlist." }, { status: 409 });
      config.competitors.push(competitor);
      await saveConfig(env, config);
      return Response.json({ competitor: { name: competitor.name, domain: competitor.domain, pages: Object.keys(competitor.pages) } }, { status: 201 });
    }
    const competitorMatch = url.pathname.match(/^\/api\/competitors\/([a-z0-9-]+)$/);
    if (request.method === "DELETE" && competitorMatch) {
      if (!authorized(request, env.RADAR_RUN_TOKEN)) return Response.json({ error: "unauthorized" }, { status: 401 });
      const config = await loadConfig(env);
      const originalCount = config.competitors.length;
      config.competitors = config.competitors.filter((item) => slug(item.domain) !== competitorMatch[1]);
      if (config.competitors.length === originalCount) return Response.json({ error: "Competitor not found." }, { status: 404 });
      await saveConfig(env, config);
      return Response.json({ status: "deleted" });
    }
    if (request.method === "GET" && url.pathname === "/api/reports") return Response.json({ dates: await listReportDates(env) });
    const reportMatch = url.pathname.match(/^\/api\/reports\/(\d{4}-\d{2}-\d{2})$/);
    if (request.method === "GET" && reportMatch) {
      const report = await env.STATE.get(`reports/${reportMatch[1]}.md`);
      if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
      return new Response(await report.text(), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" && url.pathname === "/run") {
      if (!authorized(request, env.RADAR_RUN_TOKEN)) return Response.json({ error: "unauthorized" }, { status: 401 });
      ctx.waitUntil(runScan(env).catch((error) => { console.error(JSON.stringify({ event: "scan_failed", message: message(error) })); }));
      return Response.json({ status: "accepted", message: "Scan started. Check Worker logs for progress." }, { status: 202 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function listReportDates(env: Env) {
  const result = await env.STATE.list({ prefix: "reports/", limit: 1000 });
  return result.objects.map((object) => object.key.match(/^reports\/(\d{4}-\d{2}-\d{2})\.md$/)?.[1]).filter((date): date is string => Boolean(date)).sort((a, b) => b.localeCompare(a));
}

type RadarConfig = { company: string; settings?: { search_provider?: string; search_results_per_query?: number }; competitors: Competitor[] };
const competitorsConfigKey = "config/competitors.json";
async function loadConfig(env: Env): Promise<RadarConfig> {
  const config = YAML.parse(configText) as RadarConfig;
  const stored = await env.STATE.get(competitorsConfigKey);
  if (!stored) return config;
  try {
    const parsed = JSON.parse(await stored.text()) as { competitors?: unknown };
    if (Array.isArray(parsed.competitors)) config.competitors = parsed.competitors as Competitor[];
    else console.error(JSON.stringify({ event: "competitors_config_invalid", reason: "competitors is not an array" }));
  } catch (error) { console.error(JSON.stringify({ event: "competitors_config_invalid", message: message(error) })); }
  return config;
}
async function saveConfig(env: Env, config: RadarConfig) {
  await env.STATE.put(competitorsConfigKey, JSON.stringify({ competitors: config.competitors }, null, 2), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
}
function validateCompetitor(input: unknown): Competitor | { error: string } {
  if (!input || typeof input !== "object") return { error: "Provide a competitor name and website." };
  const value = input as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const homepage = safeHttpsUrl(value.homepage);
  if (name.length < 2 || name.length > 80) return { error: "Name must be between 2 and 80 characters." };
  if (!homepage) return { error: "Enter a valid HTTPS homepage URL." };
  const domain = homepage.hostname.replace(/^www\./i, "").toLowerCase();
  const pages: Competitor["pages"] = { homepage: homepage.toString() };
  for (const type of ["pricing", "changelog"] as const) {
    const raw = value[type];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const url = safeHttpsUrl(raw);
    if (!url) return { error: `${type === "pricing" ? "Pricing" : "Changelog"} URL must use HTTPS.` };
    pages[type] = url.toString();
  }
  return { name, domain, pages };
}
function safeHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try { const url = new URL(value.trim()); return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url : null; } catch { return null; }
}

async function runScan(env: Env) {
  const config = await loadConfig(env);
  const errors: string[] = []; const analyses: Analysis[] = [];
  console.log(JSON.stringify({ event: "scan_started", competitors: config.competitors.length, date: new Date().toISOString().slice(0, 10) }));
  for (const competitor of config.competitors) {
    const evidence: Evidence[] = [];
    const monitor = await monitorCompetitor(env, competitor); evidence.push(...monitor.evidence); errors.push(...monitor.errors);
    const discovery = await discoverCompetitor(env, competitor, config.settings?.search_provider || "ceramic", config.settings?.search_results_per_query || 5);
    evidence.push(...discovery.evidence); errors.push(...discovery.errors);
    try {
      const analysis = await analyzeCompetitor(env, competitor, evidence); analyses.push(analysis);
      console.log(JSON.stringify({ event: "competitor_complete", competitor: competitor.name, signals: analysis.signals.length, pages_checked: monitor.checked, discoveries: discovery.evidence.length }));
    } catch (error) { errors.push(`${competitor.name} analysis: ${message(error)}`); }
  }
  const report = formatReport(analyses); const date = new Date().toISOString().slice(0, 10);
  if (analyses.some((analysis) => analysis.signals.length)) {
    await env.STATE.put(`reports/${date}.md`, report, { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
    if (env.SLACK_WEBHOOK_URL?.trim()) {
      try { await sendSlack(env, analyses, date); console.log(JSON.stringify({ event: "slack_sent" })); }
      catch (error) { errors.push(`Slack: ${message(error)}`); }
    } else console.log(JSON.stringify({ event: "slack_skipped", reason: "SLACK_WEBHOOK_URL is not configured" }));
  }
  for (const error of errors) console.error(JSON.stringify({ event: "scan_error", message: error }));
  console.log(JSON.stringify({ event: "scan_finished", errors: errors.length, report_created: analyses.some((analysis) => analysis.signals.length) }));
}

async function monitorCompetitor(env: Env, competitor: Competitor) {
  const evidence: Evidence[] = []; const errors: string[] = []; const checked: string[] = [];
  for (const type of pageTypes) {
    const url = competitor.pages?.[type]; if (!url) continue;
    const key = `snapshots/${slug(competitor.name)}/${type}.md`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": "CompetitorRadar/0.1 (public market research)", Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await boundedText(response, 2_000_000); const content = extractContent(html);
      if (!content) throw new Error("no useful content extracted");
      checked.push(type); const snapshotObject = await env.STATE.get(key); const previous = snapshotObject ? await snapshotObject.text() : null;
      if (previous === null) await env.STATE.put(key, content);
      else if (previous !== content) {
        const diff = semanticDiff(previous, content);
        if (diff) evidence.push({ kind: "page_change", title: `${type} content changed`, url, details: diff.slice(0, 12000) });
        await env.STATE.put(key, content);
      }
    } catch (error) { errors.push(`${competitor.name} ${type} (${url}): ${message(error)}`); }
  }
  return { evidence, errors, checked };
}

async function discoverCompetitor(env: Env, competitor: Competitor, configuredProvider: string, limit: number) {
  const key = `data/discovery/${slug(competitor.name)}.json`; const errors: string[] = []; const evidence: Evidence[] = [];
  const storedObject = await env.STATE.get(key); const stored = storedObject ? await storedObject.text() : null; let state: { seen: { url: string; title: string; first_seen: string }[] } = { seen: [] };
  if (stored) { try { const parsed = JSON.parse(stored) as { seen?: unknown }; if (Array.isArray(parsed.seen)) state.seen = parsed.seen as typeof state.seen; } catch { errors.push(`${competitor.name} discovery state was invalid JSON; resetting it`); } }
  const known = new Set(state.seen.map((item) => canonicalUrl(item.url)));
  for (const url of Object.values(competitor.pages || {})) if (url) known.add(canonicalUrl(url));
  const queries = [
    `"${competitor.name}" new product OR launch OR feature`, `"${competitor.name}" pricing OR plan`,
    `"${competitor.name}" integration OR partnership`, `"${competitor.name}" enterprise OR customer segment`,
    `"${competitor.name}" announcement company`, `site:${competitor.domain} pricing OR plans`,
    `site:${competitor.domain} changelog OR release OR launch`,
  ];
  const results: SearchResult[][] = [];
  for (let offset = 0; offset < queries.length; offset += 4) {
    const batch = await Promise.all(queries.slice(offset, offset + 4).map(async (query) => {
      try { return await searchWeb(env, query, Math.min(10, limit), configuredProvider); }
      catch (error) { errors.push(`${competitor.name} search: ${message(error)}`); return []; }
    }));
    results.push(...batch);
  }
  const found = new Map<string, SearchResult>();
  for (const result of results.flat()) { const url = canonicalUrl(result.url); if (!known.has(url)) found.set(url, { ...result, url }); }
  for (const result of found.values()) {
    let details = result.description || "New page discovered in web search.";
    try {
      const response = await fetch(result.url, { headers: { "User-Agent": "CompetitorRadar/0.1 (public market research)", Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (response.ok) { const content = extractContent(await boundedText(response, 1_000_000)); if (content.length > 80) details = content.slice(0, 6000); }
    } catch (error) { errors.push(`${competitor.name} discovered page ${result.url}: ${message(error)}`); }
    evidence.push({ kind: "web_discovery", title: result.title, url: result.url, details });
    state.seen.push({ url: result.url, title: result.title, first_seen: new Date().toISOString().slice(0, 10) });
  }
  await env.STATE.put(key, JSON.stringify(state, null, 2));
  return { evidence, errors };
}

async function searchWeb(env: Env, query: string, limit: number, configuredProvider: string): Promise<SearchResult[]> {
  const response = await env.AI.websearch({
    gatewayId: env.CLOUDFLARE_AI_GATEWAY_ID || "default",
    query,
    provider: env.CLOUDFLARE_SEARCH_PROVIDER || configuredProvider,
    limit,
  });
  if (!response.ok) throw new Error(`Cloudflare Web Search returned HTTP ${response.status}`);
  const body = await response.json() as { items?: SearchResult[] };
  return (body.items || []).filter((item) => typeof item.url === "string" && typeof item.title === "string");
}

async function analyzeCompetitor(env: Env, competitor: Competitor, evidence: Evidence[]): Promise<Analysis> {
  if (!evidence.length) return { competitor: competitor.name, summary: "No new competitor activity detected.", signals: [] };
  const schema = { type: "object", additionalProperties: false, required: ["competitor", "summary", "signals"], properties: {
    competitor: { type: "string" }, summary: { type: "string" }, signals: { type: "array", items: { type: "object", additionalProperties: false, required: ["category", "headline", "verified", "analysis", "source_urls"], properties: {
      category: { type: "string", enum: categories }, headline: { type: "string" }, verified: { type: "string" }, analysis: { type: "string" }, source_urls: { type: "array", items: { type: "string" } },
    } } },
  } };
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000), body: JSON.stringify({
    model: env.OPENAI_MODEL || "gpt-4.1-mini", instructions: systemPrompt, input: JSON.stringify({ competitor: competitor.name, evidence }),
    text: { format: { type: "json_schema", name: "competitor_analysis", strict: true, schema } },
  }) });
  if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`);
  const body = await response.json() as { output_text?: string; output?: { content?: { text?: string }[] }[] };
  const output = body.output_text || body.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text;
  if (!output) throw new Error("OpenAI response did not contain output text");
  let parsed: Analysis; try { parsed = JSON.parse(output) as Analysis; } catch { throw new Error("OpenAI returned malformed analysis JSON"); }
  if (!Array.isArray(parsed.signals) || typeof parsed.summary !== "string") throw new Error("OpenAI returned an invalid analysis object");
  return { ...parsed, competitor: competitor.name, signals: mergeSignals(parsed.signals) };
}

function extractContent(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,iframe,template,canvas,head,nav,footer,[hidden],[aria-hidden='true'],[role='navigation'],[role='dialog'],[class*='cookie' i],[id*='cookie' i],[class*='consent' i],[class*='modal' i],[class*='tracking' i],[class*='analytics' i]").remove();
  const area = $("main").length ? $("main") : $("body"); const output: string[] = [];
  area.find("h1,h2,h3,h4,p,li,td,th,button,a,blockquote,time").each((_, element) => {
    const node = $(element); if (node.parents("nav,footer,header").length) return;
    const text = node.text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 2 || /^(home|menu|navigation|skip to content|cookie preferences|accept all|privacy policy|terms of service|all rights reserved|subscribe|log in|sign in|contact us|read more)$/i.test(text)) return;
    if (node.is("a") && text.length < 4) return;
    const line = `${node.is("h1") ? "# " : node.is("h2") ? "## " : node.is("h3,h4") ? "### " : ""}${text}`;
    if (output.at(-1) !== line && !output.includes(line)) output.push(line);
  });
  return output.join("\n\n").trim();
}

function semanticDiff(before: string, after: string): string {
  const oldLines = [...new Set(before.split(/\n+/).map((line) => line.trim()).filter(Boolean))];
  const newLines = [...new Set(after.split(/\n+/).map((line) => line.trim()).filter(Boolean))];
  const removed = oldLines.filter((line) => !newLines.includes(line)); const added = newLines.filter((line) => !oldLines.includes(line));
  const used = new Set<string>(); const changed: string[] = [];
  for (const oldLine of removed) {
    const match = added.find((line) => !used.has(line) && wordSimilarity(oldLine, line) >= 0.42);
    if (match) { used.add(match); changed.push(`Before: ${oldLine}\nAfter: ${match}`); }
  }
  const unmatchedOld = removed.filter((line) => !changed.some((pair) => pair.startsWith(`Before: ${line}\n`)));
  const unmatchedNew = added.filter((line) => !used.has(line));
  if (unmatchedOld.length === unmatchedNew.length) unmatchedOld.forEach((line, index) => { used.add(unmatchedNew[index]); changed.push(`Before: ${line}\nAfter: ${unmatchedNew[index]}`); });
  const remainingAdded = added.filter((line) => !used.has(line)).map((line) => `Added: ${line}`);
  const remainingRemoved = removed.filter((line) => !changed.some((pair) => pair.startsWith(`Before: ${line}\n`))).map((line) => `Removed: ${line}`);
  return [...changed, ...remainingAdded, ...remainingRemoved].join("\n");
}
function wordSimilarity(a: string, b: string) { const words = (value: string) => new Set(value.toLowerCase().replace(/[^\p{L}\p{N}$€£.]+/gu, " ").split(/\s+/).filter((word) => word.length > 2)); const x = words(a), y = words(b); return x.size && y.size ? [...x].filter((word) => y.has(word)).length / Math.max(x.size, y.size) : 0; }

function mergeSignals(signals: Signal[]) {
  const merged = new Map<string, Signal>();
  for (const signal of signals) { const key = signal.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); const prior = merged.get(key); if (!prior) merged.set(key, signal); else { prior.source_urls = [...new Set([...prior.source_urls, ...signal.source_urls])]; prior.verified += ` ${signal.verified}`; } }
  return [...merged.values()];
}
function formatReport(analyses: Analysis[]) {
  const active = analyses.filter((item) => item.signals.length); const date = new Date().toISOString().slice(0, 10);
  const lines = [`# Competitor Radar — ${date}`, "", `${active.length} ${active.length === 1 ? "competitor had" : "competitors had"} updates today.`, ""];
  for (const item of active) { lines.push(`## ${item.competitor.toUpperCase()}`, "", item.summary, ""); for (const signal of item.signals) lines.push(`### ${signal.headline}`, "", `**Category:** ${signal.category}`, "", `**Verified**  \n${signal.verified}`, "", `**Analysis**  \n${signal.analysis}`, "", `**Sources:** ${signal.source_urls.map((url) => `[${url}](${url})`).join(" · ")}`, ""); }
  return `${lines.join("\n").trim()}\n`;
}
async function sendSlack(env: Env, analyses: Analysis[], date: string) {
  const active = analyses.filter((item) => item.signals.length); if (!active.length) return;
  const header: Record<string, unknown> = { type: "section", text: { type: "mrkdwn", text: `*Competitor Radar*\n${date}` } };
  const chunks: Record<string, unknown>[][] = []; let blocks: Record<string, unknown>[] = [header];
  for (const item of active) {
    const competitorBlock: Record<string, unknown> = { type: "section", text: { type: "mrkdwn", text: `*${slackText(item.competitor.toUpperCase())}*\n${slackText(item.summary)}` } };
    if (blocks.length + 1 > 48) { chunks.push(blocks); blocks = [header]; }
    blocks.push(competitorBlock);
    for (const signal of item.signals) {
      if (blocks.length + 2 > 48) { chunks.push(blocks); blocks = [header, competitorBlock]; }
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${slackText(signal.headline)}*  _${slackText(signal.category)}_\n*Verified*\n${slackText(signal.verified)}\n*Analysis*\n${slackText(signal.analysis)}\n${signal.source_urls.map((url) => `<${url}|Source>`).join(" · ")}` } }, { type: "divider" });
    }
  }
  if (blocks.length > 1) chunks.push(blocks);
  for (const chunk of chunks) { const response = await fetch(env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `Competitor Radar — ${date}`, blocks: chunk }), signal: AbortSignal.timeout(20_000) }); if (!response.ok) throw new Error(`Slack returned HTTP ${response.status}`); }
}
function slackText(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function canonicalUrl(value: string) { const url = new URL(value); url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(key)) url.searchParams.delete(key); url.searchParams.sort(); if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, ""); return url.toString(); }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function boundedText(response: Response, maxBytes: number) { const declared = Number(response.headers.get("content-length") || 0); if (declared > maxBytes) throw new Error(`response exceeds ${maxBytes} byte extraction limit`); const reader = response.body?.getReader(); if (!reader) return ""; const chunks: Uint8Array[] = []; let size = 0; while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error(`response exceeds ${maxBytes} byte extraction limit`); } chunks.push(value); } const joined = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; } return new TextDecoder().decode(joined); }
function authorized(request: Request, expected: string) { const actual = request.headers.get("authorization") || ""; const supplied = actual.startsWith("Bearer ") ? actual.slice(7) : ""; if (!expected || supplied.length !== expected.length) return false; let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i); return diff === 0; }

const systemPrompt = `You are competitor-analysis-agent, one evidence-grounded analyst. Identify genuine competitor product, marketing, pricing, company, or go-to-market changes. Report every substantive signal, including small legitimate changes. Ignore technical noise and merge duplicate announcements. In verified, state only facts directly supported by evidence. In analysis, clearly label interpretations and use cautious language. Never invent facts or source URLs. Do not score or rank.`;
