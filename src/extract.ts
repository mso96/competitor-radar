import * as cheerio from "cheerio";
const boilerplate = /^(home|menu|navigation|skip to content|cookie preferences|accept all|privacy policy|terms of service|all rights reserved|subscribe|log in|sign in|contact us|read more)$/i;
export function extractContent(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, template, canvas, head, nav, footer, [hidden], [aria-hidden='true'], [role='navigation'], [role='dialog'], [class*='cookie' i], [id*='cookie' i], [class*='consent' i], [class*='modal' i], [class*='tracking' i], [class*='analytics' i]").remove();
  const candidates = $("main").length ? $("main") : $("body"); const lines: string[] = [];
  candidates.find("h1,h2,h3,h4,p,li,td,th,button,a,blockquote,time").each((_, element) => {
    const el = $(element); if (el.parents("nav,footer,header").length) return;
    const text = el.text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 2 || boilerplate.test(text) || (el.is("a") && text.length < 4)) return;
    const line = `${el.is("h1") ? "# " : el.is("h2") ? "## " : el.is("h3,h4") ? "### " : ""}${text}`;
    if (lines.at(-1) !== line && !lines.includes(line)) lines.push(line);
  });
  return lines.join("\n\n").trim();
}
