package teamconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var errDenied = apperr.NotFound("team_not_found", "Team not found")
var errUnsupported = apperr.Conflict("configuration_unsupported", "Configuration contains unsupported settings, references, credentials or exceeds export limits; no partial export is available")

// Kinds, as plan rows name them.
const (
	KindSource        = "source"
	KindKnowledgeBase = "knowledgeBase"
	KindAgent         = "agent"
	KindEvaluationSet = "evaluationSet"
	KindWebhook       = "webhook"
)

// loader reads a team's configuration into a Document. Strict (export): anything a file cannot carry refuses the
// whole export, so a download is never silently partial. Lenient (planning): such an object is left out of the
// current state and recorded, and only a plan row that touches it is blocked.
type loader struct {
	q      *dbgen.Queries
	team   uuid.UUID
	actor  authz.Actor
	strict bool
	// skipped is what a lenient load left out, by kind and identity, with why.
	skipped map[string]map[string]string
	// evalsHidden: the caller (an API key) may not read evaluation questions, so the sets were not loaded.
	evalsHidden bool
}

func (l *loader) refuse(kind, key, reason string) error {
	if l.strict {
		return errUnsupported
	}
	if l.skipped[kind] == nil {
		l.skipped[kind] = map[string]string{}
	}
	l.skipped[kind][foldKey(kind, key)] = reason
	return nil
}

// Export reads a single consistent snapshot. It has no network, jobs, audit or
// mutation dependencies and never selects content or secret storage columns.
func Export(ctx context.Context, pool *pgxpool.Pool, a authz.Actor, ref string) ([]byte, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := dbgen.New(tx)
	t, err := access(ctx, q, a, ref, authz.ScopeConfigurationExport)
	if err != nil {
		return nil, err
	}
	l := &loader{q: q, team: t.ID, actor: a, strict: true}
	d, err := l.load(ctx)
	if err != nil {
		return nil, err
	}
	raw, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return nil, errUnsupported
	}
	// The public decoder is also the final export gate. It enforces all syntax,
	// size, name and schema/reference limits on precisely the bytes downloaded.
	raw = append(raw, '\n')
	if _, err = DecodeDocument(bytes.NewReader(raw)); err != nil {
		return nil, errUnsupported
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return raw, nil
}

// load reads the team's configuration in the export's order and bounds.
func (l *loader) load(ctx context.Context) (Document, error) {
	if err := l.evaluationAccess(ctx); err != nil {
		return Document{}, err
	}
	budget, err := l.q.ExportConfigurationBudget(ctx, uuid.NullUUID{UUID: l.team, Valid: true})
	if err != nil {
		return Document{}, err
	}
	if budget.Resources > MaxResources || budget.RawBytes > MaxBytes || budget.Versions > MaxSequenceItems || budget.Cases > MaxSequenceItems {
		return Document{}, errUnsupported
	}
	d := Document{APIVersion: Version, Sources: []Source{}, KnowledgeBases: []KnowledgeBase{}, Agents: []Agent{}, EvaluationSets: []EvaluationSet{}, Webhooks: []Webhook{}}
	kbNames, err := l.loadSourcesKBs(ctx, &d)
	if err != nil {
		return d, err
	}
	if err = l.loadAgents(ctx, kbNames, &d); err != nil {
		return d, err
	}
	if err = l.loadEvaluations(ctx, &d); err != nil {
		return d, err
	}
	return d, l.loadWebhooks(ctx, &d)
}

// access checks a caller against a team for a configuration operation. Sessions need an actual editor-or-higher
// membership (platform roles and break-glass give none). An API key must belong to the team, have no knowledge-base
// or agent restrictions and hold the operation's scope (applying also needs manage); a personal key also needs its
// owner's current editor-or-higher membership. OAuth clients are refused.
func access(ctx context.Context, q *dbgen.Queries, a authz.Actor, ref, scope string) (dbgen.Team, error) {
	var t dbgen.Team
	var err error
	if id, e := uuid.Parse(ref); e == nil {
		t, err = q.GetTeamByID(ctx, id)
	} else {
		t, err = q.GetTeamBySlug(ctx, ref)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return t, errDenied
	}
	if err != nil {
		return t, err
	}
	m, err := q.GetMembership(ctx, dbgen.GetMembershipParams{TeamID: t.ID, UserID: a.UserID})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return t, err
	}
	if a.OAuth != nil {
		return t, errDenied
	}
	if a.Key == nil {
		if !authz.RoleAtLeast(m.Role, authz.RoleEditor) {
			return t, errDenied
		}
		return t, nil
	}
	k := a.Key
	if k.TeamID != t.ID || !k.HasScope(scope) || k.KBsLimited() || len(k.AgentIDs) > 0 {
		return t, errDenied
	}
	if scope == authz.ScopeConfigurationApply && !k.HasScope(authz.ScopeManage) {
		return t, errDenied
	}
	if k.Personal() && !authz.RoleAtLeast(m.Role, authz.RoleEditor) {
		return t, errDenied
	}
	return t, nil
}

func number(f *float64) *json.Number {
	if f == nil {
		return nil
	}
	raw, _ := json.Marshal(*f)
	n := json.Number(raw)
	return &n
}

// evaluationAccess applies the evaluation policy before any payload read: API keys never see evaluation
// questions (an export with sets refuses; a plan leaves the sets out), and the platform's evaluation switch applies.
func (l *loader) evaluationAccess(ctx context.Context) error {
	exists, err := l.q.ExportConfigurationEvalPresence(ctx, l.team)
	if err != nil || !exists {
		return err
	}
	settings, err := l.q.GetEvaluationSettings(ctx)
	if err != nil {
		return err
	}
	if l.actor.Key != nil || !settings.Enabled {
		if l.strict {
			return errUnsupported
		}
		l.evalsHidden = true
	}
	return nil
}

func (l *loader) loadWebhooks(ctx context.Context, d *Document) error {
	rows, err := l.q.ExportConfigurationWebhooks(ctx, uuid.NullUUID{UUID: l.team, Valid: true})
	if err != nil {
		return err
	}
	if len(rows) > 50 {
		return errUnsupported
	}
	seen := map[string]bool{}
	for _, r := range rows {
		// Two webhooks on one URL cannot be told apart by a file: refuse them rather than export one.
		if seen[r.URL] || !safeURL(r.URL) {
			if err := l.refuse(KindWebhook, r.URL, "two webhooks share this URL, or it has a query or credentials a file cannot carry"); err != nil {
				return err
			}
			continue
		}
		seen[r.URL] = true
		events := r.Events
		if events == nil {
			events = []string{}
		}
		d.Webhooks = append(d.Webhooks, Webhook{URL: r.URL, Description: r.Description, Events: events, Enabled: r.Enabled})
	}
	return nil
}
