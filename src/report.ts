import type { CompetitorAnalysis } from "./types.js";
import { today, writeText } from "./utils.js";

export function formatReport(analyses: CompetitorAnalysis[], date = today()): string {
  const active = analyses.filter((item) => item.signals.length);
  const count = active.length; const lines = [`# Competitor Radar — ${date}`, "", `${count} ${count === 1 ? "competitor had" : "competitors had"} updates today.`, ""];
  for (const analysis of active) {
    lines.push(`## ${analysis.competitor.toUpperCase()}`, "", analysis.summary, "");
    for (const signal of analysis.signals) {
      lines.push(`### ${signal.headline}`, "", `**Category:** ${signal.category}`, "", `**Verified**  \n${signal.verified}`, "", `**Analysis**  \n${signal.analysis}`, "", `**Sources:** ${signal.source_urls.map((url) => `[${url}](${url})`).join(" · ")}`, "");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}
export async function saveReport(analyses: CompetitorAnalysis[], date = today()) {
  if (!analyses.some((item) => item.signals.length)) return null;
  const file = `reports/${date}.md`; await writeText(file, formatReport(analyses, date)); return file;
}
