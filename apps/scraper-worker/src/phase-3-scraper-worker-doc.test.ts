import { describe, expect, it } from "bun:test";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

const phase3DocPath = join(
  import.meta.dir,
  "../../../tasks/phase-3-scraper-worker.md"
);

const scraperWorkerSrcPath = join(import.meta.dir);

describe("phase 3 scraper worker folder layout documentation", () => {
  it("defines folder layout section", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("## Folder Layout");
    expect(content).toContain("apps/scraper-worker/src/");
  });

  it("documents module folders and key files", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("bootstrap/");
    expect(content).toMatch(/bootstrap\/\s*\n.*index\.ts/);
    expect(content).toContain("settings.ts");
    expect(content).toContain("jobs/");
    expect(content).toContain("page-fetch.ts");
    expect(content).toContain("fetch/");
    expect(content).toContain("http.ts");
    expect(content).toContain("playwright.ts");
    expect(content).toContain("firecrawl.ts");
    expect(content).toContain("selection.ts");
    expect(content).toContain("browser/");
    expect(content).toContain("pool.ts");
    expect(content).toContain("services/");
    expect(content).toContain("content-validation.ts");
    expect(content).toContain("fairness-slots.ts");
  });

  it("includes file mapping from current to proposed", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### File Mapping from Current to Proposed");
    expect(content).toContain("| Current Location | Proposed Location |");
    expect(content).toContain("`index.ts`");
    expect(content).toContain("`bootstrap/settings.ts`");
    expect(content).toContain("`browser/pool.ts`");
    expect(content).toContain("`jobs/page-fetch.ts`");
    expect(content).toContain("`processors/page-fetch.ts`");
  });

  it("documents module responsibilities", async () => {
    const content = await readFile(phase3DocPath, "utf-8");

    expect(content).toContain("### Module Responsibilities");
    expect(content).toContain("**bootstrap/**");
    expect(content).toContain("**jobs/**");
    expect(content).toContain("**fetch/**");
    expect(content).toContain("**browser/**");
    expect(content).toContain("**services/**");
  });
});

describe("scraper worker current structure verification", () => {
  it("has index.ts entrypoint", async () => {
    const files = await readdir(scraperWorkerSrcPath);
    expect(files).toContain("index.ts");
  });

  it("has processors folder with page-fetch.ts", async () => {
    const files = await readdir(scraperWorkerSrcPath);
    expect(files).toContain("processors");

    const processorFiles = await readdir(join(scraperWorkerSrcPath, "processors"));
    expect(processorFiles).toContain("page-fetch.ts");
  });
});
