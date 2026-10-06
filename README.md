# Competitor Radar

> An open-source competitor analysis agent that watches the web and tells you what your competitors are doing.

Competitor Radar is a small TypeScript and Node.js tool for founders and marketers. It checks the public pages you configure, discovers new activity through Cloudflare Web Search, and asks one AI analysis agent to turn the evidence into a factual, readable digest.

## What it does

- Watches competitor homepages, pricing pages, and changelogs.
- Tracks cleaned page content instead of raw HTML.
- Searches the web for new products, features, pricing, integrations, partnerships, and company activity.
- Uses one `competitor-analysis-agent` to analyse all evidence for each competitor.
- Sends one daily digest to Slack and saves the same digest as Markdown.
- Separates verified facts from analysis and does not score or rank competitors.

## Architecture

```text
Known competitor pages ─┐
                        ├─> Evidence ─> Competitor Analysis Agent ─> Slack + Markdown
Cloudflare Web Search ──┘
```

Direct monitoring creates a baseline on the first run. It reports content differences on later runs. Discovery remembers canonical URLs under `data/discovery/` so it does not re-analyse the same page every day. Similar announcements from different sources are merged by the single analysis workflow.

## Requirements

- Node.js 22 or newer and npm.
- An OpenAI API key.
- A Cloudflare API token with Account Workers AI Read and Account AI Gateway Read permissions, plus an account ID and AI Gateway.
- A Slack Incoming Webhook (optional if Slack delivery is not needed).

## Setup

1. Clone this repository and install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and add your credentials. `.env` is ignored by Git.

3. Edit `competitors.yaml`. Each competitor needs a name and domain. Homepage, pricing, and changelog URLs are optional.

4. Run a scan:

   ```sh
   npm run scan
   ```

The first scan saves page baselines and discovery URLs. Page baselines do not count as changes, though new search discoveries can still be reported on that first scan.

For local smoke runs with an alternate YAML file, set `RADAR_CONFIG=/path/to/competitors.yaml`.

### OpenAI

Create an API key in the OpenAI platform and set `OPENAI_API_KEY`. The model defaults to `gpt-4.1-mini`; override it with `OPENAI_MODEL`. Each competitor with evidence receives one structured-output request. The application uses the OpenAI Responses API directly with native `fetch`.

### Cloudflare Web Search

Set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and optionally `CLOUDFLARE_AI_GATEWAY_ID` (defaults to `default`). `CLOUDFLARE_SEARCH_PROVIDER` defaults to `ceramic`; the YAML `settings.search_provider` also documents the preferred provider. Cloudflare currently supports Ceramic, Exa, and Linkup. Search runs about seven queries per competitor with up to five results each. See [Cloudflare Web Search setup](https://developers.cloudflare.com/web-search/how-to-use/).

### Slack

Create a Slack Incoming Webhook and set `SLACK_WEBHOOK_URL`. One digest is posted per scan when signals exist. No message is sent when there are no signals. If Slack delivery fails, the Markdown report has already been written.

### GitHub Actions

The included workflow runs daily and can also be started manually. Add `OPENAI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `SLACK_WEBHOOK_URL` as repository secrets. The optional model and Cloudflare gateway/provider can be set as repository variables. The workflow commits snapshots, discovery state, and reports; its repository token needs permission to write contents.

## Cloudflare hosted version

The Worker deployment includes a small English dashboard, a daily Cron Trigger, and R2 object storage for the watchlist, snapshots, discovery state, and Markdown reports. It exposes `/health`, read-only dashboard APIs, a token-protected `POST /run` endpoint, and token-protected competitor add/remove actions. This deployment is separate from GitHub Actions, so enable only one scheduler unless you intentionally want duplicate scans.

1. Install dependencies with `npm install`, sign in with `npx wrangler login`, then run `cp .dev.vars.example .dev.vars` and fill in the three values. This file is ignored by Git and is also used to deploy encrypted Worker secrets. Cloudflare Web Search uses the Worker's AI binding, so the Worker does not need a Cloudflare API token.

2. Create an R2 bucket and deploy the Worker:

   ```sh
   npx wrangler r2 bucket create competitor-radar-state
   npm run cloud:typecheck
   npm run cloud:deploy
   ```

3. Open your deployed Worker URL to view the dashboard. Use **Add** in the Tracked competitors panel to add a company; the homepage is required and pricing/changelog URLs are optional. Changes save to the R2 watchlist and are used by subsequent scheduled scans. The first add/remove action asks for `RADAR_RUN_TOKEN`; it is kept in that browser tab only. Read access to the dashboard does not need a token. The initial list comes from `competitors.yaml` until a cloud watchlist is saved. Local CLI scans continue to use `competitors.yaml`.

4. Check deployment and run it manually:

   ```sh
   npm run cloud:dev
   curl https://YOUR-WORKER.workers.dev/health
   curl -X POST https://YOUR-WORKER.workers.dev/run -H 'Authorization: Bearer YOUR-RADAR-RUN-TOKEN'
   ```

The Cron Trigger runs daily at 07:17 UTC. Local Worker development uses `.dev.vars` (copy `.dev.vars.example`); do not commit that file. The Worker stores output objects privately in its bound R2 bucket. It extracts pages from normal HTTP responses but does not use Playwright, so JavaScript-only sites may yield less content in this deployment. Cloudflare free-tier Cron CPU limits may be too low for HTML extraction; the Wrangler config requests a 30-second CPU budget and elevated subrequest limit, which requires an eligible Workers plan. See [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [R2 Worker bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Commands

```sh
npm run scan      # direct monitoring + discovery + analysis + outputs
npm run monitor   # direct page monitoring + analysis + outputs
npm run discover  # web discovery + analysis + outputs
npm run typecheck # TypeScript check
npm test          # fixture and mocked-service tests
```

`monitor` does not call Cloudflare Web Search. `discover` does not fetch configured competitor pages. Both use the same competitor analysis agent.

## State and reports

- `snapshots/{competitor}/{page}.md` — readable content snapshots.
- `data/discovery/{competitor}.json` — canonical discovered URLs and first-seen dates.
- `reports/YYYY-MM-DD.md` — daily intelligence digest when at least one signal exists.

There is no database. Git history stores the state over time.

## Limitations

- Some sites block automated fetches; each failed page is reported while the scan continues.
- JavaScript-heavy sites can be difficult to extract. Playwright is attempted only when a normal fetch returns very little content; Chromium must be installed for that fallback.
- Search engines may not index new pages immediately, and web discovery is not exhaustive.
- LLM analysis can be wrong. Strategic interpretation is labelled as analysis and should support human judgement, not replace it.
- Tracking relies on public page text and search results, not social media or private sources.

## License

MIT. See [LICENSE](LICENSE).
