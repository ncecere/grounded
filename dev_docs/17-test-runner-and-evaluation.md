# Test Runner & Evaluation System

The testing system provides automated quality assurance for RAG agents — from simple phrase matching to LLM-as-judge evaluation, with A/B experimentation and AI-powered prompt analysis.

## Architecture Overview

```
Test Suite (agentTestSuites)
    ├── Test Cases (testCases)               ← Questions + expected behavior
    ├── Test Runs (testSuiteRuns)            ← Execution records
    │   └── Test Case Results (testCaseResults) ← Per-case outcomes
    ├── Experiments (testRunExperiments)      ← A/B baseline vs candidate
    └── Prompt Analyses (testRunPromptAnalyses) ← AI failure diagnosis
```

---

## Test Cases & Expected Behavior

Each test case contains a question and an `ExpectedBehavior` definition:

```typescript
type ExpectedBehavior = {
  checks: Array<
    | { type: "contains_phrases"; phrases: string[]; caseSensitive?: boolean }
    | { type: "semantic_similarity"; expectedAnswer: string; threshold: number }
    | { type: "llm_judge"; expectedAnswer: string; criteria?: string }
  >;
  mode: "all" | "any";  // All checks must pass, or any one suffices
};
```

### Check Types

#### 1. `contains_phrases`

Simple string matching — does the response contain all required phrases?

```typescript
// Evaluation logic (evaluateContainsPhrases):
// - Normalize response (lowercase if !caseSensitive)
// - Check each phrase with .includes()
// - PASS if all phrases found
// Result: { matchedPhrases: [...], missingPhrases: [...] }
```

**Best for:** Ensuring specific terms, citations, or factual data appear in responses.

#### 2. `semantic_similarity`

Embedding-based comparison between the actual response and an expected answer:

```typescript
// Evaluation logic (evaluateSemanticSimilarity):
// 1. Generate embedding for actual response
// 2. Generate embedding for expected answer
// 3. Calculate cosine similarity
// 4. PASS if similarity >= threshold (typically 0.7–0.85)
// Result: { similarityScore: 0.82, threshold: 0.75 }
```

**Requires:** An embedding model configured on one of the agent's knowledge bases.

#### 3. `llm_judge`

An LLM evaluates whether the response adequately addresses the question:

```typescript
// Evaluation logic (evaluateLlmJudge):
// 1. Build evaluation prompt with question, expected answer, actual response
// 2. Call LLM (configured via suite's llmJudgeModelConfigId)
// 3. Parse JSON response: { passed: boolean, reasoning: string }
// 4. On parse failure → retry with stricter prompt
// 5. On second failure → result = FAIL with "Invalid JSON" error
// Result: { judgement: "pass"|"fail", reasoning: "..." }
```

**Requires:** An LLM model configuration assigned to the test suite.

### Response Evaluation

The `evaluateResponse` function orchestrates all checks:

```typescript
// For each check in expectedBehavior.checks:
//   1. Dispatch to the appropriate evaluator
//   2. Record the CheckResult with checkIndex
//
// Final determination:
//   mode === "all" → every check must pass
//   mode === "any" → at least one check must pass
```

---

## Test Runner

**File:** `apps/api/src/services/test-runner.ts` (1,100 lines)

### Factory Pattern

The runner uses dependency injection for testability:

```typescript
createTestRunner(deps?: Partial<TestRunnerDependencies>)
// deps.store        — Database operations (default: Drizzle queries)
// deps.lockManager  — Redis distributed locking
// deps.now          — Clock function (mockable)
// deps.caseTimeoutMs       — Per-case timeout (default: 60s)
// deps.evaluationTimeoutMs — Per-evaluation timeout (default: 45s)
```

### Execution Flow

```
runTestSuite(suiteId, triggeredBy, userId?)
    │
    ├── Validate suite exists & is enabled
    ├── Create test_suite_runs record (status: "pending")
    ├── Acquire distributed lock (Redis SET NX)
    │   ├── Lock acquired → start executeTestRun()
    │   └── Lock not acquired → return "queued"
    │
    ▼
executeTestRun(runId, lockHandle)
    │
    ├── Start lock renewal (every 5 min)
    ├── Load suite, agent, enabled test cases
    ├── Determine system prompt:
    │   └── run.systemPrompt (A/B candidate) || agent.systemPrompt || default
    ├── Update run: status → "running", record startedAt
    ├── Check if embedding/LLM models are needed
    │
    ├── FOR EACH test case:
    │   ├── Check lock validity → abort if lost
    │   ├── Check run status → stop if cancelled
    │   ├── getCaseResponse() → call SimpleRAGService.chat()
    │   ├── evaluateResponse() → run all checks
    │   ├── Insert testCaseResults record
    │   └── Update running totals (passed/failed/skipped)
    │
    ├── Update run: status → "completed"
    ├── checkForRegression() → compare with previous run
    │   └── If regression → sendRegressionAlert() (email)
    │
    └── FINALLY:
        ├── Stop lock renewal
        ├── Release lock
        └── startNextQueuedRun() → process pending runs
```

### Distributed Locking

Only one run per test suite can execute at a time:

| Key | Redis Key Pattern | TTL | Purpose |
|-----|------------------|-----|---------|
| Run lock | `test-suite:run-lock:{suiteId}` | 45 min | Prevents concurrent runs |

**Lock lifecycle:**
1. `SET key runId PX 45min NX` — acquire
2. Lua script: renew every 5 min (only if value matches runId)
3. Lua script: release (only if value matches runId)

If a run can't acquire the lock, it stays `pending`. When the active run finishes, `startNextQueuedRun()` picks up the oldest pending run.

### Regression Detection

After each completed run, the system compares against the previous completed run:

```
checkForRegression(suiteId, currentRunId):
  1. Calculate current pass rate: passedCases / (totalCases - skippedCases)
  2. Find previous completed run for the same suite
  3. Calculate previous pass rate
  4. passRateDrop = previous - current
  5. Find newly failing cases (passed before → failed now)
  6. isRegression if:
     - passRateDrop >= suite.alertThresholdPercent (default: 10%), OR
     - newlyFailingCases.length > 0
```

Regression alerts are sent via email to tenant owners/admins (uses the layered alert settings system).

---

## A/B Experiment System

**File:** `apps/api/src/services/ab-experiment.ts` (732 lines)

A/B experiments compare two system prompts by running the same test suite with each.

### Experiment Lifecycle

```
Status flow:
  pending → baseline_running → analyzing → candidate_running → completed
                                                              → failed
```

```
startExperiment(suiteId)  OR  startExperimentWithPrompt(suiteId, prompt)
    │
    ├── Create testRunExperiments record
    ├── Start baseline run (current agent prompt)
    │   ├── Create run with promptVariant: "baseline"
    │   ├── Try lock acquisition
    │   │   ├── Acquired → executeBaselineAndContinue()
    │   │   └── Not acquired → pollAndContinueExperiment() (poll every 5s, max 1hr)
    │
    ▼ (after baseline completes)
    │
    ├── Update status → "analyzing"
    ├── Run prompt analysis (if enabled)
    │   └── Produces failure clusters + suggested prompt
    ├── Determine candidate prompt:
    │   ├── Pre-set from startExperimentWithPrompt() → use it
    │   └── Analysis suggested prompt → use it
    │   └── Neither available → complete without candidate
    │
    ├── Update status → "candidate_running"
    ├── Start candidate run (with prompt override)
    │   ├── Store prompt in Redis: test-run:prompt-override:{runId} (1hr TTL)
    │   ├── Create run with promptVariant: "candidate", systemPrompt set
    │   └── Execute run
    │
    └── Update status → "completed"
```

### Two Entry Points

| Method | Use Case |
|--------|----------|
| `startExperiment()` | A/B with auto-generated prompt (requires `promptAnalysisEnabled` + `abTestingEnabled`) |
| `startExperimentWithPrompt()` | A/B with user-provided candidate prompt |

### Experiment Comparison

`getExperimentComparison(experimentId)` returns:

```typescript
{
  experiment: { ... },
  baseline: { runId, passRate, passedCases, failedCases, totalCases, systemPrompt },
  candidate: { runId, passRate, passedCases, failedCases, totalCases, systemPrompt },
  delta: { passRate: +5.2, passedCases: +3, failedCases: -3 }
}
```

---

## Prompt Analysis

**File:** `apps/api/src/services/prompt-analysis.ts` (1,097 lines)

AI-powered analysis of test failures that suggests prompt improvements.

### Two-Phase Analysis

**Phase 1 — Diagnosis** (structured output via `generateObject`):

```
Input: System prompt + failed/passed test case results
Output (PromptAnalysisDraft):
  - summary: "1-2 sentence diagnosis"
  - failureClusters: [
      { category: "missing_citations", description: "...",
        affectedCases: ["How do I...", "What is..."],
        suggestedFix: "Add explicit citation instructions" }
    ]
  - rewriteGuidance: "Specific changes to make"
```

**Phase 2 — Prompt Rewrite** (via `generateObject`):

```
Input: Original prompt + diagnosis + failure signals + stats
Output (PromptSuggestion):
  - suggestedPrompt: "Complete revised system prompt text"
```

### Quality Safeguards

1. **Placeholder preservation:** Detects `{{vars}}`, `${vars}`, `[[vars]]`, `<<vars>>` in the original prompt and ensures they appear in the rewrite
2. **Length bounds:** If the rewrite is < 60% or > 160% of the original length, triggers a retry with length constraints
3. **Auto-retry:** If placeholders are missing or length is out of bounds, sends a second request with explicit requirements
4. **Fallback pipeline:** If structured output fails → legacy JSON generation → simple single-field analysis

### Context Construction

The analysis prompt is carefully constructed to stay within token limits:

| Limit | Value | Purpose |
|-------|-------|---------|
| `MAX_FAILED_CASES` | 8 | Failed case samples in context |
| `MAX_PASSED_CASES` | 4 | Passed case samples for comparison |
| `MAX_RESPONSE_CHARS` | 500 | Per-response truncation |
| `MAX_FAILURE_CLUSTERS` | 4 | Output cluster limit |
| `MAX_AFFECTED_CASES` | 6 | Per-cluster case list |

### Failure Signal Aggregation

Before sending to the LLM, the system pre-computes aggregate statistics:

```
FailureSignalSummary:
  - checkTypeStats: { contains_phrases: { total: 15, failed: 8 }, ... }
  - missingPhrases: [{ phrase: "citation", count: 5 }, ...] (top 6)
  - similarityStats: { avgScore, minScore, maxScore, avgThreshold }
  - judgeReasons: ["Too verbose", "Missing context"] (top 3)
```

This structured data helps the LLM identify patterns rather than analyzing raw case data.

---

## Test Suite Configuration

### Schema Fields

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `scheduleType` | manual/hourly/daily/weekly | manual | Run schedule |
| `scheduleTime` | text | null | Time for daily/weekly (e.g., "09:00") |
| `scheduleDayOfWeek` | integer | null | Day for weekly (0=Sun) |
| `llmJudgeModelConfigId` | uuid | null | Model for llm_judge checks |
| `alertOnRegression` | boolean | true | Enable regression alerts |
| `alertThresholdPercent` | integer | 10 | Min pass-rate drop to trigger alert |
| `promptAnalysisEnabled` | boolean | false | Enable AI prompt analysis |
| `abTestingEnabled` | boolean | false | Enable A/B experiments |
| `analysisModelConfigId` | uuid | null | Model for prompt analysis |
| `manualCandidatePrompt` | text | null | Stored candidate prompt for A/B |

### Test Suite Run Record

Each run records:

| Field | Type | Purpose |
|-------|------|---------|
| `status` | pending/running/completed/failed/cancelled | Run state |
| `triggeredBy` | manual/schedule | How the run was initiated |
| `totalCases` / `passedCases` / `failedCases` / `skippedCases` | int | Counters |
| `systemPrompt` | text | The actual prompt used (important for A/B) |
| `promptVariant` | baseline/candidate | A/B experiment role |
| `experimentId` | uuid | Links to experiment record |

---

## Background Services

### Test Suite Scheduler

Periodically checks for suites with scheduleType ≠ "manual" and triggers runs at the appropriate time.

### Test Suite Lock Recovery

Recovers from stale locks (e.g., process crash during a run):
- Scans for runs stuck in "running" status beyond the lock TTL
- Releases orphaned Redis locks
- Marks runs as "failed" with appropriate error messages

### Prompt Analysis Storage

Analysis results are stored in `test_run_prompt_analyses`:
- `summary`, `failureClusters`, `suggestedPrompt`, `rationale`
- `appliedAt` — set when the user applies the suggested prompt to their agent
- Linked to both the run and (optionally) the experiment

---

## File Map

| File | Lines | Purpose |
|------|-------|---------|
| `packages/db/src/schema/test-suites.ts` | ~260 | All test-related tables and types |
| `apps/api/src/services/test-runner.ts` | 1,100 | Core runner, evaluation, regression detection |
| `apps/api/src/services/ab-experiment.ts` | 732 | A/B experiment lifecycle |
| `apps/api/src/services/prompt-analysis.ts` | 1,097 | AI-powered failure diagnosis and prompt rewriting |
| `apps/api/src/services/test-suite-scheduler.ts` | — | Scheduled run triggering |
| `apps/api/src/services/test-suite-lock-recovery.ts` | — | Stale lock cleanup |
| `apps/api/src/services/test-suite-metrics.ts` | — | Metrics aggregation |
| `apps/api/src/services/test-suite-import.ts` | — | Import test cases from file |

---

## Related Docs

- [09 — Testing (dev)](./09-testing.md) — How to run tests, check types overview
- [06 — RAG & Chat](./06-rag-and-chat.md) — How SimpleRAGService.chat() works (used by getCaseResponse)
- [14 — Security](./14-security.md) — Role requirements for test suite operations
