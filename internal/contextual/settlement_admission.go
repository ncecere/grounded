package contextual

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// settlementAdmission orders charge reconciliation with new admissions: source
// settings row first, attempt row second. Only complete reported usage can
// replace conservative reserved headroom; missing/partial usage retains it.
func settlementAdmission(ctx context.Context, q *dbgen.Queries, st Settlement) (*dbgen.SettleContextualCallParams, bool, error) {
	call, err := q.GetContextualCall(ctx, st.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	cur, err := q.LockSourceContextual(ctx, call.SourceID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	// Source content/settings can disappear during a paid request. Retained
	// attempts may still settle usage, but can never republish cached text.
	cacheAllowed := err == nil && cur.Enabled
	call, err = q.LockContextualCall(ctx, st.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if call.Outcome != OutcomeStarted || call.FinishedAt != nil {
		return nil, false, nil
	}
	p := &dbgen.SettleContextualCallParams{ID: st.ID, Outcome: st.Outcome, TokensIn: st.TokensIn, TokensOut: st.TokensOut}
	if err := reconcileAdmission(call, st, p); err != nil {
		return nil, false, err
	}
	return p, cacheAllowed, nil
}

// reconcileAdmission changes headroom only for complete reported usage of the
// admitted model/source/document. Unknown or partial reports keep reservations.
func reconcileAdmission(call dbgen.ContextualCall, st Settlement, p *dbgen.SettleContextualCallParams) error {
	if st.Cache != nil && st.Cache.ProfileID != call.ProfileID {
		return errors.New("contextual cache profile does not match its admitted attempt")
	}
	u := st.Usage
	if u == nil {
		return nil
	}
	if u.Source != call.SourceID || u.Model != call.ModelID || u.Phase != call.Phase || (call.DocumentID.Valid && u.Document != call.DocumentID.UUID) {
		return errors.New("contextual settlement usage does not match its admitted attempt")
	}
	if !u.Reported || st.TokensIn == nil || st.TokensOut == nil || *st.TokensIn <= 0 || *st.TokensOut < 0 {
		return nil
	}
	in, out := int64(*st.TokensIn), int64(*st.TokensOut)
	amount, err := admissionAmount(in, out, numericString(call.InputPrice), numericString(call.OutputPrice))
	if err != nil {
		return err
	}
	tokens := in + out
	p.ChargedTokens, p.ChargedAmount = &tokens, &amount
	return nil
}
