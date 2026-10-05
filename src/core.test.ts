import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractContent } from "./extract.js";
import { semanticDiff } from "./diff.js";
import { monitorCompetitor } from "./monitor.js";
import { canonicalUrl } from "./utils.js";
import { parseSearchResults, searchWeb } from "./search.js";
import { extractOutputText, analyzeCompetitor } from "./analysis-agent.js";
import { formatSlackMessages, sendSlackDigest } from "./slack.js";
import type { Competitor, CompetitorAnalysis } from "./types.js";

const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
test("extracts meaningful content and removes scripts, navigation, cookie and footer noise", async () => {
  const content = extractContent(await fixture("homepage-after.html"));
  assert.match(content, /AI-powered work for modern teams/); assert.match(content, /new AI assistant/);
  assert.doesNotMatch(content, /analytics|cookie|Copyright|Privacy Policy|Home/);
});
test("semantic pricing diff preserves a real price change", async () => {
  const before = extractContent(await fixture("pricing-before.html")); const after = extractContent(await fixture("pricing-after.html"));
  const diff = semanticDiff(before, after);
  assert.ok(diff.changed.some((line) => line.includes("Contact sales") && line.includes("$49/month")));
});
test("monitor's first run saves a baseline; second run detects the content change", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "radar-"));
  try {
    const competitor: Competitor = { name: "Fixture Co", domain: "example.com", pages: { homepage: "https://example.com" } };
    const before = await fixture("homepage-before.html"), after = await fixture("homepage-after.html");
    const baseline = await monitorCompetitor(competitor, root, async () => ({ html: before, status: 200, rendered: false }));
    assert.equal(baseline.evidence.length, 0); assert.deepEqual(baseline.checked, ["homepage"]);
    const second = await monitorCompetitor(competitor, root, async () => ({ html: after, status: 200, rendered: false }));
    assert.equal(second.evidence.length, 1); assert.match(second.evidence[0].details, /AI-powered work/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("canonical URLs drop trackers and fragments", () => assert.equal(canonicalUrl("https://EXAMPLE.com/post/?utm_source=x&id=2#top"), "https://example.com/post?id=2"));
test("Cloudflare results normalize from official items response shape", () => {
  assert.deepEqual(parseSearchResults({ items: [{ title: "Launch", url: "https://example.com", description: "Announced" }] }), [{ title: "Launch", url: "https://example.com", description: "Announced" }]);
});
test("Cloudflare Web Search request works against a mocked response", async () => {
  const previousFetch = globalThis.fetch; const oldAccount = process.env.CLOUDFLARE_ACCOUNT_ID; const oldToken = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = "mock-account"; process.env.CLOUDFLARE_API_TOKEN = "mock-token"; let requestBody: any;
  globalThis.fetch = (async (input: any, init?: RequestInit) => { assert.match(String(input), /accounts\/mock-account\/ai\/websearch/); requestBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ items: [{ title: "Launch", url: "https://example.com/launch" }] }), { status: 200 }); }) as typeof fetch;
  try { const results = await searchWeb("Acme launch", 5, "ceramic"); assert.equal(results[0].title, "Launch"); assert.equal(requestBody.options.gateway.id, "default"); assert.equal(requestBody.provider, "ceramic"); }
  finally { globalThis.fetch = previousFetch; if (oldAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = oldAccount; if (oldToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = oldToken; }
});
test("OpenAI output text parsing handles Responses API content", () => {
  assert.equal(extractOutputText({ output: [{ content: [{ type: "output_text", text: "{\\\"ok\\\":true}" }] }] }), "{\\\"ok\\\":true}");
});
test("analysis request uses one structured OpenAI response and parses mocked result", async () => {
  const previousFetch = globalThis.fetch; const oldKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "mock-key";
  const parsed: CompetitorAnalysis = { competitor: "Acme", summary: "A change was found.", signals: [{ category: "pricing", headline: "New price", verified: "Growth is $49/month.", analysis: "Analysis: this may simplify self-serve buying.", source_urls: ["https://example.com/pricing"] }] };
  let requestBody: any;
  globalThis.fetch = (async (_input: any, init?: RequestInit) => { requestBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ output_text: JSON.stringify(parsed) }), { status: 200 }); }) as typeof fetch;
  try {
    const result = await analyzeCompetitor({ name: "Acme", domain: "example.com", pages: {} }, [{ kind: "page_change", title: "pricing changed", url: "https://example.com/pricing", details: "Before: Contact sales\nAfter: $49/month" }]);
    assert.equal(result.signals.length, 1); assert.equal(requestBody.text.format.type, "json_schema"); assert.equal(requestBody.instructions.includes("single evidence-grounded analyst"), true);
  } finally { globalThis.fetch = previousFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; }
});
test("Slack digest formatting and mocked webhook send", async () => {
  const analysis: CompetitorAnalysis = { competitor: "Acme", summary: "One update.", signals: [{ category: "product", headline: "New feature", verified: "Feature launched.", analysis: "Analysis: may expand use cases.", source_urls: ["https://example.com/news"] }] };
  const payload = formatSlackMessages([analysis], "2026-10-05"); assert.equal(payload.length, 1); assert.match(JSON.stringify(payload[0]), /Verified/);
  const previousFetch = globalThis.fetch; const oldWebhook = process.env.SLACK_WEBHOOK_URL; process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/mock"; let sent = 0;
  globalThis.fetch = (async () => { sent++; return new Response("ok", { status: 200 }); }) as typeof fetch;
  try { assert.equal(await sendSlackDigest([analysis]), 1); assert.equal(sent, 1); }
  finally { globalThis.fetch = previousFetch; if (oldWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL; else process.env.SLACK_WEBHOOK_URL = oldWebhook; }
});
