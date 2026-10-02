package rerank

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Service stores the platform rerank settings and builds plans.
type Service struct {
	Pool    *pgxpool.Pool
	Catalog *catalog.Service
	Log     *slog.Logger
	q       *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, cat *catalog.Service, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{Pool: pool, Catalog: cat, Log: log, q: dbgen.New(pool)}
}

// Stored are the settings with the model and revision. Settings never
// saved are the defaults with no model, revision 1.
type Stored struct {
	ModelID   *uuid.UUID
	Settings  Settings
	Revision  int64
	UpdatedAt *time.Time
}

func load(ctx context.Context, q *dbgen.Queries, lock bool) (Stored, error) {
	var (
		row dbgen.RerankSetting
		err error
	)
	if lock {
		row, err = q.LockRerankSettings(ctx)
	} else {
		row, err = q.GetRerankSettings(ctx)
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Stored{Settings: DefaultSettings(), Revision: 1}, nil
	} else if err != nil {
		return Stored{}, err
	}
	out := Stored{Settings: DecodeSettings(row.Settings), Revision: row.Revision, UpdatedAt: &row.UpdatedAt}
	if row.ModelID.Valid {
		id := row.ModelID.UUID
		out.ModelID = &id
	}
	return out, nil
}

// Load returns the stored settings without permission checks.
func (s *Service) Load(ctx context.Context) (Stored, error) { return load(ctx, s.q, false) }

var (
	errAdminOnly = apperr.Forbidden("Only platform admins can do this")
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see this")
)

// Get returns the settings (platform admins and auditors).
func (s *Service) Get(ctx context.Context, a authz.Actor) (Stored, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return Stored{}, errReadOnly
	}
	return s.Load(ctx)
}

// AgentCount is how many published agents rerank (their published version
// doesn't turn it off).
func (s *Service) AgentCount(ctx context.Context) (int32, error) { return s.q.CountRerankAgents(ctx) }

// Input is the settings to save; ModelID nil turns reranking off.
type Input struct {
	ModelID  *uuid.UUID
	Settings Settings
}

// invalidSettings lists every problem, in the message and by field.
func invalidSettings(p []Problem) error {
	list := make([]map[string]string, len(p))
	texts := make([]string, len(p))
	for i, pr := range p {
		list[i] = map[string]string{"field": pr.Field, "problem": pr.Problem}
		texts[i] = pr.Problem + "."
	}
	return &apperr.Error{Status: 400, Code: "invalid_settings", Message: "The rerank settings are invalid. " + strings.Join(texts, " "),
		Details: map[string]any{"problems": list}}
}

// snapshot is one side of the audit entry: the model by name (and ID) and
// each setting, so the change reads "Time limit 200 ms → 2,000 ms".
func snapshot(ctx context.Context, q *dbgen.Queries, st Stored) map[string]any {
	out := map[string]any{"modelId": st.ModelID, "candidates": st.Settings.Candidates, "timeLimitMs": st.Settings.TimeLimitMs}
	if st.ModelID != nil {
		if m, err := q.GetModel(ctx, *st.ModelID); err == nil {
			out["model"] = m.DisplayName
		}
	}
	return out
}

// unchanged: the input is what is saved already.
func unchanged(cur Stored, in Input) bool {
	same := (cur.ModelID == nil) == (in.ModelID == nil) && (cur.ModelID == nil || *cur.ModelID == *in.ModelID)
	return same && cur.Settings == in.Settings
}

// Put replaces the settings (platform admins), audited in the same
// transaction. expectedRevision is the If-Match revision (1 for defaults
// never saved). Saving the same settings changes nothing: a new revision
// would retire every saved answer for no reason.
func (s *Service) Put(ctx context.Context, a authz.Actor, in Input, expectedRevision int64) (Stored, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Stored{}, errAdminOnly
	}
	if p := in.Settings.Validate(); len(p) > 0 {
		return Stored{}, invalidSettings(p)
	}
	var out Stored
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := load(ctx, q, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if unchanged(cur, in) {
			out = cur
			return nil
		}
		row, err := save(ctx, q, cur, in, a)
		if err != nil {
			return err
		}
		out = Stored{ModelID: in.ModelID, Settings: in.Settings, Revision: row.Revision, UpdatedAt: &row.UpdatedAt}
		e := a.Audit("platform.rerank_settings_update", "rerank_settings", "platform")
		e.Before, e.After = snapshot(ctx, q, cur), snapshot(ctx, q, out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// save checks the model and writes the row.
func save(ctx context.Context, q *dbgen.Queries, cur Stored, in Input, a authz.Actor) (dbgen.RerankSetting, error) {
	model := uuid.NullUUID{}
	if in.ModelID != nil {
		m, err := q.GetModel(ctx, *in.ModelID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && m.Kind != catalog.KindRerank) {
			return dbgen.RerankSetting{}, apperr.Invalid("invalid_model", "Choose a rerank model")
		} else if err != nil {
			return dbgen.RerankSetting{}, err
		}
		model = uuid.NullUUID{UUID: *in.ModelID, Valid: true}
	}
	raw, _ := json.Marshal(in.Settings)
	by := uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
	if cur.UpdatedAt == nil {
		row, err := q.InsertRerankSettings(ctx, dbgen.InsertRerankSettingsParams{ModelID: model, Settings: raw, UpdatedBy: by})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return row, apperr.Stale() // saved concurrently
		}
		return row, err
	}
	return q.UpdateRerankSettings(ctx, dbgen.UpdateRerankSettingsParams{ModelID: model, Settings: raw, UpdatedBy: by})
}

// Status is what editors need: whether a usable rerank model is set, and
// how many passages an agent keeps by default.
type Status struct {
	Available   bool
	DefaultTopN int
}

// Status reports the rerank status (any signed-in user).
func (s *Service) Status(ctx context.Context) (Status, error) {
	out := Status{DefaultTopN: DefaultTopN}
	st, err := s.Load(ctx)
	if err != nil || st.ModelID == nil {
		return out, err
	}
	if _, err := s.Catalog.RerankTarget(ctx, *st.ModelID); err == nil {
		out.Available = true
	} else if !errors.Is(err, catalog.ErrRerankUnusable) {
		return out, err
	}
	return out, nil
}

// Plan returns the platform's reranking, or nil when no rerank model is
// set or it (or its connection) is disabled: retrieval is then as before.
func (s *Service) Plan(ctx context.Context) (*Plan, error) {
	st, err := s.Load(ctx)
	if err != nil || st.ModelID == nil {
		return nil, err
	}
	t, err := s.Catalog.RerankTarget(ctx, *st.ModelID)
	if errors.Is(err, catalog.ErrRerankUnusable) {
		s.Log.Warn("a rerank model is set but unusable; searches aren't reranked")
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	levels, err := s.q.ListClassifications(ctx)
	if err != nil {
		return nil, err
	}
	ranks := make(map[string]int32, len(levels))
	for _, l := range levels {
		ranks[l.Key] = l.Rank
	}
	return &Plan{Client: t.Client, Model: t.Model, Candidates: st.Settings.Candidates, TimeLimit: st.Settings.TimeLimit(), ranks: ranks}, nil
}
