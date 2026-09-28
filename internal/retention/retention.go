// Package retention deletes data whose retention period has passed, and
// keeps whatever a legal hold covers (DESIGN.md §8, ADR-0010,
// docs/phase5-deploy.md §5 P3, docs/operations/retention.md).
//
// Each kind of data is a rule: one SQL query selects the rows due for
// deletion, with the team, classification rank, audience and reason of each
// and whether a legal hold covers it. The same query serves the dry-run
// report (counts only, writes nothing) and the purge (bounded batches of
// unheld rows, one transaction each), so the report shows exactly what the
// next run deletes.
//
// Periods: conversations follow their classification level (signed-in and
// anonymous retention, migrations 00016 and 00023); every other kind has a
// platform setting that overrides an environment default. Nothing is
// hard-coded to delete: every setting is empty (keep) by default, except
// anonymous conversations (24 hours, DESIGN.md §7.5) and expired anonymous
// sessions.
package retention

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/ncecere/grounded/internal/config"
)

// Kind is a kind of data with its own retention.
type Kind string

// The kinds, in the order a run applies them.
const (
	// Conversations (with their messages) past their level's retention:
	// signed-in (days, none by default) and anonymous (hours, 24 by default).
	Conversations Kind = "conversations"
	// DeletedConversations: conversations their users deleted, after a grace period.
	DeletedConversations Kind = "deleted_conversations"
	AccessLog            Kind = "access_log"
	// AnalyticsEvents are the per-answer metadata events (message_events).
	AnalyticsEvents Kind = "analytics_events"
	// UsageEvents is the usage ledger; events are rolled up per day first.
	UsageEvents Kind = "usage_events"
	AuditLog    Kind = "audit_log"
	// DeletedFiles are the stored files of deleted documents and sources.
	DeletedFiles   Kind = "deleted_files"
	ExpiredInvites Kind = "expired_invites"
	// AnonymousSessions end at expiry (not configurable; they hold no content).
	AnonymousSessions Kind = "anonymous_sessions"
	// EvaluationRuns are evaluation runs with their results (180 days by
	// default; docs/evaluations.md §7). Legal holds don't apply.
	EvaluationRuns Kind = "evaluation_runs"
)

// Kinds lists every kind in run order.
var Kinds = []Kind{Conversations, DeletedConversations, AccessLog, AnalyticsEvents, UsageEvents, AuditLog, DeletedFiles, ExpiredInvites,
	AnonymousSessions, EvaluationRuns}

// Valid reports whether k is a known kind.
func (k Kind) Valid() bool { return slices.Contains(Kinds, k) }

// Period returns the configurable period of k (ok false for conversations,
// set per level, and anonymous sessions, which end at expiry).
func (k Kind) Period() (config.RetentionPeriod, bool) {
	for _, p := range config.RetentionPeriods {
		if p.Kind == string(k) {
			return p, true
		}
	}
	return config.RetentionPeriod{}, false
}

// Where a period comes from.
const (
	SourcePlatform    = "platform"    // set in Administration > Retention
	SourceEnvironment = "environment" // the environment default
	SourceLevel       = "level"       // per classification level
	SourceFixed       = "fixed"       // not configurable
)

// Period is one kind's effective period.
type Period struct {
	Kind Kind
	// Days is the period; nil keeps the data.
	Days *int
	// Source says where Days comes from.
	Source string
	// Platform is the platform setting: Set is false when the environment
	// default applies; Days nil with Set true keeps the data explicitly.
	PlatformSet  bool
	PlatformDays *int
	// EnvDays is the environment default (nil: keep).
	EnvDays  *int
	Min, Max int
}

// Periods are the effective periods of the configurable kinds.
type Periods map[Kind]Period

// Days returns k's period in days (ok false: keep).
func (p Periods) Days(k Kind) (int, bool) {
	if d := p[k].Days; d != nil {
		return *d, true
	}
	return 0, false
}

// Stored is the platform setting as stored: a kind's key with a number of
// days, or null to keep the data; a missing kind uses the environment default.
type Stored map[string]*int

// ParseStored reads retention_settings.periods.
func ParseStored(raw json.RawMessage) (Stored, error) {
	out := Stored{}
	if len(raw) == 0 {
		return out, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("retention settings: %w", err)
	}
	return out, nil
}

// Resolve combines the platform setting and the environment defaults.
func Resolve(stored Stored, env config.Retention) Periods {
	out := Periods{}
	for _, cp := range config.RetentionPeriods {
		k := Kind(cp.Kind)
		p := Period{Kind: k, Min: cp.Min, Max: cp.Max, Source: SourceEnvironment}
		if d, ok := env.Days[cp.Kind]; ok {
			p.EnvDays = intPtr(d)
		}
		p.Days = p.EnvDays
		if d, ok := stored[cp.Kind]; ok {
			p.PlatformSet, p.PlatformDays, p.Days, p.Source = true, d, d, SourcePlatform
		}
		out[k] = p
	}
	return out
}

func intPtr(n int) *int { return &n }
