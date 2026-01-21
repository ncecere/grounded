import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants, users } from "./tenants";
import { agents } from "./agents";
import { modelConfigurations } from "./ai-models";

export type ExpectedBehavior = {
  checks: Array<
    | { type: "contains_phrases"; phrases: string[]; caseSensitive?: boolean }
    | { type: "semantic_similarity"; expectedAnswer: string; threshold: number }
    | { type: "llm_judge"; expectedAnswer: string; criteria?: string }
  >;
  mode: "all" | "any";
};

export type CheckResult = {
  checkIndex: number;
  checkType: "contains_phrases" | "semantic_similarity" | "llm_judge";
  passed: boolean;
  details: {
    matchedPhrases?: string[];
    missingPhrases?: string[];
    similarityScore?: number;
    threshold?: number;
    judgement?: string;
    reasoning?: string;
  };
};

export const agentTestSuites = pgTable(
  "agent_test_suites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    scheduleType: text("schedule_type")
      .$type<"manual" | "hourly" | "daily" | "weekly">()
      .default("manual")
      .notNull(),
    scheduleTime: text("schedule_time"),
    scheduleDayOfWeek: integer("schedule_day_of_week"),
    llmJudgeModelConfigId: uuid("llm_judge_model_config_id").references(
      () => modelConfigurations.id,
      {
        onDelete: "set null",
      }
    ),
    alertOnRegression: boolean("alert_on_regression").default(true).notNull(),
    alertThresholdPercent: integer("alert_threshold_percent").default(10).notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_test_suites_tenant_idx").on(table.tenantId),
    index("agent_test_suites_agent_idx").on(table.agentId),
    uniqueIndex("agent_test_suites_agent_name_unique")
      .on(table.agentId, table.name)
      .where(sql`deleted_at IS NULL`),
  ]
);

export const testCases = pgTable(
  "test_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => agentTestSuites.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    question: text("question").notNull(),
    expectedBehavior: jsonb("expected_behavior").$type<ExpectedBehavior>().notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("test_cases_suite_idx").on(table.suiteId),
    index("test_cases_tenant_idx").on(table.tenantId),
  ]
);

export const testSuiteRuns = pgTable(
  "test_suite_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => agentTestSuites.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"pending" | "running" | "completed" | "failed" | "cancelled">()
      .default("pending")
      .notNull(),
    triggeredBy: text("triggered_by").$type<"manual" | "schedule">().notNull(),
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    totalCases: integer("total_cases").default(0).notNull(),
    passedCases: integer("passed_cases").default(0).notNull(),
    failedCases: integer("failed_cases").default(0).notNull(),
    skippedCases: integer("skipped_cases").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    systemPrompt: text("system_prompt"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("test_suite_runs_suite_idx").on(table.suiteId),
    index("test_suite_runs_tenant_idx").on(table.tenantId),
    index("test_suite_runs_status_idx").on(table.status),
    index("test_suite_runs_created_at_idx").on(table.createdAt),
  ]
);

export const testCaseResults = pgTable(
  "test_case_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => testSuiteRuns.id, { onDelete: "cascade" }),
    testCaseId: uuid("test_case_id")
      .notNull()
      .references(() => testCases.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: text("status").$type<"passed" | "failed" | "skipped" | "error">().notNull(),
    actualResponse: text("actual_response"),
    checkResults: jsonb("check_results").$type<CheckResult[]>(),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("test_case_results_run_idx").on(table.runId),
    index("test_case_results_test_case_idx").on(table.testCaseId),
    index("test_case_results_tenant_idx").on(table.tenantId),
  ]
);
