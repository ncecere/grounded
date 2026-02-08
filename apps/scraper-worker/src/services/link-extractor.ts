/**
 * Link Extractor Service
 * 
 * Extracts and filters links from HTML content for domain crawling.
 * Used by the page-fetch processor to discover new URLs during domain crawl mode.
 */

import * as cheerio from "cheerio";
import { log } from "@grounded/logger";

// File extensions that are not web pages — skip these during crawling
const NON_PAGE_EXTENSIONS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp", ".tiff", ".avif",
  // Styles & Scripts
  ".css", ".js", ".mjs", ".cjs", ".map",
  // Fonts
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  // Archives
  ".zip", ".tar", ".gz", ".rar", ".7z",
  // Media
  ".mp4", ".mp3", ".avi", ".mov", ".wmv", ".flv", ".webm", ".ogg", ".wav",
  // Documents (we could crawl these but they need special handling)
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  // Data
  ".json", ".xml", ".csv", ".rss", ".atom",
  // Other
  ".exe", ".dmg", ".apk", ".deb", ".rpm",
]);

// Protocols that are not crawlable
const SKIP_PROTOCOLS = new Set([
  "mailto:", "tel:", "javascript:", "data:", "ftp:", "ssh:", "file:", "telnet:",
  "blob:", "about:", "chrome:", "edge:", "moz-extension:",
]);

/**
 * Extract all links from an HTML document and resolve them to absolute URLs.
 * 
 * @param html - The raw HTML content
 * @param pageUrl - The URL of the page (used to resolve relative URLs)
 * @returns Array of unique absolute URLs found in the page
 */
export function extractLinksFromHTML(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const trimmed = href.trim();
    if (!trimmed || trimmed === "#") return;

    // Skip non-HTTP protocols
    const lowerHref = trimmed.toLowerCase();
    for (const protocol of SKIP_PROTOCOLS) {
      if (lowerHref.startsWith(protocol)) return;
    }

    // Skip fragment-only links
    if (trimmed.startsWith("#")) return;

    try {
      // Resolve relative URLs against the page URL
      const resolved = new URL(trimmed, pageUrl);

      // Strip fragment
      resolved.hash = "";

      // Only keep http/https URLs
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;

      // Skip non-page file extensions
      const pathname = resolved.pathname.toLowerCase();
      const lastDot = pathname.lastIndexOf(".");
      if (lastDot > pathname.lastIndexOf("/")) {
        const ext = pathname.slice(lastDot);
        if (NON_PAGE_EXTENSIONS.has(ext)) return;
      }

      links.add(resolved.href);
    } catch {
      // Invalid URL, skip silently
    }
  });

  return Array.from(links);
}

/**
 * Filter links to only include those on the same domain as the seed URL.
 * 
 * @param links - Array of absolute URLs
 * @param seedUrl - The original seed URL for the domain crawl
 * @param includeSubdomains - Whether to include subdomains (e.g., docs.example.com when seed is example.com)
 * @returns Array of URLs that are on the same domain
 */
export function filterLinksByDomain(
  links: string[], 
  seedUrl: string,
  includeSubdomains: boolean = false
): string[] {
  let seedHost: string;
  try {
    seedHost = new URL(seedUrl).hostname.toLowerCase();
  } catch {
    return [];
  }

  return links.filter((link) => {
    try {
      const linkHost = new URL(link).hostname.toLowerCase();
      
      if (linkHost === seedHost) return true;
      
      if (includeSubdomains) {
        // Check if the link host is a subdomain of the seed host
        // e.g., "docs.example.com" ends with ".example.com"
        return linkHost.endsWith(`.${seedHost}`);
      }
      
      return false;
    } catch {
      return false;
    }
  });
}

/**
 * Filter links by include/exclude glob patterns.
 * Replicates the same pattern matching logic used in source-discover.ts.
 * 
 * @param links - Array of absolute URLs
 * @param includePatterns - Glob patterns that URLs must match (if any are specified)
 * @param excludePatterns - Glob patterns that URLs must NOT match
 * @returns Array of URLs that pass the pattern filters
 */
export function filterLinksByPatterns(
  links: string[],
  includePatterns: string[] = [],
  excludePatterns: string[] = []
): string[] {
  if (includePatterns.length === 0 && excludePatterns.length === 0) {
    return links;
  }

  return links.filter((link) => {
    try {
      const urlPath = new URL(link).pathname;

      // Check exclude patterns first
      if (excludePatterns.length > 0) {
        for (const pattern of excludePatterns) {
          if (matchPattern(urlPath, pattern)) {
            return false;
          }
        }
      }

      // Check include patterns (must match at least one if any are specified)
      if (includePatterns.length > 0) {
        let matches = false;
        for (const pattern of includePatterns) {
          if (matchPattern(urlPath, pattern)) {
            matches = true;
            break;
          }
        }
        return matches;
      }

      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Glob pattern matcher for URL paths.
 * Converts glob syntax to regex:
 *   ** -> match anything (including /)
 *   *  -> match anything except /
 *   ?  -> match single character
 * 
 * Identical to the matchPattern() function in source-discover.ts.
 */
function matchPattern(path: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") +
      "$"
  );
  return regex.test(path);
}

/**
 * Full link discovery pipeline for domain crawling.
 * Extracts links from HTML, filters by domain, patterns, and depth.
 * 
 * @param html - Raw HTML content of the fetched page
 * @param pageUrl - URL of the fetched page  
 * @param seedUrl - Original seed URL for the domain crawl
 * @param config - Source configuration with patterns and settings
 * @param currentDepth - Current crawl depth (0-based)
 * @returns Array of new absolute URLs to crawl
 */
export function discoverLinks(
  html: string,
  pageUrl: string,
  seedUrl: string,
  config: {
    depth: number;
    includePatterns?: string[];
    excludePatterns?: string[];
    includeSubdomains?: boolean;
  },
  currentDepth: number
): string[] {
  // Depth gate: don't discover new links if we're already at max depth
  if (currentDepth >= config.depth) {
    log.debug("scraper-worker", "At max crawl depth, skipping link discovery", {
      pageUrl,
      currentDepth,
      maxDepth: config.depth,
    });
    return [];
  }

  // Step 1: Extract raw links from HTML
  const rawLinks = extractLinksFromHTML(html, pageUrl);

  // Step 2: Filter by domain
  const domainLinks = filterLinksByDomain(rawLinks, seedUrl, config.includeSubdomains ?? false);

  // Step 3: Filter by include/exclude patterns
  const filteredLinks = filterLinksByPatterns(
    domainLinks,
    config.includePatterns ?? [],
    config.excludePatterns ?? []
  );

  log.debug("scraper-worker", "Link discovery results", {
    pageUrl,
    rawLinks: rawLinks.length,
    afterDomainFilter: domainLinks.length,
    afterPatternFilter: filteredLinks.length,
    currentDepth,
    maxDepth: config.depth,
  });

  return filteredLinks;
}
