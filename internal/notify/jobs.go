// River jobs: sending one email (with retries) and the daily "invite about
// to expire" scan.

package notify

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// EmailArgs sends one recorded email delivery.
type EmailArgs struct {
	DeliveryID uuid.UUID `json:"deliveryId"`
}

func (EmailArgs) Kind() string { return "notify.email" }

// EmailMaxAttempts bounds retries; with the backoff below the last attempt
// is about a day after the first.
const EmailMaxAttempts = 10

func (EmailArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: EmailMaxAttempts}
}

// emailBackoff is the wait before retry n (1-based).
var emailBackoff = []time.Duration{
	10 * time.Second, 30 * time.Second, time.Minute, 5 * time.Minute, 15 * time.Minute,
	30 * time.Minute, time.Hour, 3 * time.Hour, 6 * time.Hour, 12 * time.Hour,
}

// EmailWorker renders and sends email deliveries.
type EmailWorker struct {
	river.WorkerDefaults[EmailArgs]
	Pool   *pgxpool.Pool
	Sender Sender
	From   string // SMTP_FROM
	Site   Site
	Log    *slog.Logger
	// Backoff overrides the retry delay (tests).
	Backoff func(attempt int) time.Duration
}

func (w *EmailWorker) NextRetry(job *river.Job[EmailArgs]) time.Time {
	if w.Backoff != nil {
		return time.Now().Add(w.Backoff(job.Attempt))
	}
	i := min(max(job.Attempt-1, 0), len(emailBackoff)-1)
	return time.Now().Add(emailBackoff[i])
}

func (w *EmailWorker) Timeout(*river.Job[EmailArgs]) time.Duration { return 2 * time.Minute }

func (w *EmailWorker) Work(ctx context.Context, job *river.Job[EmailArgs]) error {
	q := dbgen.New(w.Pool)
	d, err := q.GetNotificationEmail(ctx, job.Args.DeliveryID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil // the event was deleted with its team
	} else if err != nil {
		return err
	}
	if d.Status != "pending" {
		return nil // sent (or given up) by an earlier attempt
	}
	if w.Sender == nil {
		// SMTP was turned off after the email was queued.
		_ = q.RecordNotificationEmailError(ctx, dbgen.RecordNotificationEmailErrorParams{ID: d.ID, LastError: "email is not configured", Final: true})
		return river.JobCancel(errors.New("email is not configured (SMTP_HOST)"))
	}
	def, _ := Lookup(Type(d.Type))
	r, err := Render(w.Site, Content{Type: Type(d.Type), Title: d.Title, Body: d.Body, Link: d.Link, Mandatory: def.Mandatory})
	if err != nil {
		return river.JobCancel(err) // a template bug; retrying won't help
	}
	sendErr := w.Sender.Send(ctx, Message{From: w.From, To: d.ToAddress, Rendered: r})
	bg := context.WithoutCancel(ctx)
	if sendErr == nil {
		return q.MarkNotificationEmailSent(bg, d.ID)
	}
	final := job.Attempt >= job.MaxAttempts
	if err := q.RecordNotificationEmailError(bg, dbgen.RecordNotificationEmailErrorParams{
		ID: d.ID, LastError: clip(sendErr.Error(), 1000), Final: final,
	}); err != nil {
		w.Log.WarnContext(ctx, "could not record email failure", "delivery", d.ID, "err", err)
	}
	w.Log.WarnContext(ctx, "notification email failed", "delivery", d.ID, "attempt", job.Attempt, "final", final, "err", sendErr)
	return sendErr
}

// InviteExpiryArgs scans for open invites that expire within
// InviteExpiryNotice and notifies each address once.
type InviteExpiryArgs struct{}

func (InviteExpiryArgs) Kind() string { return "notify.invite_expiry" }

func (InviteExpiryArgs) InsertOpts() river.InsertOpts {
	// Several workers schedule the same periodic job; one run a day is enough.
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: 24 * time.Hour}}
}

// InviteExpiryNotice is how long before expiry the notice goes out.
const InviteExpiryNotice = 3 * 24 * time.Hour

// InviteExpiryWorker runs the scan.
type InviteExpiryWorker struct {
	river.WorkerDefaults[InviteExpiryArgs]
	S *Service
}

func (w *InviteExpiryWorker) Work(ctx context.Context, _ *river.Job[InviteExpiryArgs]) error {
	n, err := w.S.NotifyExpiringInvites(ctx, time.Now())
	if n > 0 {
		w.S.Log.InfoContext(ctx, "notified expiring invites", "count", n)
	}
	return err
}

// NotifyExpiringInvites emits InviteExpiring for open invites expiring
// within InviteExpiryNotice of now. Each invite (and expiry date) is
// notified once, however often this runs. It returns how many invites it
// looked at.
func (s *Service) NotifyExpiringInvites(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.q.ExpiringInvites(ctx, now.Add(InviteExpiryNotice))
	if err != nil {
		return 0, err
	}
	for _, inv := range rows {
		ev := InviteExpiringEvent(TeamRef{ID: inv.TeamID, Slug: inv.TeamSlug, Name: inv.TeamName}, inv.ID, inv.Email, inv.Role, inv.ExpiresAt)
		if err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error { return s.Emit(ctx, tx, ev) }); err != nil {
			return 0, err
		}
	}
	return len(rows), nil
}
