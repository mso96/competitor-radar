export type PageType = "homepage" | "pricing" | "changelog";

export interface Competitor {
  name: string;
  domain: string;
  pages: Partial<Record<PageType, string>>;
}

export interface RadarConfig {
  company: string;
  settings: { search_provider: string; search_results_per_query: number };
  competitors: Competitor[];
}

export interface SearchResult {
  title: string;
  url: string;
  description?: string;
  lastModified?: string;
}

export interface Evidence {
  kind: "page_change" | "web_discovery";
  title: string;
  url: string;
  details: string;
}

export interface Signal {
  category: "pricing" | "positioning" | "product" | "product launch" | "feature" | "packaging" | "ICP" | "enterprise" | "integration" | "partnership" | "acquisition" | "distribution" | "messaging" | "company" | "other";
  headline: string;
  verified: string;
  analysis: string;
  source_urls: string[];
}

export interface CompetitorAnalysis {
  competitor: string;
  summary: string;
  signals: Signal[];
}
