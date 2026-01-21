CREATE TABLE IF NOT EXISTS agent_test_suites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schedule_type TEXT NOT NULL DEFAULT 'manual',
  schedule_time TEXT,
  schedule_day_of_week INTEGER,
  llm_judge_model_config_id UUID REFERENCES model_configurations(id) ON DELETE SET NULL,
  alert_on_regression BOOLEAN NOT NULL DEFAULT true,
  alert_threshold_percent INTEGER NOT NULL DEFAULT 10,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS agent_test_suites_tenant_idx
  ON agent_test_suites (tenant_id);
CREATE INDEX IF NOT EXISTS agent_test_suites_agent_idx
  ON agent_test_suites (agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_test_suites_agent_name_unique
  ON agent_test_suites (agent_id, name)
  WHERE deleted_at IS NULL;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id UUID NOT NULL REFERENCES agent_test_suites(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  question TEXT NOT NULL,
  expected_behavior JSONB NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS test_cases_suite_idx
  ON test_cases (suite_id);
CREATE INDEX IF NOT EXISTS test_cases_tenant_idx
  ON test_cases (tenant_id);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS test_suite_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id UUID NOT NULL REFERENCES agent_test_suites(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  triggered_by TEXT NOT NULL,
  triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  total_cases INTEGER NOT NULL DEFAULT 0,
  passed_cases INTEGER NOT NULL DEFAULT 0,
  failed_cases INTEGER NOT NULL DEFAULT 0,
  skipped_cases INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS test_suite_runs_suite_idx
  ON test_suite_runs (suite_id);
CREATE INDEX IF NOT EXISTS test_suite_runs_tenant_idx
  ON test_suite_runs (tenant_id);
CREATE INDEX IF NOT EXISTS test_suite_runs_status_idx
  ON test_suite_runs (status);
CREATE INDEX IF NOT EXISTS test_suite_runs_created_at_idx
  ON test_suite_runs (created_at);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS test_case_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES test_suite_runs(id) ON DELETE CASCADE,
  test_case_id UUID NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  actual_response TEXT,
  check_results JSONB,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS test_case_results_run_idx
  ON test_case_results (run_id);
CREATE INDEX IF NOT EXISTS test_case_results_test_case_idx
  ON test_case_results (test_case_id);
CREATE INDEX IF NOT EXISTS test_case_results_tenant_idx
  ON test_case_results (tenant_id);

--> statement-breakpoint

ALTER TABLE agent_test_suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_suite_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_case_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_test_suites_isolation ON agent_test_suites
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY test_cases_isolation ON test_cases
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY test_suite_runs_isolation ON test_suite_runs
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY test_case_results_isolation ON test_case_results
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );
