import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const today = () => new Date().toISOString().slice(0, 10);
export const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export async function ensureDir(dir: string) { await mkdir(dir, { recursive: true }); }
export async function readText(file: string) { try { return await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
export async function writeText(file: string, content: string) { await ensureDir(path.dirname(file)); await writeFile(file, content, "utf8"); }
export function canonicalUrl(value: string) {
  const url = new URL(value); url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}
