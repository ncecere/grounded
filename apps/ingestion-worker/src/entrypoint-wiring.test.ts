import { readFile } from "fs/promises";
import { join } from "path";
import { describe, it, expect } from "bun:test";

const entryPath = join(import.meta.dir, "index.ts");

describe("ingestion worker entrypoint wiring", () => {
  it("uses queues index for worker registration", async () => {
    const content = await readFile(entryPath, "utf-8");

    expect(content).toContain("from \"./queues\"");
    expect(content).toContain("registerAllWorkers");
    expect(content).toContain("allWorkers");
    expect(content).not.toContain("processors/");
  });
});
