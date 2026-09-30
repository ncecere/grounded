package systemone

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Service stores the platform SystemOne settings and builds clients.
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

// NewTargetClient builds a client for a catalog target.
func NewTargetClient(t catalog.ModerationTarget) *Client {
	return NewClient(t.Client, t.Model.UpstreamModel, t.Model.ID, t.Conn.ID, int(t.Conn.MaxConcurrentRequests))
}

// Client returns a client for an enabled SystemOne model.
func (s *Service) Client(ctx context.Context, modelID uuid.UUID) (*Client, error) {
	t, err := s.Catalog.SystemOneTarget(ctx, modelID)
	if err != nil {
		return nil, err
	}
	return NewTargetClient(t), nil
}

// Stored are the settings with the model and revision. Settings never
// saved are the defaults with no model, revision 1.
type Stored struct {
	ModelID   *uuid.UUID
	Settings  Settings
	Revision  int64
	UpdatedAt *time.Time
	UpdatedBy uuid.NullUUID
}

func load(ctx context.Context, q *dbgen.Queries, lock bool) (Stored, error) {
	var (
		row dbgen.SystemoneSetting
		err error
	)
	if lock {
		row, err = q.LockSystemOneSettings(ctx)
	} else {
		row, err = q.GetSystemOneSettings(ctx)
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Stored{Settings: DefaultSettings(), Revision: 1}, nil
	} else if err != nil {
		return Stored{}, err
	}
	out := Stored{Settings: DecodeSettings(row.Settings), Revision: row.Revision, UpdatedAt: &row.UpdatedAt, UpdatedBy: row.UpdatedBy}
	if row.ModelID.Valid {
		id := row.ModelID.UUID
		out.ModelID = &id
	}
	return out, nil
}

// Load returns the stored settings without permission checks (the chat
// pipeline and /retrieve).
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

// Input is the settings to save. KeepCitations and KeepScope keep the
// saved sections (clients from before those features send judging only);
// KeepTimeLimit keeps the saved judging time limit (clients from before
// it).
type Input struct {
	ModelID                                 *uuid.UUID
	Settings                                Settings
	KeepCitations, KeepScope, KeepTimeLimit bool
}

// check validates the settings to save.
func (in Input) check() error {
	probs := in.Settings.Validate()
	if in.Settings.AnyEnabled() && in.ModelID == nil {
		probs = append(probs, Problem{"modelId", "Choose a SystemOne model to turn a SystemOne feature on"})
	}
	if len(probs) > 0 {
		return invalidSettings(probs)
	}
	return nil
}

func invalidSettings(p []Problem) error {
	list := make([]map[string]string, len(p))
	for i, pr := range p {
		list[i] = map[string]string{"field": pr.Field, "problem": pr.Problem}
	}
	return &apperr.Error{Status: 400, Code: "invalid_settings", Message: "The SystemOne settings are invalid: " + p[0].String(),
		Details: map[string]any{"problems": list}}
}

func snapshot(st Stored) map[string]any {
	return map[string]any{"modelId": st.ModelID, "settings": st.Settings}
}

// Put replaces the settings (platform admins), audited in the same
// transaction. expectedRevision is the If-Match revision (1 for defaults
// never saved).
func (s *Service) Put(ctx context.Context, a authz.Actor, in Input, expectedRevision int64) (Stored, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Stored{}, errAdminOnly
	}
	if !in.KeepCitations && !in.KeepScope && !in.KeepTimeLimit {
		if err := in.check(); err != nil {
			return Stored{}, err // before taking the lock
		}
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
		if in.KeepCitations {
			in.Settings.Citations = cur.Settings.Citations
		}
		if in.KeepScope {
			in.Settings.Scope = cur.Settings.Scope
		}
		if in.KeepTimeLimit {
			in.Settings.Judging.TimeLimitMs = cur.Settings.Judging.TimeLimitMs
		}
		if err := in.check(); err != nil {
			return err
		}
		row, err := save(ctx, q, cur, in, a)
		if err != nil {
			return err
		}
		out = Stored{ModelID: in.ModelID, Settings: in.Settings, Revision: row.Revision, UpdatedAt: &row.UpdatedAt, UpdatedBy: row.UpdatedBy}
		e := a.Audit("platform.systemone_settings_update", "systemone_settings", "platform")
		e.Before, e.After = snapshot(cur), snapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// save checks the model and writes the row.
func save(ctx context.Context, q *dbgen.Queries, cur Stored, in Input, a authz.Actor) (dbgen.SystemoneSetting, error) {
	model := uuid.NullUUID{}
	if in.ModelID != nil {
		m, err := q.GetModel(ctx, *in.ModelID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && m.Kind != catalog.KindSystemOne) {
			return dbgen.SystemoneSetting{}, apperr.Invalid("invalid_model", "Choose a SystemOne model")
		} else if err != nil {
			return dbgen.SystemoneSetting{}, err
		}
		model = uuid.NullUUID{UUID: *in.ModelID, Valid: true}
	}
	raw, _ := json.Marshal(in.Settings)
	by := uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
	if cur.UpdatedAt == nil {
		row, err := q.InsertSystemOneSettings(ctx, dbgen.InsertSystemOneSettingsParams{ModelID: model, Settings: raw, UpdatedBy: by})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return row, apperr.Stale() // saved concurrently
		}
		return row, err
	}
	return q.UpdateSystemOneSettings(ctx, dbgen.UpdateSystemOneSettingsParams{ModelID: model, Settings: raw, UpdatedBy: by})
}

// Status is what editors need to know: whether a SystemOne model is set
// and usable, and the platform's feature defaults.
type Status struct {
	Available         bool
	JudgingEnabled    bool
	JudgingCandidates int
	Citations         Citations
	Scope             Scope
}

// Status reports the SystemOne status (any signed-in user).
func (s *Service) Status(ctx context.Context) (Status, error) {
	st, err := s.Load(ctx)
	if err != nil {
		return Status{}, err
	}
	out := Status{JudgingEnabled: st.Settings.Judging.Enabled, JudgingCandidates: st.Settings.Judging.Candidates,
		Citations: st.Settings.Citations, Scope: st.Settings.Scope}
	if st.ModelID == nil {
		return out, nil
	}
	if _, err := s.Catalog.SystemOneTarget(ctx, *st.ModelID); err == nil {
		out.Available = true
	} else if !errors.Is(err, catalog.ErrSystemOneUnusable) {
		return out, err
	}
	return out, nil
}

// JudgePlan is passage judging for one chat or retrieval. TimeLimit bounds
// one search's judging in a chat (the KB playground waits for every
// judgment).
type JudgePlan struct {
	Client     *Client
	Candidates int
	Options    JudgeOptions
	TimeLimit  time.Duration
}

// JudgePlan returns the judging to run under an agent's override; nil when
// judging is off or no usable SystemOne model is configured (then nothing
// changes, ADR-0020). force runs judging even when the platform default
// is off (the KB playground's judge switch).
func (s *Service) JudgePlan(ctx context.Context, o Override, force bool) (*JudgePlan, error) {
	st, err := s.Load(ctx)
	if err != nil || st.ModelID == nil {
		return nil, err
	}
	j := st.Settings.Judging.Effective(o)
	if !j.Enabled && !force {
		return nil, nil
	}
	cl, err := s.usableClient(ctx, *st.ModelID)
	if cl == nil {
		return nil, err
	}
	return judgePlan(cl, j), nil
}

func judgePlan(cl *Client, j Judging) *JudgePlan {
	return &JudgePlan{Client: cl, Candidates: j.Candidates, TimeLimit: j.TimeLimit(),
		Options: JudgeOptions{Mode: j.Mode, Timeout: j.Timeout(), Thresholds: j.Thresholds}}
}

// usableClient returns the model's client, or nil (and no error) when the
// model is unusable: the features are then skipped, as without a model.
func (s *Service) usableClient(ctx context.Context, modelID uuid.UUID) (*Client, error) {
	cl, err := s.Client(ctx, modelID)
	if errors.Is(err, catalog.ErrSystemOneUnusable) {
		s.Log.Warn("SystemOne features are on but the SystemOne model is unusable; skipping them")
		return nil, nil
	}
	return cl, err
}

// CitationPlan is citation checking for one answer.
type CitationPlan struct {
	Client   *Client
	Settings Citations
}

// ScopePlan is the scope check of one message.
type ScopePlan struct {
	Client   *Client
	Settings Scope
}

// Plans are the SystemOne features of one chat; nil members are off.
type Plans struct {
	Judge     *JudgePlan
	Citations *CitationPlan
	Scope     *ScopePlan
}

// Plans resolves every feature under an agent's override with one
// settings read (the chat pipeline). With no usable SystemOne model every
// member is nil and nothing changes (ADR-0020).
func (s *Service) Plans(ctx context.Context, o Override) (Plans, error) {
	st, err := s.Load(ctx)
	if err != nil || st.ModelID == nil {
		return Plans{}, err
	}
	j, c, sc := st.Settings.Judging.Effective(o), st.Settings.Citations.Effective(o), st.Settings.Scope.Effective(o)
	if !j.Enabled && !c.Enabled && !sc.Enabled {
		return Plans{}, nil
	}
	cl, err := s.usableClient(ctx, *st.ModelID)
	if cl == nil {
		return Plans{}, err
	}
	var out Plans
	if j.Enabled {
		out.Judge = judgePlan(cl, j)
	}
	if c.Enabled {
		out.Citations = &CitationPlan{Client: cl, Settings: c}
	}
	if sc.Enabled {
		out.Scope = &ScopePlan{Client: cl, Settings: sc}
	}
	return out, nil
}

// ---- Test model ----------------------------------------------------------------------

// Test questions of "Test model" (docs/systemone.md §1): one noul and one
// score question with fixed states.
const (
	TestNoulState     = "The library is open from 8 am to 10 pm on weekdays."
	TestNoulQuestion  = "Does this text say when the library opens?"
	TestScoreState    = "My exam starts in ten minutes and I still can't sign in to the exam system!"
	TestScoreQuestion = "How urgent is this message?"
)

// TestScoreLevels are the levels of the test score question.
var TestScoreLevels = []string{"Not urgent", "Somewhat urgent", "Very urgent"}

// ModelTest is the result of "Test model".
type ModelTest struct {
	OK      bool
	Latency time.Duration
	Noul    float64 // probability of yes (expected high)
	Score   float64 // 0-2 (expected near 2)
	Error   *catalog.ProbeError
}

// TestModel asks the fixed questions (platform admins). Failures are
// reported in Error.
func (s *Service) TestModel(ctx context.Context, a authz.Actor, modelID uuid.UUID) (ModelTest, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return ModelTest{}, errAdminOnly
	}
	t, err := s.Catalog.SystemOneTarget(ctx, modelID)
	if err != nil {
		return ModelTest{}, err
	}
	cl := NewTargetClient(t)
	start := time.Now()
	var out ModelTest
	call := Call{Feature: FeatureTest}
	res, err := cl.Ask(ctx, call, TestNoulState, map[string]Question{"q": Noul(TestNoulQuestion, "", "")})
	if err == nil {
		out.Noul = res.Noul("q")
		res, err = cl.Ask(ctx, call, TestScoreState, map[string]Question{"q": Score(TestScoreQuestion, TestScoreLevels...)})
	}
	out.Latency = time.Since(start)
	if err != nil {
		out.Error = &catalog.ProbeError{Kind: gateway.KindUnavailable, Message: err.Error()}
		var ge *gateway.Error
		if errors.As(err, &ge) {
			out.Error = &catalog.ProbeError{Kind: ge.Kind, Status: ge.Status, Message: ge.Message}
		}
		return out, nil
	}
	out.Score, out.OK = res.Score("q"), true
	return out, nil
}
