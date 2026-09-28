// Administration: platform defaults and ceilings, team overrides and a
// team's usage against its limits.

package limits

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Platform returns the platform defaults and ceilings (platform admins and
// auditors).
func (s *Service) Platform(ctx context.Context, a authz.Actor) (Platform, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return Platform{}, apperr.Forbidden("Platform administration requires the platform admin or auditor role")
	}
	return s.platform(ctx, s.q, false)
}

func settingsSnapshot(p Platform, keys []Key) map[string]any {
	out := map[string]any{}
	for _, k := range keys {
		out[string(k)] = p.Settings[k]
	}
	return out
}

// UpdatePlatform sets defaults and ceilings of the given keys (others are
// unchanged). Platform admins only; expectedRevision guards concurrent edits.
func (s *Service) UpdatePlatform(ctx context.Context, a authz.Actor, changes []SettingChange, expectedRevision int64) (Platform, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Platform{}, errAdminOnly
	}
	seen := map[Key]bool{}
	for _, c := range changes {
		d, ok := Lookup(c.Key)
		if !ok {
			return Platform{}, apperr.Invalid("unknown_limit", "Unknown limit: "+string(c.Key))
		}
		if seen[c.Key] {
			return Platform{}, apperr.Invalid("duplicate_limit", "Each limit may appear once: "+string(c.Key))
		}
		seen[c.Key] = true
		if err := ValidateSetting(d, c.Setting); err != nil {
			return Platform{}, err
		}
	}
	var out Platform
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.platform(ctx, q, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		row, err := q.GetPlatformLimits(ctx)
		if err != nil {
			return err
		}
		stored := map[string]Setting{}
		if err := json.Unmarshal(row.Settings, &stored); err != nil {
			return err
		}
		var changed []Key
		for _, c := range changes {
			old := cur.Settings[c.Key]
			if cur.Custom[c.Key] && eq(old.Default, c.Default) && eq(old.Ceiling, c.Ceiling) {
				continue
			}
			stored[string(c.Key)] = c.Setting
			changed = append(changed, c.Key)
		}
		if len(changed) == 0 {
			out = cur
			return nil
		}
		raw, err := json.Marshal(stored)
		if err != nil {
			return err
		}
		if _, err := q.UpdatePlatformLimits(ctx, dbgen.UpdatePlatformLimitsParams{
			Settings: raw, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		}); err != nil {
			return err
		}
		if out, err = s.platform(ctx, q, false); err != nil {
			return err
		}
		e := a.Audit("limits.platform_update", "platform_limits", "platform")
		e.Before, e.After = settingsSnapshot(cur, changed), settingsSnapshot(out, changed)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

func eq(a, b *int64) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

// TeamConfig is a team's overrides with the platform settings they apply to.
type TeamConfig struct {
	Team      dbgen.Team
	Platform  Platform
	Overrides Overrides
	Revision  int64 // of the team's overrides (1 = never changed)
}

func (s *Service) teamConfig(ctx context.Context, q *dbgen.Queries, t dbgen.Team, lock bool) (TeamConfig, error) {
	p, err := s.platform(ctx, q, false)
	if err != nil {
		return TeamConfig{}, err
	}
	var row dbgen.TeamLimit
	if lock {
		row, err = q.LockTeamLimits(ctx, t.ID)
	} else {
		row, err = q.GetTeamLimits(ctx, t.ID)
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return TeamConfig{Team: t, Platform: p, Overrides: Overrides{}, Revision: 1}, nil
	} else if err != nil {
		return TeamConfig{}, err
	}
	o, err := parseOverrides(row.Overrides)
	if err != nil {
		return TeamConfig{}, err
	}
	return TeamConfig{Team: t, Platform: p, Overrides: o, Revision: row.Revision}, nil
}

// TeamOverrides returns a team's overrides (platform admins and auditors).
func (s *Service) TeamOverrides(ctx context.Context, a authz.Actor, teamRef string) (TeamConfig, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return TeamConfig{}, apperr.Forbidden("Platform administration requires the platform admin or auditor role")
	}
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return TeamConfig{}, err
	}
	return s.teamConfig(ctx, s.q, acc.Team, false)
}

// UpdateTeamOverrides sets or removes a team's overrides for the given keys
// (others are unchanged). Values above a key's ceiling are rejected. Platform
// admins only; expectedRevision guards concurrent edits.
func (s *Service) UpdateTeamOverrides(ctx context.Context, a authz.Actor, teamRef string, changes []OverrideChange, expectedRevision int64) (TeamConfig, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return TeamConfig{}, errAdminOnly
	}
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return TeamConfig{}, err
	}
	if err := checkOverrideKeys(changes); err != nil {
		return TeamConfig{}, err
	}
	var out TeamConfig
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.teamConfig(ctx, q, acc.Team, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		next, before, after, err := applyOverrides(cur, changes)
		if err != nil {
			return err
		}
		if len(after) == 0 {
			out = cur
			return nil
		}
		if err := storeOverrides(ctx, q, acc.Team.ID, cur.Revision, next, uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}); err != nil {
			return err
		}
		if out, err = s.teamConfig(ctx, q, acc.Team, false); err != nil {
			return err
		}
		e := a.Audit("limits.team_update", "team", acc.Team.ID.String())
		e.TeamID, e.Before, e.After = acc.Team.ID, before, after
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// checkOverrideKeys rejects unknown and repeated keys.
func checkOverrideKeys(changes []OverrideChange) error {
	seen := map[Key]bool{}
	for _, c := range changes {
		if _, ok := Lookup(c.Key); !ok {
			return apperr.Invalid("unknown_limit", "Unknown limit: "+string(c.Key))
		}
		if seen[c.Key] {
			return apperr.Invalid("duplicate_limit", "Each limit may appear once: "+string(c.Key))
		}
		seen[c.Key] = true
	}
	return nil
}

// applyOverrides applies changes to the team's overrides. before and after
// hold the changed keys only (nil: no override).
func applyOverrides(cur TeamConfig, changes []OverrideChange) (next Overrides, before, after map[string]any, err error) {
	next = Overrides{}
	for k, v := range cur.Overrides {
		next[k] = v
	}
	before, after = map[string]any{}, map[string]any{}
	for _, c := range changes {
		d, _ := Lookup(c.Key)
		old, had := cur.Overrides[c.Key]
		if c.Value == nil {
			if !had {
				continue
			}
			delete(next, c.Key)
			before[string(c.Key)], after[string(c.Key)] = old, nil
			continue
		}
		if had && old == *c.Value {
			continue
		}
		// Only new values are checked against the ceiling, so an override
		// left above a later-lowered ceiling can be kept (it is capped)
		// while other keys change.
		if err := ValidateOverride(d, cur.Platform.Settings[c.Key], c.Value); err != nil {
			return nil, nil, nil, err
		}
		next[c.Key] = *c.Value
		if had {
			before[string(c.Key)] = old
		} else {
			before[string(c.Key)] = nil
		}
		after[string(c.Key)] = *c.Value
	}
	return next, before, after, nil
}

// storeOverrides writes a team's overrides: the first write inserts the row
// (revision 1 means none exists yet).
func storeOverrides(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, revision int64, next Overrides, by uuid.NullUUID) error {
	raw, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if revision == 1 {
		n, err := q.InsertTeamLimits(ctx, dbgen.InsertTeamLimitsParams{TeamID: teamID, Overrides: raw, UpdatedBy: by})
		if err != nil {
			return err
		}
		if n == 0 {
			return apperr.Stale()
		}
		return nil
	}
	_, err = q.UpdateTeamLimits(ctx, dbgen.UpdateTeamLimitsParams{Overrides: raw, UpdatedBy: by, TeamID: teamID})
	return err
}

// UsageItem is one limit with the team's current usage.
type UsageItem struct {
	Def  Def
	Max  *int64 // nil = unlimited
	Used *int64 // nil when not measured (per-person and per-key rates)
	// Overridden is true when the team has its own value for this key.
	Overridden bool
}

// TeamUsage is a team's effective limits and current usage.
type TeamUsage struct {
	Team  dbgen.Team
	Items []UsageItem
}

// TeamUsage returns a team's effective limits and current usage. Members
// see their team's; platform admins and auditors see any team's.
func (s *Service) TeamUsage(ctx context.Context, a authz.Actor, teamRef string) (TeamUsage, error) {
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return TeamUsage{}, err
	}
	if acc.Role == "" && !a.CanReadPlatform() {
		return TeamUsage{}, apperr.NotFound("team_not_found", "Team not found")
	}
	teamID := acc.Team.ID
	team := uuid.NullUUID{UUID: teamID, Valid: true}
	set, err := s.Effective(ctx, s.q, teamID)
	if err != nil {
		return TeamUsage{}, err
	}
	docs, err := s.q.TeamDocumentUsage(ctx, team)
	if err != nil {
		return TeamUsage{}, err
	}
	used := map[Key]int64{StorageBytes: docs.StorageBytes, Documents: docs.Documents}
	counters := []struct {
		key Key
		get func() (int64, error)
	}{
		{DataSources, func() (int64, error) { return s.q.CountTeamSources(ctx, team) }},
		{KnowledgeBases, func() (int64, error) { return s.q.CountTeamKBs(ctx, teamID) }},
		{Agents, func() (int64, error) { return s.q.CountTeamAgents(ctx, teamID) }},
		{ChatTokensPerDay, func() (int64, error) { return s.chatTokensToday(ctx, teamID) }},
		{CrawlPagesPerDay, func() (int64, error) { return s.UsageToday(ctx, s.q, teamID, UsagePageCrawled) }},
		{QueriesPerDay, func() (int64, error) { return s.UsageToday(ctx, s.q, teamID, UsageQuery) }},
		{ConcurrentCrawls, func() (int64, error) { return s.q.CountCrawlSlots(ctx, team) }},
		{ConcurrentIngestJobs, func() (int64, error) { return s.q.CountTeamInflight(ctx, team) }},
	}
	for _, c := range counters {
		n, err := c.get()
		if err != nil {
			return TeamUsage{}, err
		}
		used[c.key] = n
	}
	if s.limiter != nil {
		// Best effort: the team's queries in the current minute.
		if n, err := s.limiter.Peek(ctx, "q:team:"+teamID.String(), time.Minute); err == nil {
			used[QueriesPerMinute] = int64(n)
		}
	}
	out := TeamUsage{Team: acc.Team}
	for _, d := range registry {
		item := UsageItem{Def: d, Max: set.Get(d.Key)}
		_, item.Overridden = set.Overrides[d.Key]
		if n, ok := used[d.Key]; ok {
			item.Used = &n
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}
