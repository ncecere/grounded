-- Add prompt analysis fields to agent_test_suites
ALTER TABLE agent_test_suites
ADD COLUMN prompt_analysis_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN ab_testing_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN analysis_model_config_id uuid REFERENCES model_configurations(id) ON DELETE SET NULL,
ADD COLUMN manual_candidate_prompt text;

-- Add prompt variant and experiment tracking to test_suite_runs
ALTER TABLE test_suite_runs
ADD COLUMN prompt_variant text,
ADD COLUMN experiment_id uuid;

CREATE INDEX test_suite_runs_experiment_idx ON test_suite_runs(experiment_id);

-- Create test_run_experiments table for A/B testing
CREATE TABLE test_run_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  suite_id uuid NOT NULL REFERENCES agent_test_suites(id) ON DELETE CASCADE,
  baseline_run_id uuid REFERENCES test_suite_runs(id) ON DELETE SET NULL,
  candidate_run_id uuid REFERENCES test_suite_runs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  candidate_source text,
  candidate_prompt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX test_run_experiments_tenant_idx ON test_run_experiments(tenant_id);
CREATE INDEX test_run_experiments_suite_idx ON test_run_experiments(suite_id);
CREATE INDEX test_run_experiments_status_idx ON test_run_experiments(status);

-- Add foreign key from test_suite_runs.experiment_id to test_run_experiments
ALTER TABLE test_suite_runs
ADD CONSTRAINT test_suite_runs_experiment_fk
FOREIGN KEY (experiment_id) REFERENCES test_run_experiments(id) ON DELETE SET NULL;

-- Create test_run_prompt_analyses table
CREATE TABLE test_run_prompt_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  suite_id uuid NOT NULL REFERENCES agent_test_suites(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES test_suite_runs(id) ON DELETE CASCADE,
  experiment_id uuid REFERENCES test_run_experiments(id) ON DELETE CASCADE,
  model_config_id uuid REFERENCES model_configurations(id) ON DELETE SET NULL,
  summary text,
  failure_clusters jsonb,
  suggested_prompt text,
  rationale text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX test_run_prompt_analyses_tenant_idx ON test_run_prompt_analyses(tenant_id);
CREATE INDEX test_run_prompt_analyses_suite_idx ON test_run_prompt_analyses(suite_id);
CREATE INDEX test_run_prompt_analyses_run_idx ON test_run_prompt_analyses(run_id);
CREATE INDEX test_run_prompt_analyses_experiment_idx ON test_run_prompt_analyses(experiment_id);

-- Enable RLS on new tables
ALTER TABLE test_run_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_run_prompt_analyses ENABLE ROW LEVEL SECURITY;

-- RLS policies for test_run_experiments
CREATE POLICY test_run_experiments_tenant_isolation ON test_run_experiments
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- RLS policies for test_run_prompt_analyses
CREATE POLICY test_run_prompt_analyses_tenant_isolation ON test_run_prompt_analyses
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
