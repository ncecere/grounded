# Phase 2: Test Runner Service

## Overview

Core service that executes test suites, evaluates responses against expected behavior, and records results.

## File Location

`apps/api/src/services/test-runner.ts`

## Core Functions

### 1. `runTestSuite(suiteId: string, triggeredBy: "manual" | "schedule", userId?: string)`

Main entry point for running a test suite.

```typescript
export async function runTestSuite(
  suiteId: string,
  triggeredBy: "manual" | "schedule",
  userId?: string
): Promise<{ runId: string; status: "started" | "queued" | "error"; error?: string }> {
  // 1. Check if suite exists and is enabled
  // 2. Check if there's already a run in progress (queue if so)
  // 3. Create test_suite_run record with status "pending"
  // 4. Start execution (async, don't await)
  // 5. Return runId immediately
}
```

### 2. `executeTestRun(runId: string)`

Actually executes the test run (called internally).

```typescript
async function executeTestRun(runId: string): Promise<void> {
  // 1. Update run status to "running", set startedAt
  // 2. Get all enabled test cases for the suite
  // 3. Get agent and its configuration
  // 4. For each test case:
  //    a. Call the agent's chat endpoint (use simple-rag.ts)
  //    b. Evaluate response against expectedBehavior
  //    c. Record test_case_result
  //    d. Update run counts
  // 5. Update run status to "completed", set completedAt
  // 6. Check for regression and trigger alerts if needed
}
```

## Run Lifecycle and Status Semantics

Use a consistent lifecycle across runner, API, and UI:

- `pending`: run is created and waiting to start (queue state)
- `running`: run is actively executing test cases
- `completed`: run finished and all counts are final
- `failed`: run aborted due to system-level failure (no further cases executed)
- `cancelled`: run was cancelled by user or admin

`runTestSuite()` should return `status: "started"` when it can immediately transition to `running`, and `status: "queued"` when it must wait. Both cases still create the run record first with `status: "pending"` and transition to `running` when execution begins.

If a suite has no enabled test cases, mark the run `completed` with zero counts and skip regression checks.

### 3. Evaluation Functions

#### `evaluateContainsPhrases(response: string, check: ContainsPhrasesCheck): CheckResult`

```typescript
function evaluateContainsPhrases(
  response: string,
  check: { type: "contains_phrases"; phrases: string[]; caseSensitive?: boolean }
): CheckResult {
  const normalizedResponse = check.caseSensitive ? response : response.toLowerCase();
  const matchedPhrases: string[] = [];
  const missingPhrases: string[] = [];
  
  for (const phrase of check.phrases) {
    const normalizedPhrase = check.caseSensitive ? phrase : phrase.toLowerCase();
    if (normalizedResponse.includes(normalizedPhrase)) {
      matchedPhrases.push(phrase);
    } else {
      missingPhrases.push(phrase);
    }
  }
  
  return {
    checkIndex: 0, // Set by caller
    checkType: "contains_phrases",
    passed: missingPhrases.length === 0,
    details: { matchedPhrases, missingPhrases },
  };
}
```

#### `evaluateSemanticSimilarity(response: string, check: SemanticSimilarityCheck, embeddingModel: EmbeddingModel): Promise<CheckResult>`

```typescript
async function evaluateSemanticSimilarity(
  response: string,
  check: { type: "semantic_similarity"; expectedAnswer: string; threshold: number },
  embeddingModel: EmbeddingModel
): Promise<CheckResult> {
  // 1. Get embedding for response
  // 2. Get embedding for expectedAnswer
  // 3. Calculate cosine similarity
  // 4. Compare against threshold
  
  const [responseEmbedding, expectedEmbedding] = await Promise.all([
    embeddingModel.embed(response),
    embeddingModel.embed(check.expectedAnswer),
  ]);
  
  const similarity = cosineSimilarity(responseEmbedding, expectedEmbedding);
  
  return {
    checkIndex: 0,
    checkType: "semantic_similarity",
    passed: similarity >= check.threshold,
    details: { similarityScore: similarity, threshold: check.threshold },
  };
}
```

#### `evaluateLlmJudge(question: string, response: string, check: LlmJudgeCheck, model: LLMModel): Promise<CheckResult>`

```typescript
async function evaluateLlmJudge(
  question: string,
  response: string,
  check: { type: "llm_judge"; expectedAnswer: string; criteria?: string },
  model: LLMModel
): Promise<CheckResult> {
  const prompt = `You are evaluating an AI assistant's response.

Question asked: ${question}

Expected answer (or key points): ${check.expectedAnswer}

${check.criteria ? `Evaluation criteria: ${check.criteria}` : ""}

Actual response: ${response}

Does the actual response adequately address the question and align with the expected answer?

Respond with JSON:
{
  "passed": true/false,
  "reasoning": "Brief explanation of your judgement"
}`;

  const result = await model.generate(prompt);
  const parsed = safeParseJson(result);
  if (!parsed) {
    return {
      checkIndex: 0,
      checkType: "llm_judge",
      passed: false,
      details: { judgement: "error", reasoning: "Invalid JSON response from judge model" },
    };
  }
  
  return {
    checkIndex: 0,
    checkType: "llm_judge",
    passed: parsed.passed,
    details: { judgement: parsed.passed ? "pass" : "fail", reasoning: parsed.reasoning },
  };
}
```

`safeParseJson` should return `null` when parsing fails to avoid throwing from the evaluation path.

### 4. `evaluateResponse(question: string, response: string, expectedBehavior: ExpectedBehavior, context: EvalContext): Promise<{ passed: boolean; checkResults: CheckResult[] }>`

Combines all checks according to the mode (all/any).

```typescript
async function evaluateResponse(
  question: string,
  response: string,
  expectedBehavior: ExpectedBehavior,
  context: { embeddingModel?: EmbeddingModel; llmModel?: LLMModel }
): Promise<{ passed: boolean; checkResults: CheckResult[] }> {
  const checkResults: CheckResult[] = [];
  
  for (let i = 0; i < expectedBehavior.checks.length; i++) {
    const check = expectedBehavior.checks[i];
    let result: CheckResult;
    
    switch (check.type) {
      case "contains_phrases":
        result = evaluateContainsPhrases(response, check);
        break;
      case "semantic_similarity":
        if (!context.embeddingModel) throw new Error("Embedding model required");
        result = await evaluateSemanticSimilarity(response, check, context.embeddingModel);
        break;
      case "llm_judge":
        if (!context.llmModel) throw new Error("LLM model required");
        result = await evaluateLlmJudge(question, response, check, context.llmModel);
        break;
    }
    
    result.checkIndex = i;
    checkResults.push(result);
  }
  
  const passed = expectedBehavior.mode === "all"
    ? checkResults.every(r => r.passed)
    : checkResults.some(r => r.passed);
  
  return { passed, checkResults };
}
```

## Concurrency Control

Only one run per suite at a time. For horizontally scaled deployments, use a Redis-based distributed lock keyed by `suiteId` (Redis is already required for queues). Acquire the lock before starting execution; if the lock can't be acquired, return `queued`.

Given typical run durations of 10-15 minutes, use a lock TTL of 45 minutes and renew every 5 minutes.

```typescript
const RUN_LOCK_TTL_MS = 45 * 60 * 1000;
const RUN_LOCK_RENEW_MS = 5 * 60 * 1000;
const lockKey = `test-suite:run-lock:${suiteId}`;
const lockValue = runId;

const acquired = await redis.set(lockKey, lockValue, "PX", RUN_LOCK_TTL_MS, "NX");
if (!acquired) return { runId, status: "queued" };

const stopRenewal = startLockRenewal(lockKey, lockValue, RUN_LOCK_TTL_MS, RUN_LOCK_RENEW_MS);

try {
  await executeTestRun(runId);
} finally {
  stopRenewal();
  await releaseLock(lockKey, lockValue);
}
```

`startLockRenewal` should extend the TTL periodically and only if the lock value still matches (Lua script). If renewal fails, stop starting new cases and mark the run as failed to avoid overlapping execution. Use the shared Redis client from the queue package to avoid extra connections. For single-instance dev, an in-memory map is acceptable.

Use Redis Lua scripts for renew and release so only the lock owner can extend or delete:

```lua
-- renew_lock.lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
```

```lua
-- release_lock.lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
```

If a run completes and there are pending runs queued for the same suite, start the next pending run in FIFO order.

## Getting Embedding Model

Use the agent's KB embedding model:

```typescript
async function getEmbeddingModelForAgent(agentId: string): Promise<EmbeddingModel | null> {
  // 1. Get agent's attached KBs
  // 2. Get the first KB's embedding model config
  // 3. Return the embedding model instance
}
```

If the suite includes semantic similarity checks but no embedding model is configured, record the test case as `error` with a clear `errorMessage` instead of throwing a fatal run error.

If the suite includes LLM judge checks but no model is configured, record the test case as `error` and continue.

## Cancellation and Timeouts

`DELETE /test-runs/:runId` should set the run status to `cancelled` if it is `pending` or `running`.

Execution should check for cancellation between test cases. If cancelled:
- stop executing additional cases
- finalize counts based on completed cases
- set `completedAt`

Use per-case timeouts for LLM chat calls and evaluations to avoid hanging runs (for example 30-60s per case). On timeout, record a test case `error` and continue.

## Error Handling

- Wrap each test case execution in try/catch
- Record errors in `test_case_results.errorMessage`
- Continue with remaining test cases even if one fails
- Only mark run as "failed" if the entire run can't proceed
