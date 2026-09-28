package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/notify"
)

// wireNotify connects the notification service to the services whose
// changes notify people (docs/phase4-publishing.md §8).
func wireNotify(s *Services) {
	s.Teams.Notify = s.Notify
	s.Web.Notify = s.Notify
	s.Sources.Notify = s.Notify
	s.Agents.Notify = s.Notify
	s.Limits.OnDailyLimit = func(ctx context.Context, teamID uuid.UUID, key limits.Key, max int64) {
		noun := string(key)
		if d, ok := limits.Lookup(key); ok {
			noun = d.Noun
		}
		s.Notify.DailyLimitReached(ctx, teamID, string(key), noun, max)
	}
}

// wireCosts builds the costs service: budgets are checked with the limits
// (chat and retrieval), by the ingestion dispatcher and by crawls; a change
// wakes waiting crawls and ingestion; notices notify the team (E2).
func wireCosts(s *Services, pool *pgxpool.Pool, jobsClient *jobs.Client, log *slog.Logger) {
	s.Costs = costs.New(pool, s.Teams, log)
	s.Limits.Budget = s.Costs
	s.Web.Budget = s.Costs
	s.Costs.OnChange = func(ctx context.Context, team uuid.NullUUID) {
		s.Web.BudgetChanged(ctx, team)
		if jobsClient != nil {
			if _, err := jobsClient.Insert(ctx, ingest.DispatchArgs{}, nil); err != nil {
				log.WarnContext(ctx, "could not kick the ingestion dispatcher after a budget change", "err", err)
			}
		}
	}
	s.Costs.OnNotice = func(ctx context.Context, tx pgx.Tx, n costs.Notice) error {
		pct := 0
		if p := costs.Percent(n.Spent, n.Limit); p != nil {
			pct = *p
		}
		return s.Notify.BudgetReached(ctx, tx, n.TeamID, notify.BudgetNotice{
			Exhausted: n.Level == costs.LevelExhausted, Month: n.Month, Spent: n.Spent.FloatString(2), Limit: n.Limit.FloatString(2),
			Currency: n.Currency, Percent: pct, ResetsAt: n.ResetsAt, Location: n.TimeZone,
		})
	}
}

// NewMailSender returns the SMTP sender, or nil when email is off.
func NewMailSender(cfg config.Config) notify.Sender {
	if !cfg.SMTP.Enabled() {
		return nil
	}
	return &notify.SMTPSender{Config: notify.SMTPConfig{
		Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, Username: cfg.SMTP.Username, Password: cfg.SMTP.Password, TLS: cfg.SMTP.TLS,
	}}
}

// registerNotify adds the email worker and the invite-expiry scan.
func registerNotify(w *river.Workers, cfg config.Config, pool *pgxpool.Pool, s *Services, sender notify.Sender, log *slog.Logger) {
	river.AddWorker(w, &notify.EmailWorker{
		Pool: pool, Sender: sender, From: cfg.SMTP.From, Log: log,
		Site: notify.Site{Instance: cfg.Instance.Name, AppURL: cfg.AppURL},
	})
	river.AddWorker(w, &notify.InviteExpiryWorker{S: s.Notify})
}

// notifyPeriodic runs the invite-expiry scan daily (and on start).
func notifyPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(24*time.Hour),
		func() (river.JobArgs, *river.InsertOpts) { return notify.InviteExpiryArgs{}, nil },
		&river.PeriodicJobOpts{RunOnStart: true})
}
