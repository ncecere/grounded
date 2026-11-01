package contextual

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// reserveAdmission serializes settings, both windows and the reservation on the
// source's row. This applies without a team and without ordinary cost tracking.
func (s *PGStore) reserveAdmission(ctx context.Context, r Reservation) (int64, error) {
	if (r.Phase != PhaseBuild && r.Phase != PhaseLive) || r.InputTokens <= 0 || r.OutputTokens < 0 || r.InputTokens > MaxAdmissionTokens || r.OutputTokens > MaxAdmissionTokens {
		return 0, errors.New("invalid contextual admission reservation")
	}
	var id int64
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, a, err := lockAdmissionSource(ctx, q, r)
		if err != nil {
			return err
		}
		at, err := q.ContextualAdmissionClock(ctx)
		if err != nil {
			return err
		}
		prices, err := q.ContextualAdmissionPrices(ctx, dbgen.ContextualAdmissionPricesParams{ModelID: r.ModelID, AdmittedAt: at})
		if err != nil {
			return err
		}
		if prices.InputPrice == "" || prices.OutputPrice == "" {
			return &Wait{Code: "contextual_price_unknown", Message: "Configure both chat token prices before contextual admission can reserve spend"}
		}
		if prices.Currency != a.Currency {
			return &Wait{Code: "contextual_currency", Message: "Contextual admission currency does not match the configured price currency"}
		}
		amount, err := admissionAmount(r.InputTokens, r.OutputTokens, prices.InputPrice, prices.OutputPrice)
		if err != nil {
			return err
		}
		day := admissionDay(at)
		used, err := q.ContextualAdmissionUsage(ctx, dbgen.ContextualAdmissionUsageParams{SourceID: r.SourceID, ProfileID: r.ProfileID,
			AdmissionDay: day, Currency: a.Currency, IsBuild: r.Phase == PhaseBuild})
		if err != nil {
			return err
		}
		tokens := r.InputTokens + r.OutputTokens
		if err := checkAdmission(*a, used, int(cur.MaxCalls), int(cur.MaxCallsPerDay), r.Phase == PhaseBuild, tokens, amount, at); err != nil {
			return err
		}
		id, err = q.InsertContextualCall(ctx, dbgen.InsertContextualCallParams{
			SourceID: r.SourceID, ProfileID: r.ProfileID, DocumentID: uuid.NullUUID{UUID: r.DocumentID, Valid: r.DocumentID != uuid.Nil}, ModelID: r.ModelID, Phase: r.Phase,
			AdmissionDay: day, ReservedTokens: tokens, Column8: amount, Currency: a.Currency,
			Column10: prices.InputPrice, Column11: prices.OutputPrice, CreatedAt: at})
		return err
	})
	return id, err
}

// lockAdmissionSource keeps the source lock through validation and admission.
// A queued caller must see today's opt-in, limits and model clearance, not its
// earlier request's settings. No lock is held across the eventual model call.
func lockAdmissionSource(ctx context.Context, q *dbgen.Queries, r Reservation) (dbgen.SourceContextual, *Admission, error) {
	cur, err := q.LockSourceContextual(ctx, r.SourceID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !cur.Enabled) {
		return cur, nil, &StopError{Reason: "the source is switched off"}
	}
	if err != nil {
		return cur, nil, err
	}
	a := admissionOf(cur)
	if err := validateAdmission(a, true); err != nil {
		return cur, nil, err
	}
	src, err := q.GetSource(ctx, r.SourceID)
	if err != nil {
		return cur, nil, err
	}
	if problem := ModelProblem(ctx, q, &r.ModelID, src.Classification); problem != nil {
		return cur, nil, &Failure{Code: CodeForbidden, Err: problem, Permanent: true}
	}
	return cur, a, nil
}

func admissionDay(at time.Time) pgtype.Date {
	y, m, d := at.UTC().Date()
	return pgtype.Date{Time: time.Date(y, m, d, 0, 0, 0, 0, time.UTC), Valid: true}
}
