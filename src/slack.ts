import type { CompetitorAnalysis } from "./types.js";
import { today } from "./utils.js";

export function formatSlackMessages(analyses: CompetitorAnalysis[], date = today()): unknown[] {
  const active = analyses.filter((item) => item.signals.length); if (!active.length) return [];
  const header = `*Competitor Radar*\n${date}`;
  const messages: { text: string; blocks: unknown[] }[] = []; let sections: unknown[] = [];
  for (const competitor of active) {
    const competitorHeader = { type: "section", text: { type: "mrkdwn", text: `*${escapeSlack(competitor.competitor.toUpperCase())}*\n${escapeSlack(competitor.summary)}` } };
    const parts: unknown[] = [competitorHeader];
    for (const signal of competitor.signals) {
      const sources = signal.source_urls.map((url) => `<${url}|Source>`).join(" · ");
      parts.push({ type: "section", text: { type: "mrkdwn", text: `*${escapeSlack(signal.headline)}*  _${escapeSlack(signal.category)}_\n*Verified*\n${escapeSlack(signal.verified)}\n*Analysis*\n${escapeSlack(signal.analysis)}\n${sources}` } }, { type: "divider" });
    }
    if (sections.length + parts.length > 45) { messages.push(message(header, sections)); sections = []; }
    sections.push(...parts);
  }
  if (sections.length) messages.push(message(header, sections));
  return messages;
}
function message(header: string, sections: unknown[]) { return { text: header, blocks: [{ type: "section", text: { type: "mrkdwn", text: header } }, ...sections] }; }
function escapeSlack(text: string) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export async function sendSlackDigest(analyses: CompetitorAnalysis[]) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) throw new Error("SLACK_WEBHOOK_URL is not configured");
  const messages = formatSlackMessages(analyses); if (!messages.length) return 0;
  for (const payload of messages) {
    const response = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Slack webhook returned HTTP ${response.status}`);
  }
  return messages.length;
}
