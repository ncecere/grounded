import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle/0006_agent_test_suites.sql"
);

const migrationSql = readFileSync(migrationPath, "utf8");

describe("agent test suite migration", () => {
  it("creates the core test suite tables", () => {
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS agent_test_suites");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS test_cases");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS test_suite_runs");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS test_case_results");
  });

  it("adds indexes and uniqueness constraints", () => {
    expect(migrationSql).toContain("agent_test_suites_tenant_idx");
    expect(migrationSql).toContain("agent_test_suites_agent_idx");
    expect(migrationSql).toContain("agent_test_suites_agent_name_unique");
    expect(migrationSql).toContain("test_cases_suite_idx");
    expect(migrationSql).toContain("test_cases_tenant_idx");
    expect(migrationSql).toContain("test_suite_runs_suite_idx");
    expect(migrationSql).toContain("test_suite_runs_status_idx");
    expect(migrationSql).toContain("test_case_results_run_idx");
  });

  it("enables RLS policies for tenant isolation", () => {
    expect(migrationSql).toContain("ALTER TABLE agent_test_suites ENABLE ROW LEVEL SECURITY");
    expect(migrationSql).toContain("ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY");
    expect(migrationSql).toContain("ALTER TABLE test_suite_runs ENABLE ROW LEVEL SECURITY");
    expect(migrationSql).toContain("ALTER TABLE test_case_results ENABLE ROW LEVEL SECURITY");
    expect(migrationSql).toContain("CREATE POLICY agent_test_suites_isolation");
    expect(migrationSql).toContain("CREATE POLICY test_case_results_isolation");
  });
});
