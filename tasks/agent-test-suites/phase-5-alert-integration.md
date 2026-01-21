# Phase 5: Alert Integration

## Overview

Integrate test suite regressions with the existing tenant alert system to notify users when test pass rates drop.

## Regression Detection

A regression occurs when:
1. Pass rate drops by X% from the previous run (configurable `alertThresholdPercent`)
2. A test case that passed in the previous run now fails

Only evaluate regressions for `completed` runs. Skip runs that are `failed` or `cancelled`, or runs with zero executed cases.

## Implementation

### Regression Check Function

Add to `apps/api/src/services/test-runner.ts`:

```typescript
interface RegressionInfo {
  isRegression: boolean;
  previousPassRate: number;
  currentPassRate: number;
  passRateDrop: number;
  newlyFailingCases: Array<{
    testCaseId: string;
    testCaseName: string;
    question: string;
  }>;
}

async function checkForRegression(
  suiteId: string,
  currentRunId: string
): Promise<RegressionInfo> {
  // Get the current run
  const currentRun = await db.query.testSuiteRuns.findFirst({
    where: eq(testSuiteRuns.id, currentRunId),
  });
  
  if (!currentRun || currentRun.status !== "completed") {
    return { isRegression: false, previousPassRate: 0, currentPassRate: 0, passRateDrop: 0, newlyFailingCases: [] };
  }
  
  // Get the previous completed run
  const previousRun = await db.query.testSuiteRuns.findFirst({
    where: and(
      eq(testSuiteRuns.suiteId, suiteId),
      eq(testSuiteRuns.status, "completed"),
      lt(testSuiteRuns.createdAt, currentRun.createdAt)
    ),
    orderBy: desc(testSuiteRuns.createdAt),
  });
  
  if (!previousRun) {
    // First run, no regression possible
    return { isRegression: false, previousPassRate: 0, currentPassRate: 0, passRateDrop: 0, newlyFailingCases: [] };
  }
  
  // Calculate pass rates
  const currentPassRate = calculatePassRate(currentRun);
  const previousPassRate = calculatePassRate(previousRun);
  const passRateDrop = previousPassRate - currentPassRate;
  
  // Get suite settings
  const suite = await db.query.agentTestSuites.findFirst({
    where: eq(agentTestSuites.id, suiteId),
  });
  
  if (!suite?.alertOnRegression) {
    return { isRegression: false, previousPassRate, currentPassRate, passRateDrop, newlyFailingCases: [] };
  }
  
  // Check if pass rate dropped beyond threshold
  const thresholdExceeded = passRateDrop >= suite.alertThresholdPercent;
  
  // Find newly failing cases
  const newlyFailingCases = await findNewlyFailingCases(currentRunId, previousRun.id);
  
  const isRegression = thresholdExceeded || newlyFailingCases.length > 0;
  
  return {
    isRegression,
    previousPassRate,
    currentPassRate,
    passRateDrop,
    newlyFailingCases,
  };
}

function calculatePassRate(run: TestSuiteRun): number {
  const totalCounted = run.totalCases - run.skippedCases;
  if (totalCounted === 0) return 100;
  return (run.passedCases / totalCounted) * 100;
}

async function findNewlyFailingCases(
  currentRunId: string,
  previousRunId: string
): Promise<Array<{ testCaseId: string; testCaseName: string; question: string }>> {
  // Get results from both runs
  const [currentResults, previousResults] = await Promise.all([
    db.query.testCaseResults.findMany({
      where: eq(testCaseResults.runId, currentRunId),
      with: { testCase: true },
    }),
    db.query.testCaseResults.findMany({
      where: eq(testCaseResults.runId, previousRunId),
    }),
  ]);
  
  // Build map of previous results by test case ID
  const previousStatusMap = new Map(
    previousResults.map(r => [r.testCaseId, r.status])
  );
  
  // Find cases that passed before but fail now
  return currentResults
    .filter(r => {
      const previousStatus = previousStatusMap.get(r.testCaseId);
      return previousStatus === "passed" && r.status === "failed";
    })
    .map(r => ({
      testCaseId: r.testCaseId,
      testCaseName: r.testCase.name,
      question: r.testCase.question,
    }));
}
```

### Sending Regression Alerts

Use the existing tenant alert infrastructure:

```typescript
async function sendRegressionAlert(
  suiteId: string,
  runId: string,
  regression: RegressionInfo
): Promise<void> {
  // Get suite with agent and tenant info
  const suite = await db.query.agentTestSuites.findFirst({
    where: eq(agentTestSuites.id, suiteId),
    with: {
      agent: {
        with: {
          tenant: true,
        },
      },
    },
  });
  
  if (!suite) return;
  
  // Get tenant alert settings
  const alertSettings = await db.query.tenantAlertSettings.findFirst({
    where: eq(tenantAlertSettings.tenantId, suite.agent.tenantId),
  });
  
  // Build recipient list (similar to health alerts)
  const recipients = await getAlertRecipients(suite.agent.tenantId, alertSettings);
  
  if (recipients.length === 0) {
    log.debug("api", "TestRunner: No recipients for regression alert", { suiteId });
    return;
  }
  
  // Send email
  await emailService.sendTestRegressionAlert(recipients, {
    tenantName: suite.agent.tenant.name,
    agentName: suite.agent.name,
    suiteName: suite.name,
    runId,
    previousPassRate: regression.previousPassRate,
    currentPassRate: regression.currentPassRate,
    passRateDrop: regression.passRateDrop,
    newlyFailingCases: regression.newlyFailingCases,
    runUrl: `${getAppUrl()}/agents/${suite.agentId}/test-suites/${suiteId}/runs/${runId}`,
  });
  
  log.info("api", "TestRunner: Sent regression alert", { 
    suiteId, 
    runId, 
    recipients: recipients.length 
  });
}
```

### Email Template

Add to `apps/api/src/services/email.ts`:

```typescript
async function sendTestRegressionAlert(
  recipients: string[],
  data: {
    tenantName: string;
    agentName: string;
    suiteName: string;
    runId: string;
    previousPassRate: number;
    currentPassRate: number;
    passRateDrop: number;
    newlyFailingCases: Array<{ testCaseId: string; testCaseName: string; question: string }>;
    runUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `[Grounded] Test Regression: ${data.suiteName} for ${data.agentName}`;
  
  const html = `
    <h2>Test Suite Regression Detected</h2>
    
    <p><strong>Tenant:</strong> ${data.tenantName}</p>
    <p><strong>Agent:</strong> ${data.agentName}</p>
    <p><strong>Test Suite:</strong> ${data.suiteName}</p>
    
    <h3>Pass Rate Change</h3>
    <p>
      Previous: <strong>${data.previousPassRate.toFixed(1)}%</strong><br>
      Current: <strong>${data.currentPassRate.toFixed(1)}%</strong><br>
      Drop: <strong style="color: red;">${data.passRateDrop.toFixed(1)}%</strong>
    </p>
    
    ${data.newlyFailingCases.length > 0 ? `
      <h3>Newly Failing Tests (${data.newlyFailingCases.length})</h3>
      <ul>
        ${data.newlyFailingCases.map(tc => `
          <li>
            <strong>${tc.testCaseName}</strong><br>
            <em>${tc.question}</em>
          </li>
        `).join("")}
      </ul>
    ` : ""}
    
    <p><a href="${data.runUrl}">View Run Details</a></p>
  `;
  
  return this.sendEmail(recipients, subject, html);
}
```

### Integration in Test Runner

At the end of `executeTestRun()`:

```typescript
async function executeTestRun(runId: string): Promise<void> {
  // ... existing run execution logic ...
  
  // After run completes successfully
  if (run.status === "completed") {
    const regression = await checkForRegression(run.suiteId, runId);
    
    if (regression.isRegression) {
      log.info("api", "TestRunner: Regression detected", {
        suiteId: run.suiteId,
        runId,
        passRateDrop: regression.passRateDrop,
        newlyFailingCount: regression.newlyFailingCases.length,
      });
      
      await sendRegressionAlert(run.suiteId, runId, regression);
    }
  }
}
```

## Tenant Alert Settings Extension

Optionally extend `tenantAlertSettings` to include test-specific settings:

```typescript
// In schema
testRegressionAlertsEnabled: boolean().default(true),
testAlertRecipients: text(), // Comma-separated, overrides default
```

For MVP, just use the existing alert recipients.
