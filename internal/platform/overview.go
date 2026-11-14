package platform

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/preflight"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var errOverviewReadOnly = apperr.Forbidden("Platform administration requires the platform admin or auditor role")

// Counts are the platform's team, user and content totals (admin Overview,
// "Set up this install").
func (s *Service) Counts(ctx context.Context, a authz.Actor) (dbgen.AdminOverviewCountsRow, error) {
	if !a.CanReadPlatform() {
		return dbgen.AdminOverviewCountsRow{}, errOverviewReadOnly
	}
	return s.q.AdminOverviewCounts(ctx)
}

// Overview is what only the admin Overview shows (docs/ui-review A1).
type Overview struct {
	Counts       dbgen.AdminOverviewCountsRow
	FailedByTeam []dbgen.FailedDocumentsByTeamRow
	// Warnings are the production-readiness warnings (E7), the same ones
	// logged at startup and printed by `grounded doctor`.
	Warnings []preflight.Finding
}

// Overview reads the counts, failed ingestion by team and the readiness
// warnings for cfg (platform admins and auditors).
func (s *Service) Overview(ctx context.Context, a authz.Actor, cfg config.Config) (Overview, error) {
	var out Overview
	var err error
	if out.Counts, err = s.Counts(ctx, a); err != nil {
		return out, err
	}
	if out.FailedByTeam, err = s.q.FailedDocumentsByTeam(ctx); err != nil {
		return out, err
	}
	out.Warnings, err = preflight.Check(ctx, cfg, s.q)
	return out, err
}

// SharedSourceAttachments lists the knowledge bases (and their teams) that
// attach each platform-shared source (docs/ui-review A6).
func (s *Service) SharedSourceAttachments(ctx context.Context, a authz.Actor) ([]dbgen.SharedSourceAttachmentsRow, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	return s.q.SharedSourceAttachments(ctx)
}

// TeamCounts is the number of teams each user belongs to (users without a
// team are left out).
func (s *Service) TeamCounts(ctx context.Context, a authz.Actor, users []uuid.UUID) (map[uuid.UUID]int64, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	rows, err := s.q.UserTeamCounts(ctx, users)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]int64, len(rows))
	for _, c := range rows {
		out[c.UserID] = c.Teams
	}
	return out, nil
}

// Accessibility is the accessibility statement's links (public).
func (s *Service) Accessibility(ctx context.Context) (dbgen.AccessibilitySetting, error) {
	return s.q.GetAccessibilitySettings(ctx)
}

// AccessibilityView is the audited snapshot of the statement's links.
type AccessibilityView struct {
	ContactURL     string `json:"contactUrl"`
	InstitutionURL string `json:"institutionUrl"`
	Revision       int64  `json:"revision"`
}

func accessibilityView(row dbgen.AccessibilitySetting) AccessibilityView {
	return AccessibilityView{ContactURL: row.ContactUrl, InstitutionURL: row.InstitutionUrl, Revision: row.Revision}
}

// UpdateAccessibility replaces the statement's links (platform admins; the
// caller validates them), audited as platform.accessibility.
func (s *Service) UpdateAccessibility(ctx context.Context, a authz.Actor, contactURL, institutionURL string, expectedRevision int64) (dbgen.AccessibilitySetting, error) {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return dbgen.AccessibilitySetting{}, apperr.Forbidden("Only platform admins can edit the accessibility statement")
	}
	var out dbgen.AccessibilitySetting
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockAccessibilitySettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		out, err = q.UpdateAccessibilitySettings(ctx, dbgen.UpdateAccessibilitySettingsParams{ContactUrl: contactURL, InstitutionUrl: institutionURL, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}})
		if err != nil {
			return err
		}
		event := a.Audit("platform.accessibility", "accessibility_settings", "settings")
		event.Before, event.After = accessibilityView(cur), accessibilityView(out)
		return audit.Record(ctx, q, event)
	})
	return out, err
}
