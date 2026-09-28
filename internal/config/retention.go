// Retention defaults (docs/phase5-deploy.md §5 P3, DESIGN.md §8,
// docs/operations/retention.md): the environment default of each
// configurable retention period, and the job's batch bounds. A platform admin
// can override every period in Administration > Retention; the environment
// value applies until they do.
//
// Every period is empty by default, which keeps the data: nothing is
// hard-coded to delete, and each install confirms its periods with its
// records management before setting them (DESIGN.md §8).

package config

import (
	"fmt"
	"strconv"
	"strings"
)

// RetentionPeriod is one configurable retention period.
type RetentionPeriod struct {
	// Kind is the data kind (internal/retention), e.g. "access_log".
	Kind string
	// Env is its environment variable.
	Env string
	// Min and Max bound the number of days.
	Min, Max int
}

// RetentionPeriods lists the configurable periods (conversation periods are
// set per classification level instead).
var RetentionPeriods = []RetentionPeriod{
	// Grace before conversations their users deleted are removed for good.
	{Kind: "deleted_conversations", Env: "RETENTION_DELETED_CONVERSATIONS_DAYS", Min: 0, Max: 36500},
	{Kind: "access_log", Env: "RETENTION_ACCESS_LOG_DAYS", Min: 1, Max: 36500},
	// Daily limits and guardrails read the last day of the ledger.
	{Kind: "usage_events", Env: "RETENTION_USAGE_EVENTS_DAYS", Min: 7, Max: 36500},
	{Kind: "analytics_events", Env: "RETENTION_ANALYTICS_EVENTS_DAYS", Min: 1, Max: 36500},
	{Kind: "audit_log", Env: "RETENTION_AUDIT_LOG_DAYS", Min: 30, Max: 36500},
	// Grace before the stored files of deleted documents and sources are removed.
	{Kind: "deleted_files", Env: "RETENTION_DELETED_FILES_DAYS", Min: 0, Max: 36500},
	// Invites that expired or were revoked (accepted invites are kept).
	{Kind: "expired_invites", Env: "RETENTION_EXPIRED_INVITES_DAYS", Min: 1, Max: 36500},
}

// Retention holds the retention environment defaults.
type Retention struct {
	// Days is each kind's default period in days; a missing kind keeps
	// the data.
	Days map[string]int
	// BatchSize is the number of rows deleted per transaction; MaxBatches
	// bounds one run per kind, so a backlog is worked off over several runs.
	BatchSize, MaxBatches int
}

// RetentionDefaults are the built-in values: keep everything.
func RetentionDefaults() Retention { return Retention{BatchSize: 500, MaxBatches: 100} }

// retentionDays parses a period: empty or "keep" keeps the data.
func retentionDays(p RetentionPeriod) func(*Config, string) error {
	return func(c *Config, v string) error {
		v = strings.ToLower(strings.TrimSpace(v))
		if c.Retention.Days == nil {
			c.Retention.Days = map[string]int{}
		}
		if v == "" || v == "keep" {
			delete(c.Retention.Days, p.Kind)
			return nil
		}
		n, err := strconv.Atoi(v)
		if err != nil || n < p.Min || n > p.Max {
			return fmt.Errorf("must be empty or \"keep\" (keep the data), or a number of days from %d to %d", p.Min, p.Max)
		}
		c.Retention.Days[p.Kind] = n
		return nil
	}
}

func init() {
	for _, p := range RetentionPeriods {
		settings = append(settings, setting{key: p.Env, apply: retentionDays(p)})
	}
	settings = append(settings,
		setting{key: "RETENTION_BATCH_SIZE", apply: integer(func(c *Config) *int { return &c.Retention.BatchSize }, 10, 10000)},
		setting{key: "RETENTION_MAX_BATCHES", apply: integer(func(c *Config) *int { return &c.Retention.MaxBatches }, 1, 10000)},
	)
}
