package webhooks

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// MaxAttempts bounds the sends of one delivery; with the backoff below the last is about a day after the first.
const MaxAttempts = 8

// backoff is the wait before retry n (1-based).
var backoff = []time.Duration{15 * time.Second, time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 6 * time.Hour, 12 * time.Hour}

// DeliverArgs sends one recorded delivery.
type DeliverArgs struct {
	DeliveryID uuid.UUID `json:"deliveryId"`
}

func (DeliverArgs) Kind() string { return "webhook.deliver" }

func (DeliverArgs) InsertOpts() river.InsertOpts { return river.InsertOpts{MaxAttempts: MaxAttempts} }

// DeliverWorker signs and sends deliveries, and retries them.
type DeliverWorker struct {
	river.WorkerDefaults[DeliverArgs]
	S *Service
}

func (w *DeliverWorker) NextRetry(job *river.Job[DeliverArgs]) time.Time {
	if w.S.RetryBackoff != nil {
		return time.Now().Add(w.S.RetryBackoff(job.Attempt))
	}
	return time.Now().Add(backoff[min(max(job.Attempt-1, 0), len(backoff)-1)])
}

func (w *DeliverWorker) Timeout(*river.Job[DeliverArgs]) time.Duration { return time.Minute }

// notSent says why a delivery must not be sent at all, whatever the receiver would answer: webhooks are off, the webhook is turned off or
// paused, or its host is no longer an approved destination. "" means send it.
func (s *Service) notSent(ctx context.Context, h dbgen.Webhook) (string, error) {
	if on, err := s.Enabled(ctx); err != nil || !on {
		return "webhooks are turned off", err
	}
	if !h.Enabled {
		return "the webhook is turned off", nil
	}
	u, err := url.Parse(h.URL)
	if err != nil || u.Scheme != "https" {
		return "the address is not a valid https address", nil
	}
	ok, err := hostApproved(ctx, s.q, strings.ToLower(u.Hostname()))
	if err != nil {
		return "", err
	}
	if !ok {
		return "the host is no longer an approved destination", nil
	}
	return "", nil
}

func (w *DeliverWorker) Work(ctx context.Context, job *river.Job[DeliverArgs]) error {
	s := w.S
	d, err := s.q.GetWebhookDelivery(ctx, job.Args.DeliveryID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil // deleted with its webhook
	} else if err != nil {
		return err
	}
	if d.Status != "pending" {
		return nil // done by an earlier attempt
	}
	h, err := s.q.GetWebhook(ctx, d.WebhookID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	bg := context.WithoutCancel(ctx)
	if why, err := s.notSent(ctx, h); err != nil {
		return err
	} else if why != "" {
		_ = s.q.RecordWebhookAttempt(bg, dbgen.RecordWebhookAttemptParams{ID: d.ID, LastError: why})
		return s.q.MarkWebhookDeliveryFailed(bg, d.ID)
	}
	status, errText := s.send(ctx, h, d)
	var st *int32
	if status != 0 {
		v := int32(status)
		st = &v
	}
	if err := s.q.RecordWebhookAttempt(bg, dbgen.RecordWebhookAttemptParams{ID: d.ID, LastStatus: st, LastError: errText}); err != nil {
		s.Log.WarnContext(ctx, "could not record a webhook attempt", "delivery", d.ID, "err", err)
	}
	switch {
	case status >= 200 && status < 300:
		// Together: nobody sees a delivered delivery with the old count of deliveries that gave up.
		return store.InTx(bg, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
			if err := q.ResetWebhookFailures(bg, h.ID); err != nil {
				return err
			}
			return q.MarkWebhookDelivered(bg, d.ID)
		})
	case status == http.StatusGone:
		return s.giveUp(bg, d, h, true)
	case job.Attempt >= job.MaxAttempts:
		return s.giveUp(bg, d, h, false)
	}
	return errors.New(errText) // River retries
}

// send signs and posts a delivery; it returns the receiver's status (0: none) and a short error ("" on success).
func (s *Service) send(ctx context.Context, h dbgen.Webhook, d dbgen.WebhookDelivery) (int, string) {
	plain, err := s.Box.Open(h.SecretCipher, SecretAAD(h.ID))
	if err != nil {
		return 0, "the signing secret could not be read"
	}
	header := http.Header{
		"Content-Type":      {"application/json"},
		"User-Agent":        {"Grounded-Webhooks/1"},
		SignatureHeader:     {Sign(string(plain), s.now(), d.Payload)},
		"Grounded-Event":    {d.EventType},
		"Grounded-Delivery": {d.ID.String()},
		"Grounded-Webhook":  {h.ID.String()},
	}
	status, err := s.Client.Post(ctx, h.URL, header, d.Payload)
	switch {
	case err != nil:
		return 0, describe(err)
	case status >= 200 && status < 300:
		return status, ""
	}
	return status, fmt.Sprintf("the receiver answered %d", status)
}

// giveUp ends a delivery that will not be retried. It counts towards pausing the webhook (five in a row), and a 410 pauses it at once; the
// people who manage it are told when it pauses.
func (s *Service) giveUp(ctx context.Context, d dbgen.WebhookDelivery, h dbgen.Webhook, gone bool) error {
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if err := q.MarkWebhookDeliveryFailed(ctx, d.ID); err != nil {
			return err
		}
		cur, err := q.LockWebhook(ctx, h.ID)
		if err != nil {
			return err
		}
		var row dbgen.Webhook
		reason := "failing"
		if gone {
			reason = "gone"
			row, err = q.PauseWebhookGone(ctx, h.ID)
		} else {
			row, err = q.RecordWebhookFailure(ctx, dbgen.RecordWebhookFailureParams{ID: h.ID, PauseAfter: pauseAfterFailedDelivery})
		}
		if err != nil {
			return err
		}
		if cur.Enabled && !row.Enabled && s.OnPaused != nil {
			return s.OnPaused(ctx, tx, webhookOf(row), reason)
		}
		return nil
	})
}

func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

// ---- pruning ------------------------------------------------------------------------

// PruneArgs deletes old deliveries.
type PruneArgs struct{}

func (PruneArgs) Kind() string { return "webhook.prune" }

// PruneWorker keeps a webhook's delivery log to the last 14 days.
type PruneWorker struct {
	river.WorkerDefaults[PruneArgs]
	S *Service
}

func (w *PruneWorker) Work(ctx context.Context, _ *river.Job[PruneArgs]) error {
	n, err := w.S.q.PruneWebhookDeliveries(ctx, w.S.now().AddDate(0, 0, -deliveryRetentionDays))
	if err == nil && n > 0 {
		w.S.Log.InfoContext(ctx, "pruned webhook deliveries", "deleted", n)
	}
	return err
}

// Register adds the workers.
func Register(w *river.Workers, s *Service) {
	river.AddWorker(w, &DeliverWorker{S: s})
	river.AddWorker(w, &PruneWorker{S: s})
}

// PrunePeriodic runs the pruning every six hours.
func PrunePeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(6*time.Hour), func() (river.JobArgs, *river.InsertOpts) { return PruneArgs{}, nil }, nil)
}
