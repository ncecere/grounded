import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const scraperFetchDocPath = join(
  import.meta.dir,
  "../../../docs/refactor/scraper-fetch.md"
);

describe("scraper fetch documentation", () => {
  it("documents the fetch flow", async () => {
    const content = await readFile(scraperFetchDocPath, "utf-8");

    expect(content).toContain("## Fetch Flow");
    expect(content).toContain("`page-fetch`");
    expect(content).toContain("`fetch` job");
    expect(content).toContain("withFairnessSlotOrThrow");
    expect(content).toContain("selectAndFetch");
    expect(content).toContain("storeFetchedHtml");
    expect(content).toContain("StageTransitionJob");
  });

  it("documents decision rules", async () => {
    const content = await readFile(scraperFetchDocPath, "utf-8");

    expect(content).toContain("## Decision Rules");
    expect(content).toContain("fetchMode = firecrawl");
    expect(content).toContain("fetchMode = auto");
    expect(content).toContain("fetchMode = headless");
    expect(content).toContain("Playwright fallback");
    expect(content).toContain("needsJsRendering");
  });

  it("documents strategy details", async () => {
    const content = await readFile(scraperFetchDocPath, "utf-8");

    expect(content).toContain("## Strategy Details");
    expect(content).toContain("SCRAPE_TIMEOUT_MS");
    expect(content).toContain("MAX_PAGE_SIZE_BYTES");
    expect(content).toContain("Content-Length");
    expect(content).toContain("isContentTypeEnforcementEnabled()");
    expect(content).toContain("networkidle");
    expect(content).toContain("FIRECRAWL_API_KEY");
    expect(content).toContain("/v1/scrape");
  });
});
