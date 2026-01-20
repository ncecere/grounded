import { describe, expect, it } from "bun:test";
import {
  AgentTestHealthTable,
  getPassRateTrend,
  sortAgentTestHealthRows,
  formatLastRun,
  type AgentTestHealthRow,
} from "./AgentTestHealthTable";

describe("AgentTestHealthTable module", () => {
  it("should export AgentTestHealthTable component", () => {
    expect(AgentTestHealthTable).toBeDefined();
  });
});

describe("getPassRateTrend", () => {
  it("should detect upward, downward, stable, and unknown trends", () => {
    expect(getPassRateTrend(2)).toBe("up");
    expect(getPassRateTrend(-1.2)).toBe("down");
    expect(getPassRateTrend(0.2)).toBe("stable");
    expect(getPassRateTrend(null)).toBe("unknown");
  });
});

describe("sortAgentTestHealthRows", () => {
  const rows: AgentTestHealthRow[] = [
    {
      agentId: "agent-1",
      agentName: "Bravo",
      suiteCount: 3,
      caseCount: 10,
      passRate: 62,
      passRateChange: -1,
      lastRunAt: null,
      lastRunStatus: null,
    },
    {
      agentId: "agent-2",
      agentName: "Alpha",
      suiteCount: 5,
      caseCount: 22,
      passRate: 91,
      passRateChange: 2.5,
      lastRunAt: "2026-01-10T12:00:00Z",
      lastRunStatus: "completed",
    },
    {
      agentId: "agent-3",
      agentName: "Charlie",
      suiteCount: 1,
      caseCount: 4,
      passRate: null,
      passRateChange: null,
      lastRunAt: "2026-01-12T12:00:00Z",
      lastRunStatus: "failed",
    },
  ];

  it("should sort by pass rate descending", () => {
    const sorted = sortAgentTestHealthRows(rows, { key: "passRate", direction: "desc" });

    expect(sorted[0].agentName).toBe("Alpha");
    expect(sorted[1].agentName).toBe("Bravo");
    expect(sorted[2].agentName).toBe("Charlie");
  });

  it("should sort by agent name ascending", () => {
    const sorted = sortAgentTestHealthRows(rows, { key: "agent", direction: "asc" });

    expect(sorted[0].agentName).toBe("Alpha");
    expect(sorted[1].agentName).toBe("Bravo");
    expect(sorted[2].agentName).toBe("Charlie");
  });
});

describe("formatLastRun", () => {
  it("should return fallback when no run", () => {
    expect(formatLastRun(null)).toBe("No runs");
  });
});
