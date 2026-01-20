import { z } from "zod";
import type { ExpectedBehavior } from "@grounded/db/schema";

export const expectedBehaviorSchema = z.object({
  checks: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("contains_phrases"),
          phrases: z.array(z.string().min(1)).min(1),
          caseSensitive: z.boolean().optional(),
        }),
        z.object({
          type: z.literal("semantic_similarity"),
          expectedAnswer: z.string().min(1),
          threshold: z.number().min(0).max(1),
        }),
        z.object({
          type: z.literal("llm_judge"),
          expectedAnswer: z.string().min(1),
          criteria: z.string().optional(),
        }),
      ])
    )
    .min(1),
  mode: z.enum(["all", "any"]),
});

const testCaseImportSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).nullable().optional(),
    question: z.string().min(1).max(4000),
    expectedBehavior: expectedBehaviorSchema,
    isEnabled: z.boolean().optional(),
  })
  .passthrough();

export type TestCaseJsonlEntry = z.infer<typeof testCaseImportSchema> & {
  expectedBehavior: ExpectedBehavior;
};

export type TestCaseJsonlError = {
  line: number;
  error: string;
};

export type TestCaseJsonlParseResult = {
  entries: TestCaseJsonlEntry[];
  errors: TestCaseJsonlError[];
  skipped: number;
};

export function parseTestCaseJsonl(input: string): TestCaseJsonlParseResult {
  const entries: TestCaseJsonlEntry[] = [];
  const errors: TestCaseJsonlError[] = [];
  let skipped = 0;

  const lines = input.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line.trim()) {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      errors.push({ line: index + 1, error: message });
      skipped += 1;
      return;
    }

    const result = testCaseImportSchema.safeParse(parsed);

    if (!result.success) {
      const message = result.error.issues
        .map((issue: z.ZodIssue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "entry";
          return `${path}: ${issue.message}`;
        })
        .join("; ");
      errors.push({ line: index + 1, error: message });
      skipped += 1;
      return;
    }

    entries.push(result.data as TestCaseJsonlEntry);
  });

  return { entries, errors, skipped };
}

export function serializeTestCasesJsonl(
  cases: Array<{
    name: string;
    description?: string | null;
    question: string;
    expectedBehavior: ExpectedBehavior;
    isEnabled?: boolean;
  }>
): string {
  return cases
    .map((testCase) =>
      JSON.stringify({
        name: testCase.name,
        description: testCase.description ?? undefined,
        question: testCase.question,
        expectedBehavior: testCase.expectedBehavior,
        isEnabled: testCase.isEnabled,
      })
    )
    .join("\n");
}
