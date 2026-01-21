import { and, desc, eq, sql, type InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { db } from "@grounded/db";
import {
  testRunPromptAnalyses,
  testSuiteRuns,
  testCaseResults,
  testCases,
  agentTestSuites,
  agents,
  type FailureCluster,
  type CheckResult,
} from "@grounded/db/schema";
import { getAIRegistry } from "@grounded/ai-providers";
import { log } from "@grounded/logger";

// Zod schema for structured output
const PromptAnalysisSchema = z.object({
  summary: z.string().describe("A 1-2 sentence analysis of the prompt's strengths and weaknesses"),
  failureClusters: z.array(z.object({
    category: z.string().describe("Short label like 'missing_citations', 'verbose_responses'"),
    description: z.string().describe("What is going wrong"),
    affectedCases: z.array(z.string()).describe("Question snippets (first 50 chars each)"),
    suggestedFix: z.string().describe("How to fix this in the prompt"),
  })).describe("Groups of similar failures"),
  suggestedPrompt: z.string().describe("The complete improved system prompt text"),
  rationale: z.string().describe("1-2 sentences explaining key changes"),
});

// ============================================================================
// Types
// ============================================================================

type TestSuiteRun = InferSelectModel<typeof testSuiteRuns>;
type TestCase = InferSelectModel<typeof testCases>;
type TestCaseResult = InferSelectModel<typeof testCaseResults>;

export interface CaseResultWithDetails {
  testCase: TestCase;
  result: TestCaseResult;
}

export interface PromptAnalysisResult {
  summary: string;
  failureClusters: FailureCluster[];
  suggestedPrompt: string;
  rationale: string;
}

export interface PromptAnalysisInput {
  runId: string;
  systemPrompt: string;
  caseResults: CaseResultWithDetails[];
  modelConfigId?: string | null;
}

// ============================================================================
// Analysis Prompt Builder
// ============================================================================

function buildAnalysisPrompt(
  systemPrompt: string,
  caseResults: CaseResultWithDetails[]
): string {
  const passedCases = caseResults.filter((c) => c.result.status === "passed");
  const failedCases = caseResults.filter((c) => c.result.status === "failed" || c.result.status === "error");

  const formatCase = (c: CaseResultWithDetails, includeChecks = true) => {
    const checks = c.result.checkResults ?? [];
    const checkSummary = includeChecks
      ? checks
          .map((check) => {
            const status = check.passed ? "PASS" : "FAIL";
            let detail = "";
            if (check.checkType === "contains_phrases") {
              detail = check.passed
                ? `matched: ${check.details.matchedPhrases?.join(", ")}`
                : `missing: ${check.details.missingPhrases?.join(", ")}`;
            } else if (check.checkType === "semantic_similarity") {
              detail = `score=${check.details.similarityScore?.toFixed(2)}, threshold=${check.details.threshold}`;
            } else if (check.checkType === "llm_judge") {
              detail = check.details.reasoning ?? check.details.judgement ?? "";
            }
            return `  - [${status}] ${check.checkType}: ${detail}`;
          })
          .join("\n")
      : "";

    return `
Question: ${c.testCase.question}
Status: ${c.result.status.toUpperCase()}
Response: ${c.result.actualResponse?.slice(0, 500) ?? "(no response)"}${c.result.actualResponse && c.result.actualResponse.length > 500 ? "..." : ""}
${checkSummary ? `Checks:\n${checkSummary}` : ""}
`.trim();
  };

  const failedSection =
    failedCases.length > 0
      ? `
## Failed/Error Cases (${failedCases.length})

${failedCases.map((c) => formatCase(c, true)).join("\n\n---\n\n")}
`
      : "";

  const passedSection =
    passedCases.length > 0
      ? `
## Passed Cases (${passedCases.length})

${passedCases.slice(0, 5).map((c) => formatCase(c, false)).join("\n\n---\n\n")}
${passedCases.length > 5 ? `\n... and ${passedCases.length - 5} more passed cases` : ""}
`
      : "";

  return `You are an expert prompt engineer analyzing test results for an AI assistant.

## Current System Prompt

\`\`\`
${systemPrompt}
\`\`\`

## Test Results Summary

- Total cases: ${caseResults.length}
- Passed: ${passedCases.length}
- Failed/Error: ${failedCases.length}
- Pass rate: ${caseResults.length > 0 ? ((passedCases.length / caseResults.length) * 100).toFixed(1) : 0}%

${failedSection}
${passedSection}

## Your Task

Analyze the test results and provide a JSON response with these exact fields:

1. "summary" (string): A 1-2 sentence analysis of the prompt's strengths and weaknesses.

2. "failureClusters" (array): Group similar failures. Each cluster has:
   - "category" (string): Short label like "missing_citations", "verbose_responses"
   - "description" (string): What's going wrong
   - "affectedCases" (array of strings): Question snippets (first 50 chars each)
   - "suggestedFix" (string): How to fix in the prompt

3. "suggestedPrompt" (string): The complete improved system prompt text.

4. "rationale" (string): 1-2 sentences explaining key changes.

CRITICAL: Return ONLY valid JSON. No markdown, no \`\`\`json, no text before/after.
All values must be strings or arrays of strings - no nested objects.

Example format:
{"summary": "The prompt works well for X but fails on Y.", "failureClusters": [{"category": "example", "description": "desc", "affectedCases": ["case1"], "suggestedFix": "fix"}], "suggestedPrompt": "You are...", "rationale": "Added X to improve Y."}`;
}

// ============================================================================
// Analysis Service
// ============================================================================

export async function analyzePrompt(
  input: PromptAnalysisInput
): Promise<PromptAnalysisResult> {
  const { systemPrompt, caseResults, modelConfigId } = input;

  if (caseResults.length === 0) {
    return {
      summary: "No test cases to analyze.",
      failureClusters: [],
      suggestedPrompt: systemPrompt,
      rationale: "No changes suggested - no test data available.",
    };
  }

  const registry = getAIRegistry();
  const model = await registry.getLanguageModel(modelConfigId ?? undefined);

  if (!model) {
    throw new Error("No language model available for prompt analysis");
  }

  const prompt = buildAnalysisPrompt(systemPrompt, caseResults);

  const { generateText } = await import("ai");

  // Log the prompt size to debug truncation
  log.info("api", "Prompt analysis starting", {
    runId: input.runId,
    promptLength: prompt.length,
    systemPromptLength: systemPrompt.length,
  });

  // Use generateText with explicit JSON instructions
  // Note: We set maxOutputTokens high - if truncation occurs, it's likely the API's limit
  const result = await generateText({
    model,
    messages: [
      {
        role: "system",
        content: `You are an expert prompt engineer. Respond with ONLY valid JSON matching this exact structure:
{"summary":"string","failureClusters":[{"category":"string","description":"string","affectedCases":["string"],"suggestedFix":"string"}],"suggestedPrompt":"string","rationale":"string"}

CRITICAL RULES:
- Output ONLY the JSON object, nothing else
- NO markdown, NO code fences, NO explanation text
- Keep summary under 200 characters
- Keep rationale under 200 characters  
- Max 3 failure clusters
- suggestedPrompt should be similar length to original`,
      },
      { role: "user", content: prompt },
    ],
    maxOutputTokens: 16000, // Try higher limit
    temperature: 0.3,
  });

  log.info("api", "Prompt analysis raw response", {
    runId: input.runId,
    responseLength: result.text.length,
    responsePreview: result.text.slice(0, 300),
    finishReason: result.finishReason,
    usage: result.usage,
  });

  // Check if response was truncated
  if (result.finishReason === "length") {
    log.warn("api", "Response was truncated due to length limit", {
      runId: input.runId,
      outputTokens: result.usage?.outputTokens,
    });
  }

  const parsed = parseAnalysisResponse(result.text);

  // If parsing failed, try the simple fallback
  if (!parsed.suggestedPrompt && parsed.summary.includes("failed")) {
    log.warn("api", "JSON parsing failed, using simple fallback", {
      runId: input.runId,
    });
    return await analyzePromptSimple(input, model, systemPrompt, caseResults);
  }

  return parsed;
}

/**
 * Simplified analysis that asks for one field at a time to avoid truncation.
 */
async function analyzePromptSimple(
  input: PromptAnalysisInput,
  model: any,
  systemPrompt: string,
  caseResults: CaseResultWithDetails[]
): Promise<PromptAnalysisResult> {
  const { generateText } = await import("ai");

  const failedCases = caseResults.filter((c) => c.result.status === "failed" || c.result.status === "error");
  const passedCount = caseResults.filter((c) => c.result.status === "passed").length;
  const passRate = caseResults.length > 0 ? ((passedCount / caseResults.length) * 100).toFixed(0) : "0";

  // Build a condensed context
  const failureSummary = failedCases.slice(0, 5).map((c) => {
    const checks = c.result.checkResults ?? [];
    const failedChecks = checks.filter((ch) => !ch.passed);
    return `Q: "${c.testCase.question.slice(0, 60)}..." - Failed: ${failedChecks.map((ch) => ch.checkType).join(", ")}`;
  }).join("\n");

  const contextPrompt = `Current system prompt: "${systemPrompt.slice(0, 300)}${systemPrompt.length > 300 ? "..." : ""}"

Test Results: ${passRate}% pass rate (${passedCount}/${caseResults.length})

Failed cases:
${failureSummary || "None"}`;

  try {
    // Get summary
    const summaryResult = await generateText({
      model,
      messages: [
        { role: "system", content: "You are a prompt engineer. Give a 1-sentence analysis." },
        { role: "user", content: `${contextPrompt}\n\nIn ONE sentence, what's the main issue with this prompt?` },
      ],
      maxOutputTokens: 150,
      temperature: 0.3,
    });

    // Get suggested prompt improvement
    const promptResult = await generateText({
      model,
      messages: [
        { role: "system", content: "You are a prompt engineer. Output ONLY the improved prompt text, nothing else." },
        { role: "user", content: `${contextPrompt}\n\nRewrite the system prompt to fix the issues. Keep it similar length. Output ONLY the new prompt:` },
      ],
      maxOutputTokens: 500,
      temperature: 0.3,
    });

    const summary = summaryResult.text.trim();
    const suggestedPrompt = promptResult.text.trim();

    log.info("api", "Prompt analysis completed with simple fallback", {
      runId: input.runId,
      summaryLength: summary.length,
      suggestedPromptLength: suggestedPrompt.length,
    });

    return {
      summary: summary || `${passRate}% of tests passed. Analysis of failures suggests prompt improvements needed.`,
      failureClusters: failedCases.length > 0 ? [{
        category: "test_failures",
        description: `${failedCases.length} test(s) failed`,
        affectedCases: failedCases.slice(0, 5).map((c) => c.testCase.question.slice(0, 50)),
        suggestedFix: "See suggested prompt improvements",
      }] : [],
      suggestedPrompt: suggestedPrompt || systemPrompt,
      rationale: `Improved prompt based on ${failedCases.length} failing test(s).`,
    };
  } catch (fallbackError) {
    log.error("api", "Simple prompt analysis also failed", {
      runId: input.runId,
      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    });

    return {
      summary: `Analysis encountered errors. ${passRate}% of tests passed.`,
      failureClusters: [],
      suggestedPrompt: systemPrompt,
      rationale: "Unable to generate improvements due to model errors.",
    };
  }
}

function parseAnalysisResponse(text: string): PromptAnalysisResult {
  // Strip markdown code fences if present
  let cleanedText = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Try to extract JSON from the response
  const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.warn("api", "Failed to parse prompt analysis response - no JSON found", {
      responsePreview: text.slice(0, 200),
    });
    return {
      summary: "Analysis failed - could not parse response.",
      failureClusters: [],
      suggestedPrompt: "",
      rationale: "The analysis model did not return valid JSON.",
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Handle case where summary might be an object (LLM sometimes nests things)
    let summary = "";
    if (typeof parsed.summary === "string") {
      summary = parsed.summary;
    } else if (typeof parsed.summary === "object" && parsed.summary !== null) {
      // Try to extract text from nested object
      summary = Object.values(parsed.summary).filter(v => typeof v === "string").join(" ");
    }

    return {
      summary,
      failureClusters: Array.isArray(parsed.failureClusters)
        ? parsed.failureClusters.map((c: any) => ({
            category: String(c.category ?? "unknown"),
            description: String(c.description ?? ""),
            affectedCases: Array.isArray(c.affectedCases)
              ? c.affectedCases.map(String)
              : [],
            suggestedFix: String(c.suggestedFix ?? ""),
          }))
        : [],
      suggestedPrompt: typeof parsed.suggestedPrompt === "string" ? parsed.suggestedPrompt : "",
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch (error) {
    log.warn("api", "Failed to parse prompt analysis JSON", {
      error: error instanceof Error ? error.message : String(error),
      responsePreview: jsonMatch[0].slice(0, 200),
    });
    return {
      summary: "Analysis failed - invalid JSON response.",
      failureClusters: [],
      suggestedPrompt: "",
      rationale: "The analysis model returned malformed JSON.",
    };
  }
}

// ============================================================================
// Database Operations
// ============================================================================

export async function getRunCaseResults(
  runId: string
): Promise<CaseResultWithDetails[]> {
  const results = await db
    .select({
      result: testCaseResults,
      testCase: testCases,
    })
    .from(testCaseResults)
    .innerJoin(testCases, eq(testCases.id, testCaseResults.testCaseId))
    .where(eq(testCaseResults.runId, runId));

  return results;
}

export async function savePromptAnalysis(
  tenantId: string,
  suiteId: string,
  runId: string,
  analysis: PromptAnalysisResult,
  options?: {
    experimentId?: string;
    modelConfigId?: string | null;
  }
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(testRunPromptAnalyses)
    .values({
      tenantId,
      suiteId,
      runId,
      experimentId: options?.experimentId ?? null,
      modelConfigId: options?.modelConfigId ?? null,
      summary: analysis.summary,
      failureClusters: analysis.failureClusters,
      suggestedPrompt: analysis.suggestedPrompt,
      rationale: analysis.rationale,
    })
    .returning({ id: testRunPromptAnalyses.id });

  return { id: inserted.id };
}

export async function getLatestAnalysisForRun(
  runId: string
): Promise<InferSelectModel<typeof testRunPromptAnalyses> | null> {
  const [analysis] = await db
    .select()
    .from(testRunPromptAnalyses)
    .where(eq(testRunPromptAnalyses.runId, runId))
    .orderBy(desc(testRunPromptAnalyses.createdAt))
    .limit(1);

  return analysis ?? null;
}

export async function getLatestAnalysisForSuite(
  suiteId: string
): Promise<InferSelectModel<typeof testRunPromptAnalyses> | null> {
  const [analysis] = await db
    .select()
    .from(testRunPromptAnalyses)
    .where(eq(testRunPromptAnalyses.suiteId, suiteId))
    .orderBy(desc(testRunPromptAnalyses.createdAt))
    .limit(1);

  return analysis ?? null;
}

export async function listAnalysesForSuite(
  suiteId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ analyses: InferSelectModel<typeof testRunPromptAnalyses>[]; total: number }> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;

  const analyses = await db
    .select()
    .from(testRunPromptAnalyses)
    .where(eq(testRunPromptAnalyses.suiteId, suiteId))
    .orderBy(desc(testRunPromptAnalyses.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(testRunPromptAnalyses)
    .where(eq(testRunPromptAnalyses.suiteId, suiteId));

  return { analyses, total: countResult?.count ?? 0 };
}

export async function markAnalysisApplied(analysisId: string): Promise<void> {
  await db
    .update(testRunPromptAnalyses)
    .set({ appliedAt: new Date() })
    .where(eq(testRunPromptAnalyses.id, analysisId));
}

// ============================================================================
// Run Full Analysis Workflow
// ============================================================================

export async function runPromptAnalysis(
  runId: string,
  options?: { modelConfigId?: string | null }
): Promise<{ analysisId: string; analysis: PromptAnalysisResult }> {
  const run = await db.query.testSuiteRuns.findFirst({
    where: eq(testSuiteRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (!run.systemPrompt) {
    throw new Error(`Run has no system prompt recorded: ${runId}`);
  }

  const suite = await db.query.agentTestSuites.findFirst({
    where: eq(agentTestSuites.id, run.suiteId),
  });

  if (!suite) {
    throw new Error(`Suite not found for run: ${runId}`);
  }

  const caseResults = await getRunCaseResults(runId);

  const modelConfigId = options?.modelConfigId ?? suite.analysisModelConfigId;

  log.info("api", "Running prompt analysis", {
    runId,
    suiteId: suite.id,
    caseCount: caseResults.length,
    modelConfigId,
  });

  const analysis = await analyzePrompt({
    runId,
    systemPrompt: run.systemPrompt,
    caseResults,
    modelConfigId,
  });

  const { id: analysisId } = await savePromptAnalysis(
    run.tenantId,
    suite.id,
    runId,
    analysis,
    {
      experimentId: run.experimentId ?? undefined,
      modelConfigId,
    }
  );

  log.info("api", "Prompt analysis completed", {
    runId,
    analysisId,
    failureClusterCount: analysis.failureClusters.length,
    hasSuggestedPrompt: !!analysis.suggestedPrompt,
  });

  return { analysisId, analysis };
}
