import { describe, it, expect } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agentTestSuites, testCases, testSuiteRuns, testCaseResults } from "./test-suites";

const getColumnNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name);

const getIndexNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).indexes.map((index) => index.config.name).filter(Boolean);

describe("agent test suite schema", () => {
  it("defines agent_test_suites columns and indexes", () => {
    const columns = getColumnNames(agentTestSuites);
    expect(columns).toContain("schedule_type");
    expect(columns).toContain("schedule_time");
    expect(columns).toContain("schedule_day_of_week");
    expect(columns).toContain("alert_on_regression");
    expect(columns).toContain("alert_threshold_percent");

    const indexes = getIndexNames(agentTestSuites);
    expect(indexes).toContain("agent_test_suites_tenant_idx");
    expect(indexes).toContain("agent_test_suites_agent_idx");
    expect(indexes).toContain("agent_test_suites_agent_name_unique");
  });

  it("defines test_cases columns and indexes", () => {
    const columns = getColumnNames(testCases);
    expect(columns).toContain("expected_behavior");
    expect(columns).toContain("sort_order");
    expect(columns).toContain("is_enabled");

    const indexes = getIndexNames(testCases);
    expect(indexes).toContain("test_cases_suite_idx");
    expect(indexes).toContain("test_cases_tenant_idx");
  });

  it("defines test_suite_runs columns and indexes", () => {
    const columns = getColumnNames(testSuiteRuns);
    expect(columns).toContain("status");
    expect(columns).toContain("triggered_by");
    expect(columns).toContain("passed_cases");
    expect(columns).toContain("failed_cases");
    expect(columns).toContain("skipped_cases");

    const indexes = getIndexNames(testSuiteRuns);
    expect(indexes).toContain("test_suite_runs_suite_idx");
    expect(indexes).toContain("test_suite_runs_tenant_idx");
    expect(indexes).toContain("test_suite_runs_status_idx");
    expect(indexes).toContain("test_suite_runs_created_at_idx");
  });

  it("defines test_case_results columns and indexes", () => {
    const columns = getColumnNames(testCaseResults);
    expect(columns).toContain("check_results");
    expect(columns).toContain("duration_ms");
    expect(columns).toContain("actual_response");

    const indexes = getIndexNames(testCaseResults);
    expect(indexes).toContain("test_case_results_run_idx");
    expect(indexes).toContain("test_case_results_test_case_idx");
    expect(indexes).toContain("test_case_results_tenant_idx");
  });
});
