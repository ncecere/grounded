package pii

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// PatternInput is a platform admin's pattern as stored and shown: a name and an RE2 expression.
type PatternInput struct {
	Name    string `json:"name"`
	Pattern string `json:"pattern"`
}

// Settings are the platform's scanning settings.
type Settings struct {
	Enabled     bool
	BlockLevels []string
	Patterns    []PatternInput
	Revision    int64
	UpdatedAt   time.Time
}

// Scanner is what ingestion scans with: the settings, with the patterns compiled.
type Scanner struct {
	Enabled     bool
	BlockLevels []string
	Patterns    []Pattern
}

// Service stores the settings (platform admins change them; auditors read).
type Service struct {
	Pool *pgxpool.Pool
}

func toSettings(r dbgen.PiiSetting) Settings {
	s := Settings{Enabled: r.Enabled, BlockLevels: r.BlockLevels, Patterns: []PatternInput{}, Revision: r.Revision, UpdatedAt: r.UpdatedAt}
	if s.BlockLevels == nil {
		s.BlockLevels = []string{}
	}
	_ = json.Unmarshal(r.Patterns, &s.Patterns)
	return s
}

// Get reads the settings (platform admins and auditors).
func (s *Service) Get(ctx context.Context, a authz.Actor) (Settings, error) {
	if !a.CanReadPlatform() || a.Delegated() {
		return Settings{}, apperr.Forbidden("Only platform admins and auditors can see personal data scanning")
	}
	r, err := dbgen.New(s.Pool).GetPIISettings(ctx)
	return toSettings(r), err
}

// Scanner loads the settings for ingestion. A pattern that no longer compiles is left out (it was checked on save).
func Load(ctx context.Context, q *dbgen.Queries) (Scanner, error) {
	r, err := q.GetPIISettings(ctx)
	if err != nil {
		return Scanner{}, err
	}
	set := toSettings(r)
	sc := Scanner{Enabled: set.Enabled, BlockLevels: set.BlockLevels}
	for _, p := range set.Patterns {
		if c, ok := CompilePattern(p.Name, p.Pattern); ok {
			sc.Patterns = append(sc.Patterns, c)
		}
	}
	return sc, nil
}

// Update replaces the settings (platform admins, If-Match, audited). Classification levels must exist; patterns must
// compile (RE2, bounded), have unique names and number at most MaxPatterns.
func (s *Service) Update(ctx context.Context, a authz.Actor, in Settings, revision int64) (Settings, error) {
	if !a.IsPlatformAdmin() || a.Delegated() {
		return Settings{}, apperr.Forbidden("Only platform admins can change personal data scanning")
	}
	if len(in.Patterns) > MaxPatterns {
		return Settings{}, apperr.Invalid("too_many_patterns", "At most 20 patterns")
	}
	seen := map[string]bool{}
	for i, p := range in.Patterns {
		in.Patterns[i].Name = strings.TrimSpace(p.Name)
		if _, ok := CompilePattern(p.Name, p.Pattern); !ok || seen[strings.ToLower(in.Patterns[i].Name)] {
			return Settings{}, &apperr.Error{Status: 400, Code: "invalid_pattern",
				Message: "Each pattern needs a unique name (1-60 characters) and a valid regular expression of at most 500 characters that does not match empty text",
				Details: map[string]any{"index": i}}
		}
		seen[strings.ToLower(in.Patterns[i].Name)] = true
	}
	if in.BlockLevels == nil {
		in.BlockLevels = []string{}
	}
	var out dbgen.PiiSetting
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		levels, err := q.ListClassifications(ctx)
		if err != nil {
			return err
		}
		known := map[string]bool{}
		for _, l := range levels {
			known[l.Key] = true
		}
		for _, l := range in.BlockLevels {
			if !known[l] {
				return apperr.Invalid("invalid_level", "Unknown classification level: "+l)
			}
		}
		cur, err := q.LockPIISettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != revision {
			return apperr.Stale()
		}
		patterns, _ := json.Marshal(in.Patterns)
		if out, err = q.UpdatePIISettings(ctx, dbgen.UpdatePIISettingsParams{Enabled: in.Enabled, BlockLevels: in.BlockLevels,
			Patterns: patterns, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}}); err != nil {
			return err
		}
		e := a.Audit("platform.pii", "pii_settings", "settings")
		e.Before, e.After = snapshot(toSettings(cur)), snapshot(toSettings(out))
		return audit.Record(ctx, q, e)
	})
	return toSettings(out), err
}

// snapshot is what the audit log keeps: the switch, the levels and the patterns' names (an expression may describe an
// institution's ID format, so it stays out of the log).
func snapshot(s Settings) map[string]any {
	names := make([]string, len(s.Patterns))
	for i, p := range s.Patterns {
		names[i] = p.Name
	}
	return map[string]any{"enabled": s.Enabled, "blockLevels": s.BlockLevels, "patterns": names}
}
