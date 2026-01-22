import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const phase4DocPath = join(
  import.meta.dir,
  "../../../../tasks/phase-4-web-app.md"
);

describe("phase 4 web app documentation", () => {
  it("documents the API type adoption plan", async () => {
    const content = await readFile(phase4DocPath, "utf-8");

    expect(content).toContain("## API Type Adoption Plan (Phase 4 -> Phase 5)");
    expect(content).toContain("packages/shared/src/types");
    expect(content).toContain("Adoption sequence");
  });

  it("calls out sequencing to avoid double moves", async () => {
    const content = await readFile(phase4DocPath, "utf-8");

    expect(content).toContain("avoid double moves");
    expect(content).toContain("compatibility barrel");
    expect(content).toContain("shared barrel");
  });
});
