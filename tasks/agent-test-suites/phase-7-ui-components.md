# Phase 7: UI Components

## Overview

React components for the test suites feature, following the existing app patterns (slide-out panels, cards, etc.).

## Page Structure

### Navigation

Add "Test Suites" to the sidebar under a new section or as a sub-item of Agents.

**Option A:** Separate top-level page
- Sidebar: Agents | Test Suites | Knowledge Bases | ...
- URL concept: `/test-suites`

**Option B:** Accessed through Agent detail (Recommended)
- Add "Test Suites" tab to AgentDetailPanel
- Or add "Test Suites" button on agent card that opens dedicated view

For MVP, go with **Option B** - access test suites through the agent.

## File Structure

```
apps/web/src/components/test-suites/
├── index.ts
├── TestSuiteCard.tsx
├── TestSuiteDetailPanel.tsx
├── TestSuiteList.tsx
├── TestCaseCard.tsx
├── TestCaseForm.tsx
├── TestRunCard.tsx
├── TestRunDetailPanel.tsx
├── ExpectedBehaviorEditor.tsx
├── CheckResultDisplay.tsx
├── PassRateChart.tsx
└── ImportTestCasesDialog.tsx

apps/web/src/pages/
└── TestSuites.tsx  (or integrate into Agents.tsx)
```

## Components

### 1. TestSuiteCard

Card showing a test suite summary with hover actions.

```tsx
interface TestSuiteCardProps {
  suite: TestSuite;
  onSelect: () => void;
  onRunTests: () => void;
}

// Display:
// - Name and description
// - Schedule badge (Manual, Hourly, Daily, Weekly)
// - Test case count
// - Last run status with pass rate (color-coded)
// - Enabled/disabled state

// Hover actions:
// - Run Tests (play icon)
// - Edit (opens panel)
// - Delete
```

### 2. TestSuiteDetailPanel

Slide-out panel for creating/editing a test suite. Tabs:

**Tab 1: General**
- Name (required)
- Description
- Enabled toggle

**Tab 2: Schedule**
- Schedule type dropdown (Manual, Hourly, Daily, Weekly)
- Time picker (for Daily/Weekly)
- Day of week picker (for Weekly)

**Tab 3: Evaluation**
- LLM Judge Model selector (dropdown of available models)
- Default: use system default
- Alert on regression toggle
- Alert threshold % slider (1-50%)

**Tab 4: Test Cases**
- List of test cases with inline add/edit
- Import from JSONL button
- Export button
- Drag to reorder

### 3. TestCaseCard

Card for individual test case in the list.

```tsx
interface TestCaseCardProps {
  testCase: TestCase;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}

// Display:
// - Name
// - Question (truncated)
// - Check types badges (Contains, Semantic, LLM Judge)
// - Last result status badge
// - Enabled toggle
```

### 4. TestCaseForm

Form for creating/editing a test case.

```tsx
interface TestCaseFormProps {
  testCase?: TestCase;
  onSave: (data: CreateTestCaseDto | UpdateTestCaseDto) => void;
  onCancel: () => void;
}

// Fields:
// - Name
// - Description (optional)
// - Question (textarea)
// - Expected Behavior (uses ExpectedBehaviorEditor)
```

### 5. ExpectedBehaviorEditor

Complex component for editing the expected behavior checks.

```tsx
interface ExpectedBehaviorEditorProps {
  value: ExpectedBehavior;
  onChange: (value: ExpectedBehavior) => void;
}

// Features:
// - Mode toggle: All checks must pass / Any check can pass
// - Add check button with type selector
// - List of checks with:
//   - Contains Phrases: multi-input for phrases, case sensitive toggle
//   - Semantic Similarity: expected answer textarea, threshold slider (0.5-1.0)
//   - LLM Judge: expected answer textarea, optional criteria textarea
// - Remove check button
// - Drag to reorder checks
```

### 6. TestRunCard

Card showing a test run in the runs list.

```tsx
interface TestRunCardProps {
  run: TestSuiteRun;
  onSelect: () => void;
}

// Display:
// - Status badge (Pending, Running, Completed, Failed)
// - Triggered by (Manual by User / Schedule)
// - Pass rate with visual bar
// - Passed/Failed/Skipped counts
// - Duration
// - Timestamp
```

### 7. TestRunDetailPanel

Slide-out panel showing run details and results.

```tsx
interface TestRunDetailPanelProps {
  runId: string;
  onClose: () => void;
}

// Sections:
// 1. Summary header
//    - Status, pass rate, duration
//    - Triggered by info
//    
// 2. Results list
//    - Filterable by status (All, Passed, Failed, Error)
//    - Each result shows:
//      - Test case name and question
//      - Status badge
//      - Expand to see:
//        - Actual response
//        - Check results (using CheckResultDisplay)
//        - Duration
//        - Error message if any
```

### 8. CheckResultDisplay

Shows the result of a single check evaluation.

```tsx
interface CheckResultDisplayProps {
  check: ExpectedCheck;
  result: CheckResult;
}

// Display varies by type:
// 
// Contains Phrases:
// - List matched phrases (green checkmarks)
// - List missing phrases (red X)
//
// Semantic Similarity:
// - Score vs threshold visualization
// - "0.85 / 0.80 required"
//
// LLM Judge:
// - Pass/Fail badge
// - Reasoning text
```

### 9. PassRateChart

Chart showing pass rate trend over time.

```tsx
interface PassRateChartProps {
  analytics: TestSuiteAnalytics;
}

// Simple line chart using recharts or similar
// X-axis: date
// Y-axis: pass rate %
// Highlight regression points
```

### 10. ImportTestCasesDialog

Dialog for importing test cases from JSONL.

```tsx
interface ImportTestCasesDialogProps {
  suiteId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Features:
// - File drop zone
// - Format instructions
// - Preview of parsed cases
// - Import button
// - Results summary (imported, skipped, errors)
```

## Integration with Agent Page

### Option 1: Add Tab to AgentDetailPanel

Add a "Test Suites" tab to the existing `AgentDetailPanel.tsx`:

```tsx
// In AgentDetailPanel.tsx tabs
<Tabs.Content value="test-suites">
  <TestSuiteList agentId={agent.id} />
</Tabs.Content>
```

### Option 2: Separate Button/Link

Add a "Test Suites" button to the agent card or detail panel that navigates to a dedicated view:

```tsx
// In AgentCard.tsx or AgentDetailPanel.tsx
<Button onClick={() => setPage("test-suites", { agentId: agent.id })}>
  Test Suites ({testSuiteCount})
</Button>
```

**Recommendation:** Start with Option 1 (tab) for simplicity, can extract to separate page later if needed.

## Styling Guidelines

- Use existing Radix UI components (Dialog, Tabs, Select, etc.)
- Follow card pattern from AgentCard/KBCard
- Use slide-out panel pattern from AgentDetailPanel/KBDetailPanel
- Color scheme:
  - Passed: green (bg-green-100, text-green-800)
  - Failed: red (bg-red-100, text-red-800)
  - Pending/Running: blue (bg-blue-100, text-blue-800)
  - Skipped: gray (bg-gray-100, text-gray-600)
  - Error: orange (bg-orange-100, text-orange-800)

## State Management

Use TanStack Query hooks from phase 6:
- `useTestSuites(agentId)` for list
- `useTestSuite(suiteId)` for detail
- `useTestCases(suiteId)` for cases
- `useTestRuns(suiteId)` for run history
- `useTestRun(runId)` for run detail with polling

## Loading & Error States

- Skeleton loaders for cards and lists
- Empty states with helpful messages
- Error boundaries with retry buttons
- Toast notifications for actions (create, update, delete, run started)

## Responsive Considerations

- Cards stack on mobile
- Panel takes full width on mobile
- Tables become card lists on mobile
- Chart simplifies on small screens
