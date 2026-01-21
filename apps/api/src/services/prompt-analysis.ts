import { desc, eq, sql, type InferSelectModel } from "drizzle-orm";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { db } from "@grounded/db";
import {
  testRunPromptAnalyses,
  testSuiteRuns,
  testCaseResults,
  testCases,
  agentTestSuites,
  type FailureCluster,
  type CheckResult,
  type ExpectedBehavior,
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

const PromptAnalysisDraftSchema = PromptAnalysisSchema.omit({ suggestedPrompt: true }).extend({
  rewriteGuidance: z
    .string()
    .describe("Specific prompt changes to implement in the rewrite"),
});

const PromptSuggestionSchema = z.object({
  suggestedPrompt: z.string().describe("The complete improved system prompt text"),
});

// ============================================================================
// Types
// ============================================================================

type TestCase = InferSelectModel<typeof testCases>;
type TestCaseResult = InferSelectModel<typeof testCaseResults>;
type PromptAnalysisDraft = z.infer<typeof PromptAnalysisDraftSchema>;

type FailureSignalSummary = {
  checkTypeStats: Record<string, { total: number; failed: number }>;
  missingPhrases: Array<{ phrase: string; count: number }>;
  similarityStats: {
    averageScore: number;
    minScore: number;
    maxScore: number;
    averageThreshold: number;
    total: number;
  } | null;
  judgeReasons: string[];
};

type AnalysisStats = {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: string;
};

type AnalysisContext = {
  context: string;
  failureSignals: FailureSignalSummary;
  stats: AnalysisStats;
};

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

const MAX_FAILED_CASES = 8;
const MAX_PASSED_CASES = 4;
const MAX_RESPONSE_CHARS = 500;
const MAX_EXPECTED_ANSWER_CHARS = 240;
const MAX_EXPECTED_PHRASES = 8;
const MAX_JUDGE_REASON_CHARS = 200;
const MAX_MISSING_PHRASES = 6;
const MAX_FAILURE_CLUSTERS = 4;
const MAX_AFFECTED_CASES = 6;

function truncateText(value: string | null | undefined, maxLength: number): string {
  if (!value) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function extractPromptPlaceholders(systemPrompt: string): string[] {
  const patterns = [
    /\{\{[^}]+\}\}/g,
    /\$\{[^}]+\}/g,
    /\[\[[^\]]+\]\]/g,
    /<<[^>]+>>/g,
  ];

  const placeholders = new Set<string>();

  patterns.forEach((pattern) => {
    const matches = systemPrompt.match(pattern);
    if (matches) {
      matches.forEach((match) => placeholders.add(match));
    }
  });

  return Array.from(placeholders);
}

function formatExpectedBehavior(expected?: ExpectedBehavior): string {
  if (!expected) {
    return "Not specified.";
  }

  if (!expected.checks || expected.checks.length === 0) {
    return `Mode: ${expected.mode} (no checks specified)`;
  }

  const modeLabel = expected.mode === "any" ? "any" : "all";
  const lines = expected.checks.map((check) => {
    if (check.type === "contains_phrases") {
      const phrases = check.phrases
        .slice(0, MAX_EXPECTED_PHRASES)
        .map((phrase) => `"${phrase}"`)
        .join(", ");
      const overflow = check.phrases.length > MAX_EXPECTED_PHRASES
        ? ` (+${check.phrases.length - MAX_EXPECTED_PHRASES} more)`
        : "";
      const sensitivity = check.caseSensitive ? "case-sensitive" : "case-insensitive";
      return `- contains_phrases (${sensitivity}): ${phrases}${overflow}`;
    }

    if (check.type === "semantic_similarity") {
      const expectedAnswer = truncateText(check.expectedAnswer, MAX_EXPECTED_ANSWER_CHARS);
      return `- semantic_similarity (threshold ${check.threshold}): expected "${expectedAnswer}"`;
    }

    const expectedAnswer = truncateText(check.expectedAnswer, MAX_EXPECTED_ANSWER_CHARS);
    const criteria = check.criteria
      ? `, criteria: ${truncateText(check.criteria, MAX_EXPECTED_ANSWER_CHARS)}`
      : "";
    return `- llm_judge: expected "${expectedAnswer}"${criteria}`;
  });

  return [`Mode: ${modeLabel}`, ...lines].join("\n");
}

function formatCheckResults(
  checks: CheckResult[],
  options?: { onlyFailures?: boolean }
): string {
  if (!checks || checks.length === 0) {
    return "None";
  }

  const relevantChecks = options?.onlyFailures
    ? checks.filter((check) => !check.passed)
    : checks;

  if (relevantChecks.length === 0) {
    return "None";
  }

  return relevantChecks
    .map((check) => {
      const status = check.passed ? "PASS" : "FAIL";
      let detail = "";

      if (check.checkType === "contains_phrases") {
        const missing = check.details.missingPhrases ?? [];
        const matched = check.details.matchedPhrases ?? [];
        const phrases = (missing.length > 0 ? missing : matched)
          .slice(0, MAX_MISSING_PHRASES)
          .join(", ");
        const overflow = (missing.length > MAX_MISSING_PHRASES || matched.length > MAX_MISSING_PHRASES)
          ? ` (+${(missing.length || matched.length) - MAX_MISSING_PHRASES} more)`
          : "";
        detail = missing.length > 0
          ? `missing: ${phrases}${overflow}`
          : `matched: ${phrases}${overflow}`;
      } else if (check.checkType === "semantic_similarity") {
        const score = typeof check.details.similarityScore === "number"
          ? check.details.similarityScore.toFixed(2)
          : "n/a";
        const threshold = typeof check.details.threshold === "number"
          ? check.details.threshold.toFixed(2)
          : "n/a";
        detail = `score=${score}, threshold=${threshold}`;
      } else if (check.checkType === "llm_judge") {
        const reasoning = check.details.reasoning ?? check.details.judgement ?? "";
        detail = truncateText(reasoning, MAX_JUDGE_REASON_CHARS);
      }

      return `- [${status}] ${check.checkType}${detail ? `: ${detail}` : ""}`;
    })
    .join("\n");
}

function summarizeFailureSignals(caseResults: CaseResultWithDetails[]): FailureSignalSummary {
  const checkTypeStats: Record<string, { total: number; failed: number }> = {};
  const missingPhraseCounts = new Map<string, number>();
  const similarityScores: number[] = [];
  const similarityThresholds: number[] = [];
  const judgeReasons: string[] = [];

  caseResults.forEach((caseResult) => {
    const checks = caseResult.result.checkResults ?? [];

    checks.forEach((check) => {
      const stats = checkTypeStats[check.checkType] ?? { total: 0, failed: 0 };
      stats.total += 1;
      if (!check.passed) {
        stats.failed += 1;
      }
      checkTypeStats[check.checkType] = stats;

      if (!check.passed && check.checkType === "contains_phrases") {
        const missing = check.details.missingPhrases ?? [];
        missing.forEach((phrase) => {
          missingPhraseCounts.set(phrase, (missingPhraseCounts.get(phrase) ?? 0) + 1);
        });
      }

      if (!check.passed && check.checkType === "semantic_similarity") {
        if (typeof check.details.similarityScore === "number") {
          similarityScores.push(check.details.similarityScore);
        }
        if (typeof check.details.threshold === "number") {
          similarityThresholds.push(check.details.threshold);
        }
      }

      if (!check.passed && check.checkType === "llm_judge") {
        const reasoning = check.details.reasoning ?? check.details.judgement ?? "";
        if (reasoning) {
          const trimmed = truncateText(reasoning, MAX_JUDGE_REASON_CHARS);
          if (!judgeReasons.includes(trimmed)) {
            judgeReasons.push(trimmed);
          }
        }
      }
    });
  });

  const missingPhrases = Array.from(missingPhraseCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MISSING_PHRASES)
    .map(([phrase, count]) => ({ phrase, count }));

  const similarityStats = similarityScores.length > 0
    ? {
        averageScore: similarityScores.reduce((sum, score) => sum + score, 0) / similarityScores.length,
        minScore: Math.min(...similarityScores),
        maxScore: Math.max(...similarityScores),
        averageThreshold: similarityThresholds.length > 0
          ? similarityThresholds.reduce((sum, value) => sum + value, 0) / similarityThresholds.length
          : 0,
        total: similarityScores.length,
      }
    : null;

  return {
    checkTypeStats,
    missingPhrases,
    similarityStats,
    judgeReasons: judgeReasons.slice(0, 3),
  };
}

function formatFailureSignals(summary: FailureSignalSummary): string {
  const entries = Object.entries(summary.checkTypeStats);
  if (entries.length === 0) {
    return "No check results available.";
  }

  const lines: string[] = [];
  lines.push("Check failures by type:");
  entries.forEach(([checkType, stats]) => {
    lines.push(`- ${checkType}: ${stats.failed}/${stats.total} failed`);
  });

  if (summary.missingPhrases.length > 0) {
    const phraseSummary = summary.missingPhrases
      .map((item) => `"${item.phrase}" (${item.count})`)
      .join(", ");
    lines.push(`Common missing phrases: ${phraseSummary}`);
  }

  if (summary.similarityStats) {
    lines.push(
      `Semantic similarity failures: avg ${summary.similarityStats.averageScore.toFixed(2)}, ` +
        `range ${summary.similarityStats.minScore.toFixed(2)}-${summary.similarityStats.maxScore.toFixed(2)}, ` +
        `avg threshold ${summary.similarityStats.averageThreshold.toFixed(2)} ` +
        `(${summary.similarityStats.total} checks)`
    );
  }

  if (summary.judgeReasons.length > 0) {
    lines.push(`Judge failure reasons (samples): ${summary.judgeReasons.join(" | ")}`);
  }

  return lines.join("\n");
}

function buildAnalysisContext(
  systemPrompt: string,
  caseResults: CaseResultWithDetails[]
): AnalysisContext {
  const passedCases = caseResults.filter((c) => c.result.status === "passed");
  const failedCases = caseResults.filter(
    (c) => c.result.status === "failed" || c.result.status === "error"
  );
  const errorCount = failedCases.filter((c) => c.result.status === "error").length;
  const passRate = caseResults.length > 0
    ? ((passedCases.length / caseResults.length) * 100).toFixed(1)
    : "0.0";
  const failureSignals = summarizeFailureSignals(caseResults);

  const formatCase = (c: CaseResultWithDetails, includeChecks = true) => {
    const expectedBehavior = formatExpectedBehavior(c.testCase.expectedBehavior);
    const responseText = truncateText(c.result.actualResponse ?? "(no response)", MAX_RESPONSE_CHARS);
    const checkSummary = includeChecks
      ? formatCheckResults(c.result.checkResults ?? [], { onlyFailures: true })
      : "";
    const errorMessage = c.result.errorMessage
      ? `Error: ${truncateText(c.result.errorMessage, MAX_JUDGE_REASON_CHARS)}`
      : "";
    const nameLine = c.testCase.name ? `Name: ${c.testCase.name}\n` : "";

    return `
${nameLine}Question: ${c.testCase.question}
Status: ${c.result.status.toUpperCase()}
Expected Behavior:\n${expectedBehavior}
${errorMessage}
Response: ${responseText}
${includeChecks ? `Failed Checks:\n${checkSummary}` : ""}
`.trim();
  };

  const failedSample = failedCases.slice(0, MAX_FAILED_CASES);
  const passedSample = passedCases.slice(0, MAX_PASSED_CASES);

  const failedSection =
    failedSample.length > 0
      ? `
## Failed/Error Cases (${failedSample.length} of ${failedCases.length})

${failedSample.map((c) => formatCase(c, true)).join("\n\n---\n\n")}
${failedCases.length > failedSample.length ? `\n... and ${failedCases.length - failedSample.length} more failed/error cases` : ""}
`
      : "";

  const passedSection =
    passedSample.length > 0
      ? `
## Passed Cases (${passedSample.length} of ${passedCases.length})

${passedSample.map((c) => formatCase(c, false)).join("\n\n---\n\n")}
${passedCases.length > passedSample.length ? `\n... and ${passedCases.length - passedSample.length} more passed cases` : ""}
`
      : "";

  const context = `## Current System Prompt

\`\`\`
${systemPrompt}
\`\`\`

## Test Results Summary

- Total cases: ${caseResults.length}
- Passed: ${passedCases.length}
- Failed/Error: ${failedCases.length}
- Errors: ${errorCount}
- Pass rate: ${passRate}%

## Failure Signals

${formatFailureSignals(failureSignals)}

${failedSection}
${passedSection}
`;

  return {
    context,
    failureSignals,
    stats: {
      total: caseResults.length,
      passed: passedCases.length,
      failed: failedCases.length,
      errors: errorCount,
      passRate,
    },
  };
}

function buildLegacyAnalysisPrompt(context: string): string {
  return `${context}

## Output Requirements

Return a JSON object with these fields:

1. "summary" (string): 1-2 sentences on prompt strengths/weaknesses.
2. "failureClusters" (array): Group similar failures. Each cluster has:
   - "category" (string): Short snake_case label like "missing_citations".
   - "description" (string): What's going wrong.
   - "affectedCases" (array of strings): Question snippets (first 50 chars each).
   - "suggestedFix" (string): How to fix in the prompt.
3. "suggestedPrompt" (string): Complete improved system prompt text.
4. "rationale" (string): 1-2 sentences explaining key changes.

CRITICAL: Return ONLY valid JSON. No markdown, no code fences, no extra text.`;
}

function normalizeFailureClusters(clusters: FailureCluster[] | undefined): FailureCluster[] {
  if (!Array.isArray(clusters)) {
    return [];
  }

  return clusters.slice(0, MAX_FAILURE_CLUSTERS).map((cluster) => ({
    category: String(cluster.category ?? "unknown").trim(),
    description: String(cluster.description ?? "").trim(),
    affectedCases: Array.isArray(cluster.affectedCases)
      ? cluster.affectedCases
          .map((value) => truncateText(String(value), 50))
          .slice(0, MAX_AFFECTED_CASES)
      : [],
    suggestedFix: String(cluster.suggestedFix ?? "").trim(),
  }));
}

function formatFailureClusters(clusters: FailureCluster[]): string {
  if (clusters.length === 0) {
    return "None.";
  }

  return clusters
    .map((cluster, index) => {
      const cases = cluster.affectedCases.slice(0, 3).join("; ");
      const caseLabel = cases ? ` Affected: ${cases}.` : "";
      return `${index + 1}. [${cluster.category}] ${cluster.description} Fix: ${cluster.suggestedFix}.${caseLabel}`;
    })
    .join("\n");
}

function buildRewritePrompt(options: {
  systemPrompt: string;
  analysis: PromptAnalysisDraft & { failureClusters: FailureCluster[] };
  stats: AnalysisStats;
  failureSignals: FailureSignalSummary;
  placeholders: string[];
  extraRequirements?: string[];
}): string {
  const placeholderText = options.placeholders.length > 0
    ? options.placeholders.map((placeholder) => `- ${placeholder}`).join("\n")
    : "(none)";
  const extraRequirements = options.extraRequirements && options.extraRequirements.length > 0
    ? `\n## Extra Requirements\n${options.extraRequirements.map((req) => `- ${req}`).join("\n")}`
    : "";

  return `## Original System Prompt

\`\`\`
${options.systemPrompt}
\`\`\`

## Test Results

- Pass rate: ${options.stats.passRate}% (${options.stats.passed}/${options.stats.total} passed)
- Failed/Error: ${options.stats.failed}
- Errors: ${options.stats.errors}

## Analysis Summary

${options.analysis.summary}

## Failure Clusters

${formatFailureClusters(options.analysis.failureClusters)}

## Failure Signals

${formatFailureSignals(options.failureSignals)}

## Rewrite Guidance

${options.analysis.rewriteGuidance || "Strengthen the prompt to address the failure clusters."}

## Required Placeholders

${placeholderText}
${extraRequirements}

Rewrite the system prompt now. Output ONLY the full revised prompt text.`;
}

function cleanSuggestedPrompt(text: string | null | undefined): string {
  if (!text) {
    return "";
  }

  return text
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function findMissingPlaceholders(prompt: string, placeholders: string[]): string[] {
  if (!prompt) {
    return placeholders;
  }

  return placeholders.filter((placeholder) => !prompt.includes(placeholder));
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

  const { context, failureSignals, stats } = buildAnalysisContext(systemPrompt, caseResults);
  const placeholders = extractPromptPlaceholders(systemPrompt);

  log.info("api", "Prompt analysis starting", {
    runId: input.runId,
    contextLength: context.length,
    systemPromptLength: systemPrompt.length,
    placeholderCount: placeholders.length,
    passRate: stats.passRate,
    failedCases: stats.failed,
  });

  try {
    const { object: draftRaw } = await generateObject({
      model,
      schema: PromptAnalysisDraftSchema,
      system: `You are a senior prompt engineer for a grounded RAG assistant. Analyze the test failures and expected behaviors, then produce a structured diagnosis.

Rules:
- Focus on observable failures, check results, and expected behaviors
- Use specific, actionable suggested fixes
- Use snake_case categories
- Keep summary and rationale concise (1-2 sentences each)
- Limit to ${MAX_FAILURE_CLUSTERS} failure clusters
- Think through root causes silently; output only the schema fields`,
      prompt: `${context}

Provide the structured analysis now.`,
      temperature: 0.2,
    });

    const normalizedClusters = normalizeFailureClusters(draftRaw.failureClusters);
    const draft: PromptAnalysisDraft & { failureClusters: FailureCluster[] } = {
      summary: String(draftRaw.summary ?? "").trim(),
      failureClusters: normalizedClusters,
      rationale: String(draftRaw.rationale ?? "").trim(),
      rewriteGuidance: String(draftRaw.rewriteGuidance ?? "").trim(),
    };

    log.info("api", "Prompt analysis draft generated", {
      runId: input.runId,
      summaryLength: draft.summary.length,
      failureClusterCount: draft.failureClusters.length,
    });

    const rewriteSystem = `You are an expert prompt engineer rewriting a system prompt for a grounded RAG assistant.

Rules:
- Output ONLY the revised prompt text (no commentary or markdown)
- Preserve the assistant's role, tone, and any placeholders/special tokens
- Preserve any explicit output format requirements or templates from the original prompt
- Strengthen grounding: use only provided sources, include citations in the existing format, say when information is unavailable
- Prefer clear sections, positive instructions, and explicit response structure
- You may reorganize or expand the prompt to fix failures, but avoid unnecessary verbosity
- Do NOT include test cases or evaluation data in the prompt`;

    const rewritePrompt = buildRewritePrompt({
      systemPrompt,
      analysis: draft,
      stats,
      failureSignals,
      placeholders,
    });

    const { object: rewriteResult } = await generateObject({
      model,
      schema: PromptSuggestionSchema,
      system: rewriteSystem,
      prompt: rewritePrompt,
      temperature: 0.2,
    });

    let suggestedPrompt = cleanSuggestedPrompt(rewriteResult.suggestedPrompt);
    const missingPlaceholders = findMissingPlaceholders(suggestedPrompt, placeholders);
    const extraRequirements: string[] = [];

    if (missingPlaceholders.length > 0) {
      extraRequirements.push(`Include these placeholders exactly: ${missingPlaceholders.join(", ")}`);
    }

    if (systemPrompt.length > 160) {
      const minLength = Math.max(120, Math.floor(systemPrompt.length * 0.6));
      const maxLength = Math.floor(systemPrompt.length * 1.6);
      if (suggestedPrompt.length < minLength || suggestedPrompt.length > maxLength) {
        extraRequirements.push(`Target length between ${minLength} and ${maxLength} characters.`);
      }
    }

    if (suggestedPrompt.length < 40) {
      extraRequirements.push("Return the full prompt text, not a summary.");
    }

    if (extraRequirements.length > 0) {
      const retryPrompt = buildRewritePrompt({
        systemPrompt,
        analysis: draft,
        stats,
        failureSignals,
        placeholders,
        extraRequirements,
      });

      const { object: retryResult } = await generateObject({
        model,
        schema: PromptSuggestionSchema,
        system: rewriteSystem,
        prompt: retryPrompt,
        temperature: 0.2,
      });

      const retryPromptText = cleanSuggestedPrompt(retryResult.suggestedPrompt);
      const retryMissing = findMissingPlaceholders(retryPromptText, placeholders);
      const primaryMissing = findMissingPlaceholders(suggestedPrompt, placeholders);

      if (retryPromptText && retryMissing.length <= primaryMissing.length) {
        suggestedPrompt = retryPromptText;
      }
    }

    const analysisResult: PromptAnalysisResult = {
      summary: draft.summary || "Prompt analysis completed.",
      failureClusters: draft.failureClusters,
      suggestedPrompt: suggestedPrompt || systemPrompt,
      rationale: draft.rationale || "Revised prompt to address observed failure patterns.",
    };

    const validated = PromptAnalysisSchema.safeParse(analysisResult);
    if (!validated.success) {
      throw new Error("Prompt analysis validation failed");
    }

    return validated.data;
  } catch (error) {
    log.warn("api", "Enhanced prompt analysis failed, falling back", {
      runId: input.runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const legacyPrompt = buildLegacyAnalysisPrompt(context);

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
- Max ${MAX_FAILURE_CLUSTERS} failure clusters
- suggestedPrompt should be similar length to original`,
      },
      { role: "user", content: legacyPrompt },
    ],
    maxOutputTokens: 16000,
    temperature: 0.3,
  });

  log.info("api", "Prompt analysis raw response", {
    runId: input.runId,
    responseLength: result.text.length,
    responsePreview: result.text.slice(0, 300),
    finishReason: result.finishReason,
    usage: result.usage,
  });

  if (result.finishReason === "length") {
    log.warn("api", "Response was truncated due to length limit", {
      runId: input.runId,
      outputTokens: result.usage?.outputTokens,
    });
  }

  const parsed = parseAnalysisResponse(result.text);

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
  const failedCases = caseResults.filter((c) => c.result.status === "failed" || c.result.status === "error");
  const passedCount = caseResults.filter((c) => c.result.status === "passed").length;
  const passRate = caseResults.length > 0 ? ((passedCount / caseResults.length) * 100).toFixed(0) : "0";

  // Build a condensed context
  const failureSummary = failedCases.slice(0, 5).map((c) => {
    const checks = c.result.checkResults ?? [];
    const failedChecks = checks.filter((ch) => !ch.passed);
    const expected = truncateText(formatExpectedBehavior(c.testCase.expectedBehavior).replace(/\n/g, " "), 240);
    const failureTypes = failedChecks.length > 0
      ? failedChecks.map((ch) => ch.checkType).join(", ")
      : "unknown";
    return `Q: "${c.testCase.question.slice(0, 60)}..." Expected: ${expected}. Failed: ${failureTypes}`;
  }).join("\n");

  const contextPrompt = `Current system prompt: "${systemPrompt.slice(0, 400)}${systemPrompt.length > 400 ? "..." : ""}"

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
    const suggestedPrompt = cleanSuggestedPrompt(promptResult.text);

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

    const failureClusters = Array.isArray(parsed.failureClusters)
      ? parsed.failureClusters.map((c: any) => ({
          category: String(c.category ?? "unknown"),
          description: String(c.description ?? ""),
          affectedCases: Array.isArray(c.affectedCases)
            ? c.affectedCases.map(String)
            : [],
          suggestedFix: String(c.suggestedFix ?? ""),
        }))
      : [];

    return {
      summary,
      failureClusters: normalizeFailureClusters(failureClusters),
      suggestedPrompt: typeof parsed.suggestedPrompt === "string"
        ? cleanSuggestedPrompt(parsed.suggestedPrompt)
        : "",
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
