package moderation

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// DefaultTimeout bounds one moderation call (MODERATION_TIMEOUT).
const DefaultTimeout = 10 * time.Second

// Service stores the policies and runs checks.
type Service struct {
	Pool    *pgxpool.Pool
	Catalog *catalog.Service
	// Timeout is the platform default for one attempt of a check, on top
	// of the connection's timeout (models may set their own; see
	// timeoutFor).
	Timeout time.Duration
	Log     *slog.Logger
	// NewProvider builds a model's adapter (default NewProvider; tests
	// may replace it).
	NewProvider func(catalog.ModerationTarget) (Provider, error)
	q           *dbgen.Queries

	mu      sync.Mutex
	healthy map[uuid.UUID]healthMark // model -> last successful call
}

// New returns a Service. timeout 0 means DefaultTimeout.
func New(pool *pgxpool.Pool, cat *catalog.Service, timeout time.Duration, log *slog.Logger) *Service {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{Pool: pool, Catalog: cat, Timeout: timeout, Log: log, NewProvider: NewProvider,
		q: dbgen.New(pool), healthy: map[uuid.UUID]healthMark{}}
}

// Stored is an audience's policy with its provider and revision. A policy
// never saved has the defaults and revision 1.
type Stored struct {
	Audience  string
	ModelID   *uuid.UUID
	Policy    Policy
	Revision  int64
	UpdatedAt *time.Time
	UpdatedBy uuid.NullUUID
}

func errUnknownAudience() error {
	return apperr.NotFound("audience_not_found", "Audience must be team, all_authenticated or public")
}

// load reads an audience's policy (defaults when none is stored).
func load(ctx context.Context, q *dbgen.Queries, audience string, lock bool) (Stored, error) {
	if !authz.ValidAudience(audience) {
		return Stored{}, errUnknownAudience()
	}
	var (
		row dbgen.ModerationPolicy
		err error
	)
	if lock {
		row, err = q.LockModerationPolicy(ctx, audience)
	} else {
		row, err = q.GetModerationPolicy(ctx, audience)
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Stored{Audience: audience, Policy: DefaultPolicy(audience), Revision: 1}, nil
	} else if err != nil {
		return Stored{}, err
	}
	out := Stored{Audience: audience, Policy: DecodePolicy(audience, row.Policy), Revision: row.Revision,
		UpdatedAt: &row.UpdatedAt, UpdatedBy: row.UpdatedBy}
	if row.ModelID.Valid {
		id := row.ModelID.UUID
		out.ModelID = &id
	}
	return out, nil
}

// ---- checks in the chat pipeline -----------------------------------------------------

// Plan is the effective moderation of one chat: the audience's platform
// policy merged with the agent's override. The provider is resolved on the
// first check.
type Plan struct {
	Policy  Policy
	ModelID *uuid.UUID

	s        *Service
	once     sync.Once
	provider bound
	err      error
	// requests counts answered checks by a moderation model (not SystemOne,
	// which its meter records), for the moderation_requests usage events.
	requests atomic.Int64
}

// UsageKind is the usage ledger kind of answered moderation requests
// (docs/costs.md §2).
const UsageKind = "moderation_requests"

// Requests is how many checks a moderation model answered for this plan,
// and the model (nil plans, and SystemOne providers, report none).
func (p *Plan) Requests() (int64, uuid.UUID) {
	if p == nil || p.ModelID == nil {
		return 0, uuid.Nil
	}
	return p.requests.Load(), *p.ModelID
}

// Plan returns the effective moderation for an audience and an agent's
// override. It is nil when nothing is moderated.
func (s *Service) Plan(ctx context.Context, audience string, o Override) (*Plan, error) {
	st, err := load(ctx, s.q, audience, false)
	if err != nil {
		return nil, err
	}
	pol := st.Policy.Merge(o)
	if !pol.Active(StageInput) && !pol.Active(StageOutput) {
		return nil, nil
	}
	return &Plan{Policy: pol, ModelID: st.ModelID, s: s}, nil
}

// HasProvider reports whether an audience's policy names a provider (an
// agent override needs one to take effect).
func (s *Service) HasProvider(ctx context.Context, audience string) (bool, error) {
	st, err := load(ctx, s.q, audience, false)
	return st.ModelID != nil, err
}

// Active reports whether stage is moderated (nil plans moderate nothing).
func (p *Plan) Active(stage string) bool { return p != nil && p.Policy.Active(stage) }

// Buffered reports whether answers are sent only after the output check.
func (p *Plan) Buffered() bool { return p.OutputMode() == ModeBuffer }

// Checked reports whether answers are released in checked paragraphs
// (ModeStreamChecked).
func (p *Plan) Checked() bool { return p.OutputMode() == ModeStreamChecked }

// OutputMode is the output mode when answers are moderated, else "".
func (p *Plan) OutputMode() string {
	if !p.Active(StageOutput) {
		return ""
	}
	return p.Policy.OutputMode
}

func (p *Plan) resolve(ctx context.Context) (bound, error) {
	p.once.Do(func() {
		if p.ModelID == nil {
			p.err = errors.New("no moderation provider is configured for this audience")
			return
		}
		p.provider, p.err = p.s.provider(ctx, *p.ModelID)
	})
	return p.provider, p.err
}

// Check judges a text. It never fails: a provider error or timeout is a
// Decision with outcome error, blocked when the policy fails closed.
func (p *Plan) Check(ctx context.Context, in Input) Decision {
	d := p.check(ctx, in)
	observability.ModerationDecisions.WithLabelValues(d.Stage, d.Outcome).Inc()
	return d
}

func (p *Plan) check(ctx context.Context, in Input) Decision {
	prov, err := p.resolve(ctx)
	var res Result
	if err == nil {
		res, err = p.s.run(ctx, prov, in)
		if err == nil && !prov.systemOne {
			p.requests.Add(1)
		}
	}
	if err != nil {
		p.s.Log.Warn("moderation check failed", "stage", in.Stage, "err", err, "failClosed", p.Policy.FailClosed)
		return Decision{Stage: in.Stage, Outcome: DecisionError, Blocked: p.Policy.FailClosed, Err: err, Result: res}
	}
	return p.Policy.Evaluate(in.Stage, res)
}

// ---- readiness ----------------------------------------------------------------------------

// Ready reports whether moderation is configured and working for an
// audience; see the package documentation. The error is 409
// moderation_not_ready with a message for the admin.
func (s *Service) Ready(ctx context.Context, audience string) error {
	st, err := load(ctx, s.q, audience, false)
	if err != nil {
		return err
	}
	notReady := func(msg string) error { return apperr.Conflict("moderation_not_ready", msg) }
	switch {
	case st.ModelID == nil:
		return notReady("No moderation provider is set for the " + audience + " audience")
	case !st.Policy.Active(StageInput) || !st.Policy.Active(StageOutput):
		return notReady("The " + audience + " moderation policy must moderate both questions and answers")
	}
	prov, err := s.provider(ctx, *st.ModelID)
	if err != nil {
		return notReady("The moderation provider is disabled or unavailable")
	}
	if s.recentlyHealthy(prov) {
		return nil // a recent probe or chat check answered: only that is cached
	}
	if _, err := s.run(ctx, prov, Input{Stage: StageInput, Text: defs.Samples.Benign}); err != nil {
		return notReady("The moderation provider did not answer a test request: " + err.Error())
	}
	return nil
}
