import { describe, expect, it } from "bun:test";
import type { ExpectedBehavior } from "@grounded/db/schema";
import { parseTestCaseJsonl, serializeTestCasesJsonl } from "./test-suite-import";

const expectedBehavior: ExpectedBehavior = {
  checks: [{ type: "contains_phrases", phrases: ["hello"], caseSensitive: false }],
  mode: "all",
};

describe("parseTestCaseJsonl", () => {
  it("parses valid JSONL entries", () => {
    const input = [
      JSON.stringify({ name: "Case A", question: "Hello?", expectedBehavior }),
      JSON.stringify({
        name: "Case B",
        question: "World?",
        expectedBehavior,
        description: "Optional",
      }),
    ].join("\n");

    const result = parseTestCaseJsonl(input);

    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toBe(0);
    expect(result.entries[0]?.name).toBe("Case A");
    expect(result.entries[1]?.description).toBe("Optional");
  });

  it("returns errors for invalid JSON lines", () => {
    const input = [
      JSON.stringify({ name: "Case A", question: "Hello?", expectedBehavior }),
      "{bad json}",
    ].join("\n");

    const result = parseTestCaseJsonl(input);

    expect(result.entries).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it("returns validation errors for missing fields", () => {
    const input = [
      JSON.stringify({ name: "Case A", question: "Hello?", expectedBehavior }),
      JSON.stringify({ name: "Missing", question: "No checks" }),
      "",
    ].join("\n");

    const result = parseTestCaseJsonl(input);

    expect(result.entries).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toContain("expectedBehavior");
    expect(result.skipped).toBe(1);
  });
});

describe("serializeTestCasesJsonl", () => {
  it("serializes entries for export", () => {
    const jsonl = serializeTestCasesJsonl([
      {
        name: "Case A",
        question: "Hello?",
        expectedBehavior,
        description: "Notes",
        isEnabled: false,
      },
    ]);

    const result = parseTestCaseJsonl(jsonl);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.name).toBe("Case A");
    expect(result.entries[0]?.description).toBe("Notes");
    expect(result.entries[0]?.isEnabled).toBe(false);
  });
});
