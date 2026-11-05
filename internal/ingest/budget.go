package ingest

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// WaitMonthlyBudget is the error code of a document waiting because its team's enforced monthly budget is used up
// (docs/specs/agent-budgets/DESIGN.md §3).
const WaitMonthlyBudget = "monthly_budget"

// budgetRecheck is the longest a document waits before checking the budget again; raising the budget or granting an
// extension wakes it at once (WakeBudgetWaiting).
const budgetRecheck = 10 * time.Minute

// TeamBudget reports whether a team's enforced monthly budget is used up, and when it resets (internal/costs).
type TeamBudget interface {
	Blocked(ctx context.Context, teamID uuid.UUID) (bool, time.Time, error)
}

// budgetWait stops a document before any work that costs money: it waits rather than fails.
type budgetWait struct{ until time.Time }

func (e *budgetWait) Error() string { return "the team's monthly budget is used up" }

// checkBudget is the wait for a team over its enforced budget (nil: go on). A document already dispatched when the budget
// ran out waits here instead of being parsed, read with OCR or embedded.
func (p *Processor) checkBudget(ctx context.Context, team uuid.NullUUID) error {
	if p.Budget == nil || !team.Valid {
		return nil
	}
	blocked, resets, err := p.Budget.Blocked(ctx, team.UUID)
	if err != nil || !blocked {
		return err
	}
	until := time.Now().Add(budgetRecheck)
	if !resets.IsZero() && resets.Before(until) {
		until = resets
	}
	return &budgetWait{until: until}
}

func asBudgetWait(err error) (*budgetWait, bool) {
	var w *budgetWait
	return w, errors.As(err, &w)
}

// waitForBudget puts a document back to wait for the budget and frees its slot, as the daily OCR limit does.
func (p *Processor) waitForBudget(ctx context.Context, doc dbgen.Document, w *budgetWait) error {
	paused, err := p.paused(ctx)
	if err != nil {
		return err
	}
	msg := fmt.Sprintf("Waiting: the team's monthly budget is used up. This document continues when a platform admin raises the budget or grants an extension, or when the month ends (checked again by %s UTC).",
		w.until.UTC().Format("15:04"))
	return pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
		n, err := dbgen.New(tx).WaitDocument(ctx, dbgen.WaitDocumentParams{ID: doc.ID, WaitingUntil: &w.until, ErrorCode: WaitMonthlyBudget, ErrorMessage: msg})
		if err != nil || n == 0 {
			return err
		}
		return p.refill(ctx, tx, paused)
	})
}

// WakeBudgetWaiting makes documents waiting for a team's budget (every team's when team is not set) pending again and kicks
// the dispatcher: the budget changed. A team still over its budget is skipped by the dispatcher, and a document dispatched
// anyway waits again.
func WakeBudgetWaiting(ctx context.Context, pool *pgxpool.Pool, client *river.Client[pgx.Tx], team uuid.NullUUID) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var err error
		n, err = dbgen.New(tx).WakeWaitingDocuments(ctx, dbgen.WakeWaitingDocumentsParams{ErrorCode: WaitMonthlyBudget, TeamID: team})
		if err != nil || n == 0 || client == nil {
			return err
		}
		return Kick(ctx, client, tx)
	})
	return n, err
}
