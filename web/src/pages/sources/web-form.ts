import { type Schemas } from "../../api/client";
import { plural } from "../team/common";
import { type MapRequest, type WebConfig, type WebConfigInput } from "./owner";

export type WebMode = Schemas["WebMode"];

export type WebSchedule = Schemas["WebSchedule"];

export const modeLabels: Record<WebMode, string> = { scrape: "Single page", batch: "List of pages", crawl: "Crawl a site" };

export const scheduleLabels: Record<WebSchedule, string> = { manual: "Manual only", daily: "Daily", weekly: "Weekly" };

/** The form's values, as typed (numbers and lists stay strings until submitted). */
export type WebFormState = {
  mode: WebMode;
  /** One URL per line (a single line for scrape). */
  urls: string;
  maxDepth: string;
  maxPages: string;
  /** One per line. */
  includePrefixes: string;
  exclude: string;
  allowSubdomains: boolean;
  useSitemaps: boolean;
  schedule: WebSchedule;
  /** Tags applied to every page (used by metadata filters). */
  tags: string[];
};

export const webDefaults: WebFormState = {
  mode: "crawl",
  urls: "",
  maxDepth: "2",
  maxPages: "200",
  includePrefixes: "",
  exclude: "",
  allowSubdomains: false,
  useSitemaps: true,
  schedule: "weekly",
  tags: [],
};

export const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** Adds https:// when the scheme is missing, so "registrar.example.edu" works. */
export const withScheme = (url: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);

export function webFormFromConfig(c: WebConfig): WebFormState {
  const crawl = c.mode === "crawl";
  return {
    mode: c.mode,
    urls: c.urls.join("\n"),
    // Crawl-only settings are zero for scrape and batch; keep the defaults for them.
    maxDepth: crawl ? String(c.maxDepth) : webDefaults.maxDepth,
    maxPages: crawl ? String(c.maxPages) : webDefaults.maxPages,
    includePrefixes: crawl ? c.includePrefixes.join("\n") : "",
    exclude: crawl ? c.exclude.join("\n") : "",
    allowSubdomains: crawl ? c.allowSubdomains : false,
    useSitemaps: crawl ? c.useSitemaps : true,
    schedule: c.schedule,
    tags: c.tags ?? [],
  };
}

/** The URLs the form would submit. */
export function formUrls(f: WebFormState) {
  const list = lines(f.urls).map(withScheme);
  return f.mode === "scrape" ? list.slice(0, 1) : list;
}

/** The API body for the form's values (only the settings that apply to the mode). */
export function webInput(f: WebFormState): WebConfigInput {
  const urls = formUrls(f);
  // tags are always sent: the API replaces the whole configuration, so omitting them would clear them.
  if (f.mode !== "crawl") return { mode: f.mode, urls, schedule: f.schedule, tags: f.tags };
  return {
    mode: "crawl",
    urls,
    maxDepth: Number(f.maxDepth),
    maxPages: Number(f.maxPages),
    includePrefixes: lines(f.includePrefixes),
    exclude: lines(f.exclude),
    allowSubdomains: f.allowSubdomains,
    useSitemaps: f.useSitemaps,
    schedule: f.schedule,
    tags: f.tags,
  };
}

export type WebErrors = Partial<Record<"urls" | "maxDepth" | "maxPages", string>>;

const urlLimits: Record<WebMode, number> = { scrape: 1, batch: 1000, crawl: 20 };

function badUrl(url: string) {
  try {
    const u = new URL(withScheme(url));
    return !(u.protocol === "http:" || u.protocol === "https:") || !u.hostname.includes(".");
  } catch {
    return true;
  }
}

/** Client-side checks mirroring the API's (§1 of the spec). The server re-checks everything, including the allowlist. */
export function validateWeb(f: WebFormState): WebErrors {
  const errors: WebErrors = {};
  const list = f.mode === "scrape" ? lines(f.urls).slice(0, 1) : lines(f.urls);
  const bad = list.filter(badUrl);
  if (list.length === 0) errors.urls = f.mode === "crawl" ? "Enter at least one start URL." : f.mode === "batch" ? "Enter at least one URL." : "Enter a URL.";
  else if (bad.length > 0) errors.urls = `Not a valid web address: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ` and ${bad.length - 3} more` : ""}.`;
  else if (list.length > urlLimits[f.mode]) errors.urls = `Enter at most ${urlLimits[f.mode].toLocaleString()} URLs (you entered ${list.length.toLocaleString()}).`;
  if (f.mode === "crawl") {
    const depth = Number(f.maxDepth);
    if (f.maxDepth.trim() === "" || !Number.isInteger(depth) || depth < 0 || depth > 10) errors.maxDepth = "Enter a whole number from 0 to 10.";
    const pages = Number(f.maxPages);
    if (f.maxPages.trim() === "" || !Number.isInteger(pages) || pages < 1) errors.maxPages = "Enter a whole number of at least 1.";
  }
  return errors;
}

/** A one-line description of a web configuration, e.g. "Crawl a site · depth 2 · up to 200 pages". */
export function describeWeb(c: Pick<WebConfig, "mode" | "urls" | "maxDepth" | "maxPages">) {
  if (c.mode === "scrape") return "Single page";
  if (c.mode === "batch") return `List of ${plural(c.urls.length, "page")}`;
  return `Crawl a site · depth ${c.maxDepth} · up to ${plural(c.maxPages, "page")}`;
}

export function advancedSummary(f: WebFormState) {
  return [`Depth ${f.maxDepth || "?"}`, `up to ${f.maxPages || "?"} pages`, f.useSitemaps ? "sitemaps on" : "sitemaps off", f.allowSubdomains ? "subdomains on" : null]
    .filter(Boolean)
    .join(" · ");
}

/* ---------------- map preview ---------------- */

export function mapRequest(f: WebFormState): MapRequest | null {
  const url = formUrls(f)[0];
  if (!url || badUrl(url)) return null;
  const pages = Number(f.maxPages);
  return {
    url,
    useSitemaps: f.useSitemaps,
    limit: Math.min(Number.isInteger(pages) && pages > 0 ? pages : 500, 2000),
    includePrefixes: lines(f.includePrefixes),
    exclude: lines(f.exclude),
    allowSubdomains: f.allowSubdomains,
  };
}
