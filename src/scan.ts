import "dotenv/config";
import { loadConfig } from "./config.js";
import { monitorCompetitor } from "./monitor.js";
import { discoverCompetitor } from "./discover.js";
import { analyzeCompetitor } from "./analysis-agent.js";
import { saveReport } from "./report.js";
import { sendSlackDigest } from "./slack.js";
import type { CompetitorAnalysis, Evidence } from "./types.js";

async function main() {
  const mode = process.argv[2] ?? "scan";
  if (mode === "--help" || mode === "-h") { console.log("Usage: npm run scan | npm run monitor | npm run discover"); return; }
  if (!(["scan", "monitor", "discover"].includes(mode))) throw new Error(`Unknown command: ${mode}`);
  const config = await loadConfig(process.env.RADAR_CONFIG || "competitors.yaml"); const errors: string[] = []; const analyses: CompetitorAnalysis[] = [];
  console.log("Competitor Radar\n");
  for (const competitor of config.competitors) {
    const evidence: Evidence[] = [];
    if (mode !== "discover") {
      const direct = await monitorCompetitor(competitor); evidence.push(...direct.evidence); errors.push(...direct.errors);
      for (const page of direct.checked) console.log(`${competitor.name}  ✓ ${page} checked`);
    }
    if (mode !== "monitor") {
      const discovery = await discoverCompetitor(competitor, { provider: config.settings.search_provider, limit: config.settings.search_results_per_query }); evidence.push(...discovery.evidence); errors.push(...discovery.errors);
      console.log(`${competitor.name}  ✓ web discovery completed (${discovery.searches} searches)`);
    }
    try {
      const analysis = await analyzeCompetitor(competitor, evidence); analyses.push(analysis);
      console.log(`${competitor.name}  → ${analysis.signals.length ? `${analysis.signals.length} competitor signals found` : "no new activity"}`);
    } catch (error) { errors.push(`${competitor.name} analysis: ${(error as Error).message}`); }
  }
  const report = await saveReport(analyses);
  if (report) console.log(`\nReport created: ${report}`);
  if (analyses.some((item) => item.signals.length)) {
    try { const count = await sendSlackDigest(analyses); console.log(`Slack digest sent${count > 1 ? ` in ${count} parts` : ""}.`); }
    catch (error) { errors.push(`Slack: ${(error as Error).message}`); }
  }
  if (errors.length) { console.error("\nErrors:"); for (const error of errors) console.error(`- ${error}`); process.exitCode = 1; }
}
main().catch((error) => { console.error(`Competitor Radar failed: ${(error as Error).message}`); process.exitCode = 1; });
