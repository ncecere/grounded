# Testing

## Running Tests

```bash
# Run all tests across the monorepo
bun run test

# Run tests for a specific package/app
bun test --filter apps/api
bun test --filter packages/shared

# Run a specific test file
bun test apps/api/src/services/advanced-rag.test.ts

# Run with watch mode
bun test --watch
```

## Test Structure

Tests are co-located with source files using the `.test.ts` / `.test.tsx` naming convention.

### API Tests
```
apps/api/src/
├── app.test.ts                          # App setup tests
├── routes/
│   ├── agents.test.ts                   # Agent CRUD endpoint tests
│   ├── knowledge-bases.test.ts          # KB endpoint tests
│   ├── sources.test.ts                  # Source endpoint tests
│   ├── chat.test.ts                     # Chat endpoint tests
│   ├── chat-integration.test.ts         # End-to-end chat flow
│   └── hosted-chat.test.ts             # Hosted chat page tests
├── services/
│   ├── advanced-rag.test.ts             # Advanced RAG pipeline tests
│   ├── agent-helpers.test.ts            # Agent config helpers
│   ├── audit.test.ts                    # Audit logging
│   ├── email.test.ts                    # Email service
│   ├── test-runner.test.ts              # Test suite execution
│   └── ...
└── middleware/
    └── auth/
        └── auth.test.ts                 # Auth middleware tests
```

### Worker Tests
```
apps/ingestion-worker/src/
├── bootstrap/
│   ├── helpers.test.ts
│   ├── settings.test.ts
│   ├── shutdown.test.ts
│   └── vector-store.test.ts
├── services/
│   ├── extraction.test.ts              # Content extraction
│   └── robots.test.ts                  # Robots.txt parsing
└── stage-helpers.test.ts

apps/scraper-worker/src/
├── bootstrap/settings.test.ts
├── browser/pool.test.ts                # Browser pool management
├── fetch/
│   ├── http.test.ts                    # HTTP fetch
│   ├── playwright.test.ts             # Headless fetch
│   ├── firecrawl.test.ts             # Firecrawl API
│   └── selection.test.ts             # Fetch mode selection
├── processors/page-fetch.test.ts
└── services/
    ├── content-validation.test.ts
    └── fairness-slots.test.ts
```

### Package Tests
```
packages/shared/src/
├── errors/errors.test.ts
├── errors/http.test.ts
├── types/*.test.ts                     # Type validation tests
└── exports-map.test.ts

packages/db/src/schema/
├── test-suites.test.ts                 # Schema validation
└── test-suites-migration.test.ts
```

## Agent Test Suites (In-App Testing)

Grounded includes a built-in test suite system for evaluating agent quality:

### Creating Test Suites
1. Navigate to an agent → Test Suites tab
2. Create a test suite with cases
3. Each case has a `question` and `expectedBehavior`

### Check Types

**Contains Phrases:**
```json
{
  "type": "contains_phrases",
  "phrases": ["specific text to find"],
  "caseSensitive": false
}
```

**Semantic Similarity:**
```json
{
  "type": "semantic_similarity",
  "expectedAnswer": "The ideal response...",
  "threshold": 0.8
}
```

**LLM Judge:**
```json
{
  "type": "llm_judge",
  "expectedAnswer": "What the answer should cover...",
  "criteria": "Must mention X, Y, Z"
}
```

### Running Tests
- Manual: Click "Run" on a test suite
- Scheduled: `hourly`, `daily`, `weekly`
- Tests execute in parallel, each case gets the agent's response and evaluates against checks

### Prompt Analysis (A/B Testing)
When enabled:
1. Run baseline with current prompt → analyze failures
2. LLM generates improved prompt suggestion
3. Run candidate with suggested prompt
4. Compare pass rates between baseline and candidate
5. Apply winning prompt if desired

### Test Analytics
- Pass rate trends over time (line charts)
- Regression detection with configurable thresholds
- Alert on regression (email notification)
- Per-case result history
