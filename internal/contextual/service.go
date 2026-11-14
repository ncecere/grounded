package contextual

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Service reads and changes a source's contextual-chunks settings and says what turning them on would cost. It makes no model call and
// changes no vector: activation is an index preview (docs/contextual-chunks.md section 4).
type Service struct {
	Pool    *pgxpool.Pool
	Teams   *teams.Service
	Counter chunk.TokenCounter
	// Price finds a model's chat prices (nil: prices are unknown everywhere).
	Price Pricer
	// Enabled is the platform switch (CONTEXTUAL_CHUNKS); nil: on.
	Enabled func() bool
	// LimitRaised runs after a cap changed, so documents waiting for it look again (the ingestion wake); may be nil.
	LimitRaised func(ctx context.Context, team uuid.NullUUID)
	Log         *slog.Logger
	q           *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, counter chunk.TokenCounter, log *slog.Logger) *Service {
	return &Service{Pool: pool, Teams: t, Counter: counter, Log: log, q: dbgen.New(pool)}
}

func (s *Service) platformOn() bool { return s.Enabled == nil || s.Enabled() }

var (
	errAdminOnly   = apperr.Forbidden("Only platform admins can change contextual chunks")
	errReadOnly    = apperr.Forbidden("Contextual chunks settings are for platform admins and auditors")
	errNoSource    = apperr.NotFound("source_not_found", "Source not found")
	errSwitchedOff = apperr.Conflict("contextual_unavailable", "Contextual chunks are switched off for this installation (CONTEXTUAL_CHUNKS)")
)

// Settings are a source's contextual-chunks settings; a source without a row has the zero value with the default caps.
type Settings struct {
	SourceID       uuid.UUID
	Enabled        bool
	ModelID        uuid.NullUUID
	FailurePolicy  string
	MaxCalls       int
	MaxCallsPerDay int
	Admission      *Admission
	Revision       int64
	UpdatedAt      time.Time
}

func settingsOf(sourceID uuid.UUID, r *dbgen.SourceContextual) Settings {
	if r == nil {
		return Settings{SourceID: sourceID, FailurePolicy: PolicyFail, MaxCalls: DefaultMaxCalls, MaxCallsPerDay: DefaultMaxCalls, Revision: 1}
	}
	return Settings{SourceID: r.SourceID, Enabled: r.Enabled, ModelID: r.ModelID, FailurePolicy: r.FailurePolicy, MaxCalls: int(r.MaxCalls),
		MaxCallsPerDay: int(r.MaxCallsPerDay), Admission: admissionOf(*r), Revision: r.Revision, UpdatedAt: r.UpdatedAt}
}

// CallStats are a source's model attempts.
type CallStats struct {
	Attempts, OK, Unusable int64
	// Unknown: attempts whose usage the provider did not report (errors, timeouts, cancellations, a crash).
	Unknown             int64
	TokensIn, TokensOut int64
}

// SetState is how one profile's index of the source was built.
type SetState struct {
	ProfileID  uuid.UUID
	ProfileKey string
	Live       bool // the source's own profile
	// Documents embedded with context, and without it by reason (fallback, too_large, off, no_room).
	Context, Fallback, TooLarge, Off, NoRoom int64
	Passages, ContextualPassages             int64
	Calls                                    CallStats
}

// State is Settings with what they have done.
type State struct {
	Settings
	SourceName     string
	ModelName      string
	Classification string
	PlatformOn     bool
	CachedContexts int64
	Calls          CallStats
	Sets           []SetState
	Team           uuid.NullUUID
}

// Get returns a source's settings and state (platform admins and auditors, in a session; any source).
func (s *Service) Get(ctx context.Context, a authz.Actor, sourceID uuid.UUID) (State, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return State{}, errReadOnly
	}
	return s.state(ctx, sourceID)
}

// GetForTeam is the read-only state a member of the source's team sees.
func (s *Service) GetForTeam(ctx context.Context, a authz.Actor, teamRef string, sourceID uuid.UUID) (State, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return State{}, err
	}
	src, err := s.q.GetSource(ctx, sourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (acc.Role == "" || !src.TeamID.Valid || src.TeamID.UUID != acc.Team.ID)) {
		return State{}, errNoSource
	} else if err != nil {
		return State{}, err
	}
	return s.state(ctx, sourceID)
}

func (s *Service) state(ctx context.Context, sourceID uuid.UUID) (State, error) {
	src, err := s.q.GetSource(ctx, sourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return State{}, errNoSource
	} else if err != nil {
		return State{}, err
	}
	var row *dbgen.SourceContextual
	if r, err := s.q.GetSourceContextual(ctx, sourceID); err == nil {
		row = &r
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return State{}, err
	}
	st := State{Settings: settingsOf(sourceID, row), SourceName: src.Name, Classification: src.Classification, PlatformOn: s.platformOn(), Team: src.TeamID}
	if st.ModelID.Valid {
		if m, err := s.q.GetModel(ctx, st.ModelID.UUID); err == nil {
			st.ModelName = m.DisplayName
		}
	}
	if st.CachedContexts, err = s.q.CountSourceContextualCache(ctx, sourceID); err != nil {
		return st, err
	}
	if st.Calls, err = s.callStats(ctx, sourceID, uuid.Nil); err != nil {
		return st, err
	}
	snaps, err := s.q.ListSetContextualFor(ctx, sourceID)
	if err != nil {
		return st, err
	}
	for _, sn := range snaps {
		set, err := s.SetStateFor(ctx, sourceID, sn.ProfileID, sn.ProfileID == src.EmbeddingProfileID)
		if err != nil {
			return st, err
		}
		set.ProfileKey = sn.ProfileKey
		st.Sets = append(st.Sets, set)
	}
	return st, nil
}

// SetStateFor is how a source's index for one profile was built: the attempts and how its documents were embedded.
func (s *Service) SetStateFor(ctx context.Context, sourceID, profileID uuid.UUID, live bool) (SetState, error) {
	set := SetState{ProfileID: profileID, Live: live}
	var err error
	if set.Calls, err = s.callStats(ctx, sourceID, profileID); err != nil {
		return set, err
	}
	marks, err := s.q.ContextualMarkCounts(ctx, dbgen.ContextualMarkCountsParams{SourceID: sourceID, ProfileID: profileID})
	if err != nil {
		return set, err
	}
	for _, m := range marks {
		set.Passages += m.Passages
		set.ContextualPassages += m.Contextual
		switch m.State {
		case StateContext:
			set.Context = m.Documents
		case StateFallback:
			set.Fallback = m.Documents
		case StateTooLarge:
			set.TooLarge = m.Documents
		case StateOff:
			set.Off = m.Documents
		case StateNoRoom:
			set.NoRoom = m.Documents
		}
	}
	return set, nil
}

func (s *Service) callStats(ctx context.Context, sourceID, profileID uuid.UUID) (CallStats, error) {
	r, err := s.q.ContextualCallStats(ctx, dbgen.ContextualCallStatsParams{SourceID: sourceID, ProfileID: uuid.NullUUID{UUID: profileID, Valid: profileID != uuid.Nil}})
	return CallStats{Attempts: r.Attempts, OK: r.Ok, Unusable: r.Unusable, Unknown: r.Unknown, TokensIn: r.TokensIn, TokensOut: r.TokensOut}, err
}

// PutInput replaces a source's settings.
type PutInput struct {
	Enabled        bool
	ModelID        *uuid.UUID
	FailurePolicy  string
	MaxCalls       int
	MaxCallsPerDay int
	Admission      *Admission
}

// Put replaces a source's settings (platform admins, in a session; audited). It changes no vector and starts nothing. Turning a source off
// deletes the text generated for it; calls in progress stop at their next checkpoint.
func (s *Service) Put(ctx context.Context, a authz.Actor, sourceID uuid.UUID, in PutInput, expectedRevision int64) (State, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return State{}, errAdminOnly
	}
	if err := validateCaps(in); err != nil {
		return State{}, err
	}
	raised := false
	var team uuid.NullUUID
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		src, err := q.GetSource(ctx, sourceID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoSource
		} else if err != nil {
			return err
		}
		team = src.TeamID
		if err := s.validateOptIn(ctx, q, in, src.Classification); err != nil {
			return err
		}
		if err := q.EnsureSourceContextual(ctx, sourceID); err != nil {
			return err
		}
		cur, err := q.LockSourceContextual(ctx, sourceID)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		raised = int32(in.MaxCalls) > cur.MaxCalls || int32(in.MaxCallsPerDay) > cur.MaxCallsPerDay || admissionRaised(admissionOf(cur), in.Admission)
		update := dbgen.UpdateSourceContextualParams{SourceID: sourceID, Enabled: in.Enabled,
			ModelID: nullModel(in), FailurePolicy: in.FailurePolicy, MaxCalls: int32(in.MaxCalls), MaxCallsPerDay: int32(in.MaxCallsPerDay),
			UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}}
		applyAdmission(&update, in.Admission)
		if _, err := q.UpdateSourceContextual(ctx, update); err != nil {
			return err
		}
		if cur.Enabled && !in.Enabled {
			// The off transition removes references and generated text together.
			if err := q.DeleteSourceContextualCachePlans(ctx, sourceID); err != nil {
				return err
			}
			if _, err := q.DeleteSourceContextualCache(ctx, sourceID); err != nil {
				return err
			}
		}
		e := a.Audit("source.contextual_update", "data_source", sourceID.String())
		e.TeamID = src.TeamID.UUID
		e.Before, e.After = auditSettings(settingsOf(sourceID, &cur)), auditSettings(Settings{Enabled: in.Enabled, ModelID: nullModel(in),
			FailurePolicy: in.FailurePolicy, MaxCalls: in.MaxCalls, MaxCallsPerDay: in.MaxCallsPerDay, Admission: in.Admission})
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return State{}, err
	}
	if raised && s.LimitRaised != nil {
		wake, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer stop()
		s.LimitRaised(wake, team)
	}
	return s.state(ctx, sourceID)
}

func (s *Service) validateOptIn(ctx context.Context, q *dbgen.Queries, in PutInput, classification string) error {
	if !in.Enabled {
		return nil
	}
	if !s.platformOn() {
		return errSwitchedOff
	}
	if problem := modelProblem(ctx, q, in.ModelID, classification); problem != nil {
		return problem
	}
	return nil
}

func nullModel(in PutInput) uuid.NullUUID {
	if in.ModelID == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *in.ModelID, Valid: true}
}

// auditSettings is what the audit trail keeps of settings: switches, the model's id and numbers.
func auditSettings(st Settings) map[string]any {
	m := map[string]any{"enabled": st.Enabled, "failurePolicy": st.FailurePolicy, "maxCalls": st.MaxCalls, "maxCallsPerDay": st.MaxCallsPerDay}
	if st.ModelID.Valid {
		m["modelId"] = st.ModelID.UUID.String()
	}
	if st.Admission != nil {
		m["admission"] = st.Admission
	}
	return m
}

func validateCaps(in PutInput) error {
	if !validPolicy(in.FailurePolicy) {
		return apperr.Invalid("invalid_failure_policy", "The failure policy must be fail or plain")
	}
	for _, n := range []int{in.MaxCalls, in.MaxCallsPerDay} {
		if n < MinCalls || n > MaxCallsLimit {
			return apperr.Invalid("invalid_cap", fmt.Sprintf("Call limits must be between %d and %d", MinCalls, MaxCallsLimit))
		}
	}
	return validateAdmission(in.Admission, in.Enabled)
}

// modelProblem says why a model cannot write contexts for a source of the classification (nil: it can): it must be an enabled chat model
// on an enabled connection, cleared for the classification (ADR-0006 rule 4),
// with a known window meeting the activation floor. Actual prompts are checked again.
func modelProblem(ctx context.Context, q *dbgen.Queries, modelID *uuid.UUID, classification string) *apperr.Error {
	if modelID == nil {
		return apperr.Invalid("model_required", "Choose the chat model that writes the context")
	}
	m, err := q.GetModel(ctx, *modelID)
	if err != nil {
		return apperr.Invalid("invalid_model", "Unknown model")
	}
	if m.Kind != catalog.KindChat {
		return apperr.Invalid("invalid_model", "Choose a chat model")
	}
	conn, cerr := q.GetConnection(ctx, m.ConnectionID)
	if !m.Enabled || cerr != nil || !conn.Enabled {
		return apperr.Conflict("model_unavailable", "That model, or its connection, is disabled")
	}
	ok, err := catalog.ModelAllows(ctx, q, m, classification)
	if err != nil || !ok {
		return apperr.Conflict("model_classification", "That model may not process data at this source's classification. Choose a model cleared for it")
	}
	if m.ContextWindow == nil {
		return apperr.Conflict("model_context_window", "Declare this model's context window before enabling contextual chunks")
	}
	if int(*m.ContextWindow) < MinContextWindow() {
		return apperr.Conflict("model_context_window", fmt.Sprintf("That model's context window (%d tokens) is too small for the bounded prompt (%d tokens)", *m.ContextWindow, MinContextWindow()))
	}
	return nil
}

// MinContextWindow is a coarse activation floor. Actual escaped messages and
// framing are locally counted and checked again before admission and dispatch;
// this floor is not proof that every document fits a model's own tokenizer.
func MinContextWindow() int {
	return withMargin(callInputMax(approxCounter{}, ExcerptTokens+cutSlack, UnitMaxTokens+cutSlack)) + RequestMaxTokens
}

// approxCounter counts a token per four bytes; only the fixed overhead is counted with it, for the window check.
type approxCounter struct{}

func (approxCounter) Count(s string) int { return (len(s) + 3) / 4 }
