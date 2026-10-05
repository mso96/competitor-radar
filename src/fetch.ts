export interface FetchPageResult { html: string; status: number; rendered: boolean }
export async function fetchPage(url: string): Promise<FetchPageResult> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "CompetitorRadar/0.1 (+https://github.com/open-source/competitor-radar; monitoring public pages)", Accept: "text/html,application/xhtml+xml" } });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const html = await response.text();
    if (html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length >= 1200) return { html, status: response.status, rendered: false };
    const rendered = await renderWithPlaywright(url);
    return rendered ? { html: rendered, status: response.status, rendered: true } : { html, status: response.status, rendered: false };
  } catch (error) { if ((error as Error).name === "AbortError") throw new Error("request timed out after 20 seconds"); throw error; }
  finally { clearTimeout(timer); }
}
async function renderWithPlaywright(url: string): Promise<string | null> {
  try {
    const { chromium } = await import("playwright"); const browser = await chromium.launch({ headless: true });
    try { const page = await browser.newPage(); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }); await page.waitForTimeout(1500); return await page.content(); }
    finally { await browser.close(); }
  } catch { return null; }
}
