package app

import (
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/contenthealth"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/gaps"
	"github.com/ncecere/grounded/internal/profilemig"
)

// wireKnowledgeWorkflows connects profile migration, evaluation callbacks and
// diagnostic reports after the core services and shared infrastructure exist.
func wireKnowledgeWorkflows(s *Services, cfg config.Config) {
	s.ProfileMigrations = profilemig.New(s.pool, s.Catalog, s.Teams, s.Notify, s.jobs, profilemig.Options{
		GraceDays: cfg.ProfileMigrationGraceDays, BatchSize: cfg.EmbedBatchSize, BatchTokens: cfg.EmbedBatchTokens,
	}, s.log)
	s.Evaluations = evals.New(s.pool, s.Teams, s.KBs, s.Agents, s.Limits, s.Notify, s.jobs, s.log)
	s.Evaluations.Concurrency = cfg.EvaluationConcurrency
	// Automatic evaluation runs: after a publish, profile switch or ready preview.
	s.Agents.OnPublished, s.ProfileMigrations.OnSwitched = s.Evaluations.QueueForAgent, s.Evaluations.QueueForKB
	s.ProfileMigrations.OnPreviewReady = s.Evaluations.StartPreview
	s.Gaps = gaps.New(s.pool, s.Teams, s.Evaluations, s.log)
	s.ContentHealth = contenthealth.New(s.pool, s.Teams, s.jobs, s.log)
}
