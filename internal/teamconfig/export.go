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

// Export reads a single consistent snapshot. It has no network, jobs, audit or
// mutation dependencies and never selects content or secret storage columns.
func Export(ctx context.Context, pool *pgxpool.Pool, a authz.Actor, ref string) ([]byte, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := dbgen.New(tx)
	t, err := exportAccess(ctx, q, a, ref)
	if err != nil {
		return nil, err
	}
	if err = aggregateEligibility(ctx, q, t.ID, a); err != nil {
		return nil, err
	}
	budget, err := q.ExportConfigurationBudget(ctx, uuid.NullUUID{UUID: t.ID, Valid: true})
	if err != nil {
		return nil, err
	}
	if budget.Resources > MaxResources || budget.RawBytes > MaxBytes || budget.Versions > MaxSequenceItems || budget.Cases > MaxSequenceItems {
		return nil, errUnsupported
	}
	d := Document{APIVersion: Version, Sources: []Source{}, KnowledgeBases: []KnowledgeBase{}, Agents: []Agent{}, EvaluationSets: []EvaluationSet{}, Webhooks: []Webhook{}}
	kbNames, err := loadSourcesKBs(ctx, q, t.ID, a.Delegated(), &d)
	if err != nil {
		return nil, err
	}
	if err = loadAgents(ctx, q, t.ID, kbNames, &d); err != nil {
		return nil, err
	}
	if err = loadEvaluations(ctx, q, t.ID, a, &d); err != nil {
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

func exportAccess(ctx context.Context, q *dbgen.Queries, a authz.Actor, ref string) (dbgen.Team, error) {
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
	} else {
		k := a.Key
		if k.TeamID != t.ID || !k.HasScope(authz.ScopeConfigurationExport) || k.KBsLimited() || len(k.AgentIDs) > 0 {
			return t, errDenied
		}
		if k.Personal() && !authz.RoleAtLeast(m.Role, authz.RoleEditor) {
			return t, errDenied
		}
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

func loadSources(ctx context.Context, q *dbgen.Queries, team uuid.UUID, delegated bool, d *Document) error {
	srcs, err := q.ExportConfigurationSources(ctx, uuid.NullUUID{UUID: team, Valid: true})
	if err != nil {
		return err
	}
	if len(srcs) > MaxResources {
		return errUnsupported
	}
	for _, s := range srcs {
		if s.Contextual || s.Rank > s.CeilingRank || (delegated && !s.DirectRetrieve) {
			return errUnsupported
		}
		out := Source{Name: s.Name, Description: s.Description, Type: s.Type, Classification: s.Classification, EmbeddingProfile: s.Profile, Status: s.Status, OCREnabled: s.OcrEnabled}
		if strictJSON(s.Boilerplate, &out.Boilerplate) != nil {
			return errUnsupported
		}
		if s.Type == "web" {
			out.Web = newWebConfig()
			if strictJSON(s.Config, out.Web) != nil {
				return errUnsupported
			}
			if out.Web.URLs == nil {
				out.Web.URLs = []string{}
			}
			if out.Web.IncludePrefixes == nil {
				out.Web.IncludePrefixes = []string{}
			}
			if out.Web.Exclude == nil {
				out.Web.Exclude = []string{}
			}
			if out.Web.Tags == nil {
				out.Web.Tags = []string{}
			}
		} else if string(s.Config) != "{}" {
			return errUnsupported
		}
		d.Sources = append(d.Sources, out)
	}
	return nil
}

func loadSourcesKBs(ctx context.Context, q *dbgen.Queries, team uuid.UUID, delegated bool, d *Document) (map[uuid.UUID]string, error) {
	if err := loadSources(ctx, q, team, delegated, d); err != nil {
		return nil, err
	}

	rows, err := q.ExportConfigurationKBs(ctx, team)
	if err != nil {
		return nil, err
	}
	if len(rows)+len(d.Sources) > MaxResources {
		return nil, errUnsupported
	}
	names := map[uuid.UUID]string{}
	index := map[string]int{}
	for _, k := range rows {
		names[k.ID] = k.Name
		index[k.Name] = len(d.KnowledgeBases)
		d.KnowledgeBases = append(d.KnowledgeBases, KnowledgeBase{Name: k.Name, Description: k.Description, EmbeddingProfile: k.Profile, TopK: k.TopK, VectorWeight: number(k.VectorWeight), KeywordWeight: number(k.KeywordWeight), Sources: []SourceRef{}})
	}
	links, err := q.ExportConfigurationLinks(ctx, team)
	if err != nil {
		return nil, err
	}
	if len(links) > MaxSequenceItems {
		return nil, errUnsupported
	}
	for _, l := range links {
		if l.ForeignTeam || l.Rank > l.CeilingRank || (delegated && !l.DirectRetrieve) {
			return nil, errUnsupported
		}
		ns := "team"
		if l.Shared {
			ns = "platform"
		}
		i := index[l.Kb]
		d.KnowledgeBases[i].Sources = append(d.KnowledgeBases[i].Sources, SourceRef{Namespace: ns, Name: l.Name})
	}
	return names, nil
}

// Refuse protected/unnamed kinds before any payload or byte-budget read.
func aggregateEligibility(ctx context.Context, q *dbgen.Queries, team uuid.UUID, a authz.Actor) error {
	hooks, err := q.ExportConfigurationWebhookCount(ctx, uuid.NullUUID{UUID: team, Valid: true})
	if err != nil {
		return err
	}
	if hooks != 0 {
		return errUnsupported
	}
	exists, err := q.ExportConfigurationEvalPresence(ctx, team)
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	if a.Key != nil {
		return errUnsupported
	}
	settings, err := q.GetEvaluationSettings(ctx)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return errUnsupported
	}
	return nil
}
